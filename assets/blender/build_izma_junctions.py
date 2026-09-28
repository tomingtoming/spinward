"""Save editable ring/JCT decks with shared native collision face flags.

Candidate only. Context mainlines replace bounded portions during eventual
integration; writing this file does not change the installed colony.
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
from colony_manifest_io import read_manifest
from izma_mesh_builder import BuildingMeshBuilder
from build_izma_motorway import subtract, occupied_span
from plan_izma_junctions import at_axis
from plan_izma_motorway import stations, sample
from izma_junction_alignments import OUTER, LOOP

MATERIALS={'road':'#676c69','structure':'#969b96','rail':'#737d79','mark':'#d5cdb8'}


def build(candidate):
    path=candidate/'assets/blender/izma-junction-plan.json';plan=json.loads(path.read_text())
    target=path.with_name('izma-junctions.blend');assert not target.exists() and not plan['failures']
    document=ROOT/'src/worlds/generated/izmaColony.json'
    assert json.loads(document.read_text())['sourceSha256']==plan['sourceSha256']
    for name,digest in plan['dependencies'].items():assert hashlib.sha256((ASSETS/name).read_bytes()).hexdigest()==digest,name
    source=read_manifest(document);radius=plan['radius']
    profile={r['id']:r['points'] for r in json.loads((ASSETS/'izma-motorway-routes.json').read_text())['profiles']}
    routes=[{**r,'kind':'ring'} for r in plan['rings']]
    for site in plan['sites']:
        x,y=site['x'],site['y'];old=profile[f"band-{site['band']}-expressway"]
        low=y-OUTER-30 if site['index']!=0 else y-LOOP
        high=y+OUTER+30 if site['index']!=2 else y+LOOP
        count=math.ceil((high-low)/6)
        points=[[x,yy,at_axis(old,yy,1)[2]] for i in range(count+1) for yy in [low+(high-low)*i/count]]
        routes.append({'id':site['id']+'-mainline','kind':'mainline','width':24.,'deckThickness':2.4,
                       'points':points,'site':site['id']})
    routes.extend({**r,'site':s['id']} for s in plan['sites'] for r in s['movements'])
    priority={r['id']:i for i,r in enumerate(routes)};by_id={r['id']:r for r in routes}
    grid=defaultdict(list);sections={}

    def offset(points,i,lateral):
        if abs(points[-1][0]-points[0][0]-math.tau*radius)<.01:
            a=points[i-1] if i>0 else [points[-2][0]-math.tau*radius,*points[-2][1:]]
            b=points[i+1] if i<len(points)-1 else [points[1][0]+math.tau*radius,*points[1][1:]]
        else:a,b=points[max(0,i-1)],points[min(len(points)-1,i+1)]
        dx,dy=b[0]-a[0],b[1]-a[1];d=math.hypot(dx,dy);p=points[i]
        return (p[0]-dy/d*lateral,p[1]+dx/d*lateral,p[2])

    def cells(poly):
        for x in range(math.floor(min(p[0] for p in poly)/32),math.floor(max(p[0] for p in poly)/32)+1):
            for y in range(math.floor(min(p[1] for p in poly)/32),math.floor(max(p[1] for p in poly)/32)+1):yield x,y

    for route in routes:
        points=route['points'];half=route['width']/2
        cross=[(offset(points,i,-half),offset(points,i,half)) for i in range(len(points))]
        sections[route['id']]=cross
        for a,b in zip(cross,cross[1:]):
            poly=[a[0],b[0],b[1],a[1]]
            for cell in cells(poly):grid[cell].append((route['id'],poly))

    def neighbours(poly,rid,earlier=False,same_height=True):
        seen=set()
        for cell in cells(poly):
            for other,cutter in grid.get(cell,[]):
                if other==rid or id(cutter) in seen or earlier and priority[other]>=priority[rid]:continue
                seen.add(id(cutter))
                if max(p[0] for p in poly)<min(p[0] for p in cutter)-.02:continue
                if min(p[0] for p in poly)>max(p[0] for p in cutter)+.02:continue
                if max(p[1] for p in poly)<min(p[1] for p in cutter)-.02 or min(p[1] for p in poly)>max(p[1] for p in cutter)+.02:continue
                if same_height and (min(p[2] for p in poly)>max(p[2] for p in cutter)+.08 or max(p[2] for p in poly)<min(p[2] for p in cutter)-.08):continue
                yield other,cutter

    scene=bpy.data.scenes.new('SW_izma_junctions');bpy.context.window.scene=scene
    scene['owner']='spinward-izma-junctions-v1';scene['planSha256']=hashlib.sha256(path.read_bytes()).hexdigest()
    scene['status']='Candidate: native clearances, source replacement and runtime acceptance pending'
    scene.unit_settings.system='METRIC';scene.unit_settings.scale_length=1
    materials={}
    for name,color in MATERIALS.items():
        material=bpy.data.materials.new('SWJ_'+name);material.diffuse_color=tuple(int(color[i:i+2],16)/255 for i in [1,3,5])+(1,)
        material['spinward_material']='junction-'+name;materials[name]=material
    records=[];openings=[]

    def finish(builder,ident,role):
        p={'position':[0,0],'floor':0,'yaw':0,'id':ident,'district':'junctions','family':'infrastructure'}
        obj=builder.finish('SWJ_'+ident,p,-1);obj['junction_id']=ident;obj['role']=role
        obj['owner']=scene['owner'];obj['runtime_accepted']=False
        flag=obj.data.attributes.new('physical','BOOLEAN','FACE')
        for value,mat in zip(flag.data,builder.m):value.value=mat!='mark'
        records.append({'id':ident,'role':role,'vertices':len(obj.data.vertices),'faces':len(obj.data.polygons)})
        return obj

    def beam(builder,a,b,width,height,material):
        dx,dy=b[0]-a[0],b[1]-a[1];length=math.hypot(dx,dy)
        if length<1e-7:return
        nx,ny=-dy/length*width/2,dx/length*width/2
        v=[(p[0]+side*nx,p[1]+side*ny,p[2]+up) for p in [a,b] for up in [0,height] for side in [-1,1]]
        for f in [(0,4,6,2),(1,3,7,5),(2,6,7,3),(0,1,5,4)]:builder.face([v[i] for i in f],material)

    def spans(a,b,rid):
        result=[(0.,1.)]
        for _,cutter in neighbours([a,b],rid):
            cut=occupied_span(a,b,cutter,.28)
            if cut:
                lo,hi=cut
                result=[part for left,right in result for part in [(left,min(right,lo)),(max(left,hi),right)] if part[1]-part[0]>1e-6]
        return result

    for route in routes:
        rid=route['id'];points=route['points'];width=route['width'];thick=route['deckThickness']
        builder=BuildingMeshBuilder(scene,materials);cross=sections[rid];distance=0.
        for i,(a,b) in enumerate(zip(points,points[1:])):
            left,right=cross[i];next_left,next_right=cross[i+1]
            polygon=[left,next_left,next_right,right];pieces=[polygon]
            for _,cutter in neighbours(polygon,rid,True):
                pieces=[p for piece in pieces for p in subtract(piece,cutter)]
            for piece in pieces:builder.face(piece,'road',True)
            # Native slabs are solids with a closed underside. Co-planar
            # merged pavement above is owned by the earlier main carriageway.
            builder.face([(p[0],p[1],p[2]-thick) for p in reversed(polygon)],'structure')
            for side in [-1,1]:
                aa=offset(points,i,side*(width/2-.23));bb=offset(points,i+1,side*(width/2-.23))
                permitted=spans(aa,bb,rid)
                if permitted!=[(0.,1.)]:openings.append({'route':rid,'segment':i,'side':side})
                for lo,hi in permitted:
                    p=[aa[k]+(bb[k]-aa[k])*lo for k in range(3)];q=[aa[k]+(bb[k]-aa[k])*hi for k in range(3)]
                    beam(builder,p,q,.46,1.05,'rail')
                    beam(builder,[p[0],p[1],p[2]-thick],[q[0],q[1],q[2]-thick],.12,thick,'structure')
            if route['kind']!='ramp':beam(builder,a,b,.5,.95,'rail')
            if int(distance/12)%2==0:
                lanes=[-6,6] if route['kind']!='ramp' else []
                for lane in lanes:
                    pa=offset(points,i,lane-.06);pb=offset(points,i+1,lane-.06)
                    qa=offset(points,i,lane+.06);qb=offset(points,i+1,lane+.06)
                    builder.face([(p[0],p[1],p[2]+.015) for p in [pa,pb,qb,qa]],'mark')
            distance+=math.dist(a[:2],b[:2])
        finish(builder,rid,route['kind'])
        # Keep the authored directed centreline in the native file for
        # export/audit. It is not a procedural runtime reconstruction.
        mesh=bpy.data.meshes.new('SWJ_path_'+rid)
        mesh.from_pydata([(p[1],-p[0],p[2]) for p in points],[(i,i+1) for i in range(len(points)-1)],[])
        obj=bpy.data.objects.new(mesh.name,mesh);scene.collection.objects.link(obj)
        obj['owner']=scene['owner'];obj['role']='centreline';obj['junction_id']=rid;obj.hide_render=True

    def curved(p):
        x,y,h=p
        return (math.cos(x/radius)*(radius-h),y,math.sin(x/radius)*(radius-h))
    earth=[];body=[]
    for packed in [source['base'],*[v['fixed'] for v in source.values() if isinstance(v,dict) and 'fixed' in v]]:
        vertices=[curved(packed['vertices'][i:i+3]) for i in range(0,len(packed['vertices']),3)]
        earth.extend(vertices[i] for i in packed['meshes'].get('earth',[]))
        for material,indices in packed['meshes'].items():
            # Footings enter soil, verge and the paved end service reserve.
            # Retained roads, paths, railway and structural bodies remain
            # obstacles; a foundation must never stop on one of their roofs.
            if material not in ['earth','reserve','verge','water'] and 'lamp' not in material and 'mark' not in material:
                body.extend(vertices[i] for i in indices)
    def tree(v):return BVHTree.FromPolygons(v,[tuple(range(i,i+3)) for i in range(0,len(v),3)],all_triangles=True)
    earth_tree=tree(earth);body_tree=tree(body);del earth,body,source
    support_builder=BuildingMeshBuilder(scene,materials);supports=[];unsupported=[]

    def column_at(px,py,top,rid):
        soils=[]
        for dx,dy in [(-1.9,-1.9),(-1.9,1.9),(1.9,-1.9),(1.9,1.9),(0,0)]:
            x,y=px+dx,py+dy
            hit=earth_tree.ray_cast((0,y,0),(math.cos(x/radius),0,math.sin(x/radius)))[0]
            if hit:soils.append(radius-math.hypot(hit.x,hit.z))
        bottom=min(soils)-.3 if soils else -.3
        foundation_height=max(.5,max(soils)-bottom+.15) if soils else .5
        if top-bottom<1.:return None
        square=[(px+dx,py+dy,top) for dx,dy in [(-2,-2),(2,-2),(2,2),(-2,2)]]
        for other,cutter in neighbours(square,rid,same_height=False):
            if min(q[2] for q in cutter)<top+1. and max(q[2] for q in cutter)>bottom:
                if any(occupied_span(a,b,cutter,2) for a,b in zip(square,square[1:]+square[:1])):return None
        for dx,dy in [(-1.1,-1.1),(-1.1,1.1),(1.1,-1.1),(1.1,1.1),(0,0)]:
            x,y=px+dx,py+dy;origin=curved((x,y,top-.02))
            hit=body_tree.ray_cast(origin,(math.cos(x/radius),0,math.sin(x/radius)),top-bottom-.4)[0]
            if hit is not None:return None
        return {'position':[px,py,bottom],'top':top,'foundationHeight':foundation_height,'onHull':not soils}

    def clear_cap(a,b,top,rid):
        bottom=top-.9;dx,dy=b[0]-a[0],b[1]-a[1];d=math.hypot(dx,dy)
        nx,ny=-dy/d*1.5,dx/d*1.5
        polygon=[(p[0]+sign*nx,p[1]+sign*ny,top) for p,sign in [(a,-1),(b,-1),(b,1),(a,1)]]
        for other,cutter in neighbours(polygon,rid,same_height=False):
            if min(q[2] for q in cutter)-by_id[other]['deckThickness']<top and max(q[2] for q in cutter)>bottom:
                if any(occupied_span(p,q,cutter,.1) for p,q in zip(polygon,polygon[1:]+polygon[:1])):return False
        for lateral in [-1,0,1]:
            for h in [bottom+.05,top-.05]:
                start=curved((a[0]+nx*lateral,a[1]+ny*lateral,h));end=curved((b[0]+nx*lateral,b[1]+ny*lateral,h))
                distance=math.dist(start,end);direction=tuple((end[k]-start[k])/distance for k in range(3))
                if body_tree.ray_cast(start,direction,distance)[0] is not None:return False
        return True

    for route in routes:
        if route['kind']=='mainline':continue # Retained mainline piers are reused.
        along=stations(route['points']);locations=[]
        for intended in range(32,int(along[-1])-24,64):
            accepted=False
            for delta in [0,-8,8,-16,16,-24,24]:
                station=intended+delta
                if locations and station-locations[-1]<28:continue
                p=sample(route['points'],along,station);top=p[2]-route['deckThickness']
                centre=column_at(p[0],p[1],top,route['id']);columns=[centre] if centre else []
                if not centre:
                    # A parallel arterial beneath an end ring cannot be
                    # supported by columns in its carriageway. Span it with
                    # a portal on independently checked outboard foundations.
                    a=sample(route['points'],along,station-2);b=sample(route['points'],along,station+2)
                    dx,dy=b[0]-a[0],b[1]-a[1];d=math.hypot(dx,dy)
                    positions=[(p[0]-dy/d*side*22,p[1]+dx/d*side*22) for side in [-1,1]]
                    columns=[column_at(x,y,top-.9,route['id']) for x,y in positions]
                    if not all(columns) or not clear_cap(*positions,top,route['id']):continue
                    beam(support_builder,[*positions[0],top-.9],[*positions[1],top-.9],3.,.9,'structure')
                for column in columns:
                    x,y,bottom=column['position']
                    support_builder.box(x,y,bottom,3.8,3.8,column['foundationHeight'],'structure')
                    support_builder.box(x,y,bottom,2.,2.,column['top']-bottom,'structure')
                supports.append({'route':route['id'],'station':station,'kind':'single' if centre else 'portal',
                                 'columns':columns,'deckUnderside':top})
                locations.append(station);accepted=True;break
            if not accepted:unsupported.append({'route':route['id'],'station':intended})
    finish(support_builder,'supports','supports')
    wrapped=bpy.data.scenes.new('SW_izma_junctions_cylinder');wrapped['owner']=scene['owner']
    scene.view_layers[0].update()
    for obj in scene.objects:
        if obj.type!='MESH' or obj.get('role')=='centreline':continue
        mesh=obj.data.copy();copy=bpy.data.objects.new(obj.name+'_cylinder',mesh);wrapped.collection.objects.link(copy)
        for vertex,original in zip(mesh.vertices,obj.data.vertices):
            v=obj.matrix_world@original.co;vertex.co=curved((-v.y,v.x,v.z))
        copy['owner']=scene['owner'];copy['junction_id']=obj['junction_id'];copy['role']=obj['role']
    scene.view_layers[0].update();wrapped.view_layers[0].update()
    bpy.data.libraries.write(str(target),{scene,wrapped},fake_user=True,compress=True)
    report={'origin':'ai','created':'2026-09-21','sourceSha256':plan['sourceSha256'],
            'planSha256':scene['planSha256'],'nativeSha256':hashlib.sha256(target.read_bytes()).hexdigest(),
            'objects':records,'supports':supports,'unfilledSupportStations':unsupported,'openings':openings,
            'mainlinePatches':[r for r in routes if r['kind']=='mainline'],
            'status':'Uninstalled native candidate; support spans, barrier openings, source retirement and runtime verification remain.'}
    target.with_suffix('.json').write_text(json.dumps(report,separators=(',',':'))+'\n')
    return {'objects':len(records),'faces':sum(r['faces'] for r in records),'supports':len(supports),
            'unfilledSupportStations':len(unsupported),'openings':len(openings),'nativeSha256':report['nativeSha256']}


if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--candidate-root',type=Path,required=True)
    args=p.parse_args(sys.argv[sys.argv.index('--')+1:]);print(json.dumps(build(args.candidate_root)),flush=True)
