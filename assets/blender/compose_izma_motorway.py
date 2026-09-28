"""Author a native replacement patch; retain unrelated source faces verbatim.

The edit manifest names retired drawing triangles, collision triangles and
whole support boxes. Its companion Blender file holds the clipped remainder,
the new IC surfaces and relocated supports. Export and runtime acceptance are
separate; this command never modifies the canonical colony or live preview.
"""
import argparse
from collections import defaultdict
import hashlib
import json
import math
from pathlib import Path
import sys
import bpy
from mathutils.bvhtree import BVHTree

ASSETS=Path(__file__).resolve().parent;ROOT=ASSETS.parents[1]
sys.path.insert(0,str(ASSETS))
from colony_manifest_io import encoded,read_manifest
from izma_mesh_builder import BuildingMeshBuilder
from izma_motorway_replacement import FootprintCuts,face_area,prism_planes,split_planes,split_footprint
from plan_izma_motorway import stations,sample
from izma_motorway_lighting import add_lighting


def road_quads(road,extra=0):
    points=road['points'];width=road['width']/2+road.get('footway',0)+extra;sides=[]
    for i,p in enumerate(points):
        a,b=points[max(0,i-1)],points[min(len(points)-1,i+1)]
        dx,dy=b[0]-a[0],b[1]-a[1];length=math.hypot(dx,dy)
        sides.append([(p[0]-dy/length*s,p[1]+dx/length*s) for s in [-width,width]])
    return [[a[0],b[0],b[1],a[1]] for a,b in zip(sides,sides[1:])]


def box_corners(box):
    x,y,z,w,d,h,yaw=box;c,s=math.cos(yaw),math.sin(yaw)
    return [(x+dx*c-dy*s,y+dx*s+dy*c,z) for dx,dy in [(-w/2,-d/2),(w/2,-d/2),(w/2,d/2),(-w/2,d/2)]]


def compose(candidate,output):
    if not candidate.is_absolute() or not output.is_absolute() or output.exists() or output.resolve()==ROOT:
        raise ValueError('Use the existing isolated candidate and a fresh absolute output directory')
    native=candidate/'assets/blender/izma-motorway.blend'
    plan=json.loads(native.with_name('izma-motorway-plan.json').read_text())
    report=json.loads(native.with_suffix('.json').read_text())
    retirement=json.loads(native.with_name('izma-motorway-retirement.json').read_text())
    assert hashlib.sha256(native.read_bytes()).hexdigest()==report['nativeSha256']
    assert retirement['planSha256']==report['planSha256']
    source_path=ROOT/'src/worlds/generated/izmaColony.json'
    assert json.loads(source_path.read_text())['sourceSha256']==plan['sourceSha256']==retirement['sourceSha256']
    source=read_manifest(source_path);base=source['base'];radius=plan['radius']
    for name,digest in plan['dependencies'].items():
        assert hashlib.sha256((ASSETS/name).read_bytes()).hexdigest()==digest,name
    points=[tuple(base['vertices'][i:i+3]) for i in range(0,len(base['vertices']),3)]
    earth=[points[i] for i in base['meshes']['earth']]
    wrapped=[(math.cos(x/radius)*(radius-h),y,math.sin(x/radius)*(radius-h)) for x,y,h in earth]
    ground_tree=BVHTree.FromPolygons(wrapped,[tuple(range(i,i+3)) for i in range(0,len(wrapped),3)],all_triangles=True)
    def ground(x,y):
        hit=ground_tree.ray_cast((0,y,0),(math.cos(x/radius),0,math.sin(x/radius)))[0]
        if hit is None:raise ValueError(('No earth',x,y))
        return radius-math.hypot(hit.x,hit.z)
    cuts=FootprintCuts([(c['ic'],c['polygon']) for c in retirement['cutters']])
    interchanges={i['id']:i for i in plan['interchanges']}
    road_entries=[];merge_entries=[];merge_planes={}
    for ic in plan['interchanges']:
        for road in ic['roads']:
            road_entries.extend((ic['id'],p) for p in road_quads(road,extra=1.))
            if road['kind']!='ramp':continue
            for i,poly in enumerate(road_quads(road,extra=.3)):
                if min(p[0] for p in poly)>ic['node'][0]+12.4 or max(p[0] for p in poly)<ic['node'][0]-12.4:
                    continue
                key=(ic['id'],road['id'],i);a,b=road['points'][i:i+2]
                dx,dy,dh=b[0]-a[0],b[1]-a[1],b[2]-a[2];length2=dx*dx+dy*dy
                gx,gy=dh*dx/length2,dh*dy/length2;intercept=a[2]-gx*a[0]-gy*a[1]
                merge_entries.append((key,poly))
                merge_planes[key]=prism_planes(poly)+[((-gx,-gy,1),-intercept+.15),((gx,gy,-1),intercept+2)]
    merge_grid=FootprintCuts(merge_entries);roads_grid=FootprintCuts(road_entries)
    def open_merges(poly):
        keys=sorted({i for cell in merge_grid.cells(poly) for i in merge_grid.grid.get(cell,[])})
        outside=[poly];owners=set()
        for i in keys:
            key,_=merge_entries[i];kept=[]
            for part in outside:
                remainder,removed=split_planes(part,merge_planes[key]);kept.extend(remainder)
                if removed:owners.add(key[0])
            outside=kept
        return outside,owners

    # A retained raised arterial was originally an earth-filled approach.
    # Where the new ramp crosses below it, turn 60 m into a supported deck;
    # merely opening its guardrail would leave a retaining wall in the ramp.
    crossing_report=json.loads(native.with_name('izma-motorway-crossings.json').read_text())
    transport=json.loads((ASSETS/'izma-transport.json').read_text())
    master=json.loads((ASSETS/'izma-colony-plan.json').read_text())
    profiles={p['id']:p for p in transport['profiles']};designs={r['id']:r for r in master['routes']}
    bridges=[];bridge_entries=[];bridge_planes={}
    for crossing in crossing_report['crossings']:
        old=profiles[crossing['existingRoad']];shift=old['band']*math.tau*radius/3
        profile=[[p[0]+shift,*p[1:]] for p in old['points']];along=stations(profile);centre=crossing['point']
        nearest=None
        for i,(a,b) in enumerate(zip(profile,profile[1:])):
            dx,dy=b[0]-a[0],b[1]-a[1];length2=dx*dx+dy*dy
            if length2<1e-10:continue
            t=max(0,min(1,((centre[0]-a[0])*dx+(centre[1]-a[1])*dy)/length2))
            distance=math.hypot(centre[0]-a[0]-t*dx,centre[1]-a[1]-t*dy)
            if nearest is None or distance<nearest[0]:nearest=(distance,along[i]+math.sqrt(length2)*t)
        assert nearest and old['kind']=='arterial', 'New crossing needs an explicit bridge design'
        start,end=nearest[1]-30,nearest[1]+30
        assert 0<start<end<along[-1]
        upper=[sample(profile,along,start),*[p for p,d in zip(profile,along) if start<d<end],sample(profile,along,end)]
        bridge={'ic':crossing['ic'],'route':old['id'],'points':upper,'width':designs[old['id']]['width'],
                'footway':2.2,'thickness':.9,'span':60.,'abutmentWidth':2.4}
        bridges.append(bridge)
        for i,poly in enumerate(road_quads(bridge,extra=.3)):
            key=(bridge['ic'],bridge['route'],i);a,b=upper[i:i+2]
            dx,dy,dh=b[0]-a[0],b[1]-a[1],b[2]-a[2];length2=dx*dx+dy*dy
            gx,gy=dh*dx/length2,dh*dy/length2;intercept=a[2]-gx*a[0]-gy*a[1]
            bridge_entries.append((key,poly))
            bridge_planes[key]=prism_planes(poly)+[((gx,gy,-1),intercept-.9)]
    bridge_grid=FootprintCuts(bridge_entries)
    def open_bridge_soffits(poly):
        keys=sorted({i for cell in bridge_grid.cells(poly) for i in bridge_grid.grid.get(cell,[])})
        outside=[poly];owners=set()
        for i in keys:
            key,_=bridge_entries[i];kept=[]
            for part in outside:
                remainder,removed=split_planes(part,bridge_planes[key]);kept.extend(remainder)
                if removed:owners.add(key[0])
            outside=kept
        return outside,owners

    relocations=[]
    for index in sorted({r['index'] for r in retirement['existingBoxesBlockingNewRoads']}):
        old=source['structures'][index];owner=next(r['ic'] for r in retirement['existingBoxesBlockingNewRoads'] if r['index']==index)
        ic=interchanges[owner];new=None
        for offset in [-3,3,-6,6,-9,9,-12,12]:
            trial=list(old);trial[1]+=offset
            if roads_grid.split(box_corners(trial))[1]:continue
            nx,ny=trial[:2];profile=ic['mainline']
            a,b=next((a,b) for a,b in zip(profile,profile[1:]) if a[1]<=ny<=b[1])
            top=a[2]+(b[2]-a[2])*(ny-a[1])/(b[1]-a[1])-2.4
            foot=min(ground(p[0],p[1]) for p in box_corners(trial))-.3
            trial[2]=foot;trial[5]=top-foot
            assert trial[5]>0
            new=trial;break
        assert new is not None, ('Cannot move retained pier',index)
        relocations.append({'index':index,'ic':owner,'before':old,'after':new,'removedDrawingTriangles':0})
    def belongs_to_old_pier(tri):
        for item in relocations:
            x,y,z,w,d,h,yaw=item['before'];c,s=math.cos(yaw),math.sin(yaw)
            if all(abs((p[0]-x)*c+(p[1]-y)*s)<=w/2+.015 and
                   abs(-(p[0]-x)*s+(p[1]-y)*c)<=d/2+.015 and z-.015<=p[2]<=z+h+.015 for p in tri):
                return item
        return None

    bpy.ops.wm.open_mainfile(filepath=str(native))
    candidate_scene=bpy.data.scenes['SW_izma_motorway'];candidate_scene.view_layers[0].update()
    scene=bpy.data.scenes.new('SW_izma_motorway_integration');bpy.context.window.scene=scene
    scene['owner']='spinward-izma-motorway-integration-v1';scene['sourceSha256']=plan['sourceSha256']
    scene['candidateSha256']=report['nativeSha256'];scene['runtime_accepted']=False
    scene.unit_settings.system='METRIC'
    materials={};palette=dict(source['palette'])
    palette.update(('motorway-'+k,v) for k,v in report['materials'].items())
    palette['motorway-lamp']='#d4d1b6'
    for name,color in palette.items():
        material=bpy.data.materials.new('SWMI_'+name)
        material.diffuse_color=tuple(int(color[i:i+2],16)/255 for i in [1,3,5])+(1,)
        material['spinward_material']=name;materials[name]=material
    builders={};face_counts=defaultdict(int)
    def append(owner,kind,material,polygon,draw=True,physical=False,floor=False):
        key=(owner,kind,draw,physical);builder=builders.setdefault(key,BuildingMeshBuilder(scene,materials))
        nx,ny=interchanges[owner]['node']
        for i in range(1,len(polygon)-1):
            triangle=[polygon[0],polygon[i],polygon[i+1]]
            if face_area(triangle)<1e-8:continue
            builder.face([(p[0]-nx,p[1]-ny,p[2]) for p in triangle],material,floor)
            face_counts[kind]+=1
    drawing_remove=defaultdict(list);collision_remove=defaultdict(list)
    for material,indices in base['meshes'].items():
        if material not in ['arterial','expressway','walk','parapet','structure']:continue
        for offset in range(0,len(indices),3):
            tri=[points[i] for i in indices[offset:offset+3]]
            pier=belongs_to_old_pier(tri) if material=='structure' else None
            if pier is not None:
                drawing_remove[material].append(offset//3);pier['removedDrawingTriangles']+=1;continue
            outside,retired=cuts.split(tri);owners={owner for owner,_ in retired}
            if material=='parapet':
                remaining=[]
                for part in outside:
                    pieces,merged=open_merges(part);remaining.extend(pieces);owners.update(merged)
                outside=remaining
            if material=='structure':
                remaining=[]
                for part in outside:
                    pieces,opened=open_bridge_soffits(part);remaining.extend(pieces);owners.update(opened)
                outside=remaining
            if not owners:continue
            assert len(owners)==1, owners
            owner=next(iter(owners));drawing_remove[material].append(offset//3)
            for part in outside:
                append(owner,'retained-drawing',material,part,floor=material in ['arterial','expressway','walk'])
    for item in relocations:
        assert item['removedDrawingTriangles']==12, ('Expected whole pier mesh',item)
    print(json.dumps({'phase':'retired drawing','triangles':sum(map(len,drawing_remove.values())),'relocations':relocations}),flush=True)

    for index,surface in enumerate(base['surfaces']):
        ids=surface['indices'];floor=surface.get('groundSurface',True)
        for offset in range(0,len(ids),3):
            tri=[points[i] for i in ids[offset:offset+3]]
            outside,retired=cuts.split(tri)
            if retired and floor:
                # The old access was raised at least several metres. Leave
                # terrain compounds intact rather than cutting/reprojecting
                # their curved chord planes merely to remove the road above.
                raised=[]
                for owner,part in retired:
                    centre=[sum(p[k] for p in part)/len(part) for k in range(3)]
                    if centre[2]>ground(*centre[:2])+.5:raised.append((owner,part))
                if not raised:continue
                assert len(raised)==len(retired),'Mixed road/earth collision triangle needs native review'
            owners={owner for owner,_ in retired}
            if not floor:
                remaining=[]
                for part in outside:
                    pieces,merged=open_merges(part);remaining.extend(pieces);owners.update(merged)
                outside=remaining
            if not owners:continue
            assert len(owners)==1
            owner=next(iter(owners));collision_remove[str(index)].append(offset//3)
            for part in outside:append(owner,'retained-collision','arterial' if floor else 'parapet',part,draw=False,physical=True,floor=floor)

    for obj in candidate_scene.objects:
        if obj.type!='MESH':continue
        mesh=obj.data;mesh.calc_loop_triangles();owner=obj['motorway_id'];mainline=obj['role'].endswith('-mainline')
        native_points=[]
        for vertex in mesh.vertices:
            p=obj.matrix_world@vertex.co;native_points.append((-p.y,p.x,p.z))
        flags=mesh.attributes['physical'].data;floor=mesh.attributes['ground_surface'].data
        for triangle in mesh.loop_triangles:
            poly=[native_points[i] for i in triangle.vertices]
            material=mesh.materials[triangle.material_index]['spinward_material']
            if mainline:
                if material=='motorway-mark':continue
                if material=='motorway-rail' and all(abs(p[0]-interchanges[owner]['node'][0])<.5 for p in poly):continue
                pieces=[p for ident,p in cuts.split(poly)[1] if ident==owner]
                material={'motorway-road':'expressway','motorway-structure':'structure','motorway-rail':'parapet'}.get(material,material)
            else:pieces=[poly]
            for part in pieces:
                append(owner,'mainline-restoration' if mainline else obj['role'],material,part,
                       physical=bool(flags[triangle.polygon_index].value),floor=bool(floor[triangle.polygon_index].value))
    for item in relocations:
        box=item['after'];bottom=box_corners(box);top=[(x,y,z+box[5]) for x,y,z in bottom]
        polygons=[list(reversed(bottom)),top]+[[bottom[i],bottom[(i+1)%4],top[(i+1)%4],top[i]] for i in range(4)]
        for poly in polygons:append(item['ic'],'relocated-pier','structure',poly)
    for bridge in bridges:
        owner=bridge['ic'];width=bridge['width']/2+bridge['footway'];upper=bridge['points']
        for a,b in zip(upper,upper[1:]):
            dx,dy=b[0]-a[0],b[1]-a[1];length=math.hypot(dx,dy);nx,ny=-dy/length,dx/length
            left=[(p[0]-nx*width,p[1]-ny*width,p[2]) for p in [a,b]]
            right=[(p[0]+nx*width,p[1]+ny*width,p[2]) for p in [a,b]]
            bottom=[(p[0],p[1],p[2]-.9) for p in [left[0],left[1],right[1],right[0]]]
            append(owner,'crossing-deck','structure',list(reversed(bottom)),physical=True)
            for pa,pb in [left,right]:
                append(owner,'crossing-deck','structure',[(pa[0],pa[1],pa[2]-.9),(pb[0],pb[1],pb[2]-.9),
                       (pb[0],pb[1],pb[2]+.14),(pa[0],pa[1],pa[2]+.14)],physical=True)
            for side in [-1,1]:
                vs=[(p[0]+nx*(side*(width-.2)+s*.14),p[1]+ny*(side*(width-.2)+s*.14),p[2]+z)
                    for p in [a,b] for z in [.14,1.19] for s in [-1,1]]
                for face in [(0,4,6,2),(1,3,7,5),(2,6,7,3),(0,1,5,4),(0,2,3,1),(4,5,7,6)]:
                    append(owner,'crossing-guard','parapet',[vs[i] for i in face],physical=True)
        for a,b in [(upper[0],upper[1]),(upper[-1],upper[-2])]:
            dx,dy=b[0]-a[0],b[1]-a[1];length=math.hypot(dx,dy);dx/=length;dy/=length
            x,y=a[0]+dx*1.2,a[1]+dy*1.2
            foot=min(ground(x-dy*s,y+dx*s) for s in [-width,width])-.3
            box=[x,y,foot,2.4,width*2,a[2]-.9-foot,math.atan2(dy,dx)]
            bottom=box_corners(box);top=[(x,y,z+box[5]) for x,y,z in bottom]
            for poly in [top]+[[bottom[i],bottom[(i+1)%4],top[(i+1)%4],top[i]] for i in range(4)]:
                append(owner,'crossing-abutment','structure',poly,physical=True)
    lights=add_lighting(scene,plan,materials,append,road_quads,master,transport)
    records=[]
    for (owner,kind,draw,physical),builder in builders.items():
        parcel={'id':owner+'-'+kind,'position':interchanges[owner]['node'],'floor':0,'yaw':0,
                'district':owner,'family':'infrastructure'}
        obj=builder.finish('SWMI_'+parcel['id'],parcel,-1)
        obj['owner']=scene['owner'];obj['motorway_id']=owner;obj['role']=kind;obj['drawing']=draw
        obj['runtime_accepted']=False;obj.hide_render=not draw
        flags=obj.data.attributes.new('physical','BOOLEAN','FACE')
        for item in flags.data:item.value=physical
        records.append({'name':obj.name,'vertices':len(obj.data.vertices),'faces':len(obj.data.polygons),'drawing':draw,'physical':physical})
    scene.view_layers[0].update()
    cylinder=bpy.data.scenes.new('SW_izma_motorway_integration_cylinder');cylinder['owner']=scene['owner']
    for obj in scene.objects:
        data=obj.data.copy();copy=bpy.data.objects.new(obj.name+'_cylinder',data);cylinder.collection.objects.link(copy)
        for key,value in obj.items():copy[key]=value
        copy.hide_render=obj.hide_render
        if obj.type=='LIGHT':
            p=obj.matrix_world.translation;x,y,h=-p.y,p.x,p.z;angle=x/radius
            copy.location=(math.cos(angle)*(radius-h),y,math.sin(angle)*(radius-h))
            continue
        for original,vertex in zip(obj.data.vertices,data.vertices):
            p=obj.matrix_world@original.co;x,y,h=-p.y,p.x,p.z;angle=x/radius
            vertex.co=(math.cos(angle)*(radius-h),y,math.sin(angle)*(radius-h))
    cylinder.view_layers[0].update()
    output.mkdir(parents=True)
    target=output/'izma-motorway-integration.blend'
    bpy.data.libraries.write(str(target),{scene,cylinder},fake_user=True,compress=True)
    result={'origin':'ai','created':'2026-09-20','owner':scene['owner'],'sourceSha256':plan['sourceSha256'],
            'candidateSha256':report['nativeSha256'],'planSha256':report['planSha256'],
            'nativeSha256':hashlib.sha256(target.read_bytes()).hexdigest(),
            'drawingRemove':dict(drawing_remove),'collisionRemove':dict(collision_remove),
            'relocatedStructures':relocations,'convertedCrossings':bridges,'objects':records,'lights':lights,'faceCounts':dict(face_counts),'palette':palette,
            'status':'Native replacement patch; composed-source audit and export pending; not installed'}
    target.with_suffix('.json').write_bytes(encoded(result))
    print(json.dumps({**{k:v for k,v in result.items() if k not in ['drawingRemove','collisionRemove','objects','palette','lights']},'lights':len(lights)}),flush=True)


if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--candidate-root',type=Path,required=True)
    parser.add_argument('--output-root',type=Path,required=True)
    args=parser.parse_args(sys.argv[sys.argv.index('--')+1:]);compose(args.candidate_root,args.output_root)
