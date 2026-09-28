"""Save editable IC design models in isolated unfolded and cylinder scenes.

This candidate is deliberately separate from the installed old T junctions.
Surface ownership, bridge supports and removal of the replaced source geometry
must be accepted before any runtime exporter may use it.
"""
import argparse
import hashlib
import json
import math
from pathlib import Path
import sys
import bpy

ASSETS = Path(__file__).resolve().parent
ROOT = ASSETS.parents[1]
sys.path.insert(0,str(ASSETS))
from izma_mesh_builder import BuildingMeshBuilder
from colony_manifest_io import read_manifest


def area(poly):
    return sum(a[0]*b[1]-b[0]*a[1] for a,b in zip(poly,poly[1:]+poly[:1]))


def halfplane(poly,a,b,inside):
    result=[]
    def signed(p):return (b[0]-a[0])*(p[1]-a[1])-(b[1]-a[1])*(p[0]-a[0])
    for p,q in zip(poly,poly[1:]+poly[:1]):
        dp,dq=signed(p),signed(q);ip=dp>=-1e-8 if inside else dp<=1e-8;iq=dq>=-1e-8 if inside else dq<=1e-8
        if ip:result.append(p)
        if ip!=iq:
            t=dp/(dp-dq);result.append(tuple(p[k]+(q[k]-p[k])*t for k in range(3)))
    return result


def subtract(poly,cutter):
    if area(cutter)<0:cutter=list(reversed(cutter))
    pieces=[];remaining=poly
    for a,b in zip(cutter,cutter[1:]+cutter[:1]):
        outside=halfplane(remaining,a,b,False)
        if len(outside)>2 and abs(area(outside))>1e-7:pieces.append(outside)
        remaining=halfplane(remaining,a,b,True)
        if len(remaining)<3 or abs(area(remaining))<1e-7:break
    return pieces


def occupied_span(a,b,poly,margin=.01):
    if area(poly)<0:poly=list(reversed(poly))
    low,high=0.,1.
    for p,q in zip(poly,poly[1:]+poly[:1]):
        dx,dy=q[0]-p[0],q[1]-p[1];pad=margin*math.hypot(dx,dy)
        da=dx*(a[1]-p[1])-dy*(a[0]-p[0])+pad
        db=dx*(b[1]-p[1])-dy*(b[0]-p[0])+pad
        if da<0 and db<0:return None
        if da<0:low=max(low,da/(da-db))
        if db<0:high=min(high,da/(da-db))
        if low>=high:return None
    return low,high


def build(candidate):
    from mathutils.bvhtree import BVHTree
    if not candidate.is_absolute() or candidate.resolve()==ROOT:
        raise ValueError('Use an isolated candidate root')
    path=candidate/'assets/blender/izma-motorway-plan.json'
    plan=json.loads(path.read_text());assert not plan['failures']
    target=path.with_name('izma-motorway.blend')
    if target.exists():raise ValueError('Preserve existing native candidates')
    source=read_manifest(ROOT/'src/worlds/generated/izmaColony.json')
    assert json.loads((ROOT/'src/worlds/generated/izmaColony.json').read_text())['sourceSha256']==plan['sourceSha256']
    radius=plan['radius'];base=source['base']
    earth=[base['vertices'][i*3:i*3+3] for i in base['meshes']['earth']]
    wrapped=[(math.cos(x/radius)*(radius-h),y,math.sin(x/radius)*(radius-h)) for x,y,h in earth]
    tree=BVHTree.FromPolygons(wrapped,[tuple(range(i,i+3)) for i in range(0,len(wrapped),3)],all_triangles=True)

    def ground(x,y):
        hit=tree.ray_cast((0,y,0),(math.cos(x/radius),0,math.sin(x/radius)))[0]
        if hit is None:raise ValueError(('No earth below support',x,y))
        return radius-math.hypot(hit.x,hit.z)

    scene=bpy.data.scenes.new('SW_izma_motorway');bpy.context.window.scene=scene
    scene['owner']='spinward-izma-motorway-design-v1'
    scene['status']='Design candidate; not accepted for runtime export'
    scene['planSha256']=hashlib.sha256(path.read_bytes()).hexdigest()
    scene.unit_settings.system='METRIC';scene.unit_settings.scale_length=1
    materials={}
    for name,color in {'road':'#676c69','walk':'#b0ac9b','structure':'#969b96','rail':'#737d79','mark':'#d5cdb8'}.items():
        mat=bpy.data.materials.new('SWM_'+name)
        mat.diffuse_color=tuple(int(color[i:i+2],16)/255 for i in [1,3,5])+(1,)
        mat['spinward_material']='motorway-'+name;materials[name]=mat
    records=[];supports=[];guards=[]

    def offset(points,i,side):
        a,b=points[max(0,i-1)],points[min(len(points)-1,i+1)]
        dx,dy=b[0]-a[0],b[1]-a[1];length=math.hypot(dx,dy)
        p=points[i]
        return (p[0]-dy/length*side,p[1]+dx/length*side,p[2])

    def beam(builder,a,b,width,height,material):
        dx,dy=b[0]-a[0],b[1]-a[1];length=math.hypot(dx,dy)
        if length<1e-7:return
        nx,ny=-dy/length*width/2,dx/length*width/2
        vs=[(p[0]+s*nx,p[1]+s*ny,p[2]+z) for p in [a,b] for z in [0,height] for s in [-1,1]]
        for face in [(0,4,6,2),(1,3,7,5),(2,6,7,3),(0,1,5,4),(0,2,3,1),(4,5,7,6)]:
            builder.face([vs[i] for i in face],material)

    def finish(builder,ic,role):
        parcel={'position':[0,0],'floor':0,'yaw':0,'id':ic['id']+'-'+role,'district':ic['id'],'family':'infrastructure'}
        obj=builder.finish('SWM_'+parcel['id'],parcel,-1)
        obj['owner']=scene['owner'];obj['motorway_id']=ic['id'];obj['role']=role
        obj['runtime_accepted']=False
        physical=obj.data.attributes.new('physical','BOOLEAN','FACE')
        for item,material in zip(physical.data,builder.m):item.value=material!='mark'
        records.append({'id':obj.name,'vertices':len(obj.data.vertices),'faces':len(obj.data.polygons)})
        return obj

    for ic in plan['interchanges']:
        roads=[{'id':ic['id']+'-mainline','kind':'expressway','width':24.,'footway':0.,'points':ic['mainline']},*ic['roads']]
        grid={};opening_grid={};cross_sections={};polygons={};priority={r['id']:i for i,r in enumerate(roads)}
        for road in roads:
            points=road['points'];width=road['width']
            sides=[(offset(points,i,-width/2),offset(points,i,width/2)) for i in range(len(points))]
            cross_sections[road['id']]=sides
            polygons[road['id']]=[[a[0],b[0],b[1],a[1]] for a,b in zip(sides,sides[1:])]
            for poly in polygons[road['id']]:
                for gx in range(math.floor(min(p[0] for p in poly)/32),math.floor(max(p[0] for p in poly)/32)+1):
                    for gy in range(math.floor(min(p[1] for p in poly)/32),math.floor(max(p[1] for p in poly)/32)+1):
                        grid.setdefault((gx,gy),[]).append((road['id'],poly))
            extent=width/2+road['footway']
            clear_sides=[(offset(points,i,-extent),offset(points,i,extent)) for i in range(len(points))]
            for a,b in zip(clear_sides,clear_sides[1:]):
                poly=[a[0],b[0],b[1],a[1]]
                for gx in range(math.floor(min(p[0] for p in poly)/32),math.floor(max(p[0] for p in poly)/32)+1):
                    for gy in range(math.floor(min(p[1] for p in poly)/32),math.floor(max(p[1] for p in poly)/32)+1):
                        opening_grid.setdefault((gx,gy),[]).append((road['id'],poly))

        def neighbours(poly,rid,earlier=False,walk_clearance=False):
            seen=set();xs=[p[0] for p in poly];ys=[p[1] for p in poly];zs=[p[2] for p in poly]
            search=opening_grid if walk_clearance else grid
            for gx in range(math.floor(min(xs)/32),math.floor(max(xs)/32)+1):
                for gy in range(math.floor(min(ys)/32),math.floor(max(ys)/32)+1):
                    for other,cutter in search.get((gx,gy),[]):
                        if other==rid or id(cutter) in seen or earlier and priority[other]>=priority[rid]:continue
                        seen.add(id(cutter))
                        if min(xs)>max(p[0] for p in cutter)+.01 or max(xs)<min(p[0] for p in cutter)-.01:continue
                        if min(ys)>max(p[1] for p in cutter)+.01 or max(ys)<min(p[1] for p in cutter)-.01:continue
                        if min(zs)>max(p[2] for p in cutter)+.6 or max(zs)<min(p[2] for p in cutter)-.6:continue
                        yield cutter

        def pavement(builder,poly,rid,material,earlier=False):
            pieces=[poly]
            for cutter in neighbours(poly,rid,earlier):
                pieces=[p for piece in pieces for p in subtract(piece,cutter)]
                if not pieces:break
            for piece in pieces:builder.face(piece,material,material!='mark')

        def outside_spans(a,b,rid,margin=.01):
            spans=[(0.,1.)]
            for cutter in neighbours([a,b],rid,walk_clearance=True):
                cut=occupied_span(a,b,cutter,margin=margin)
                if cut:
                    low,high=cut
                    spans=[part for lo,hi in spans for part in [(lo,min(hi,low)),(max(lo,high),hi)] if part[1]-part[0]>1e-6]
            return spans

        for road in roads:
            builder=BuildingMeshBuilder(scene,materials);points=road['points']
            width=road['width'];walk=road['footway'];thickness=2.4 if road['kind']=='expressway' else .9
            sides=cross_sections[road['id']]
            along=0.;next_support=48.
            for i,(a,b) in enumerate(zip(points,points[1:])):
                lo,hi=sides[i];nlo,nhi=sides[i+1]
                pavement(builder,[lo,nlo,nhi,hi],road['id'],'road',True)
                builder.face([(p[0],p[1],p[2]-thickness) for p in [hi,nhi,nlo,lo]],'structure')
                for side,pa,pb in [(-1,lo,nlo),(1,hi,nhi)]:
                    bottom_a=min(pa[2]-thickness,ground(*pa[:2])-.03) if road['kind']=='arterial' else pa[2]-thickness
                    bottom_b=min(pb[2]-thickness,ground(*pb[:2])-.03) if road['kind']=='arterial' else pb[2]-thickness
                    for start,end in outside_spans(pa,pb,road['id']):
                        p=tuple(pa[k]+(pb[k]-pa[k])*start for k in range(3));q=tuple(pa[k]+(pb[k]-pa[k])*end for k in range(3))
                        pz=bottom_a+(bottom_b-bottom_a)*start;qz=bottom_a+(bottom_b-bottom_a)*end
                        builder.face([p,q,(q[0],q[1],qz),(p[0],p[1],pz)],'structure')
                    if walk:
                        oa=offset(points,i,side*(width/2+walk));ob=offset(points,i+1,side*(width/2+walk))
                        pavement(builder,[(p[0],p[1],p[2]+.14) for p in [pa,pb,ob,oa]],road['id'],'walk')
                    rail_a=offset(points,i,side*(width/2+walk-.18))
                    rail_b=offset(points,i+1,side*(width/2+walk-.18))
                    elevated=road['kind']!='arterial' or min(rail_a[2]-ground(*rail_a[:2]),rail_b[2]-ground(*rail_b[:2]))>1.4
                    if elevated:
                        rail_a=(*rail_a[:2],rail_a[2]+(.14 if walk else 0))
                        rail_b=(*rail_b[:2],rail_b[2]+(.14 if walk else 0))
                        # Cut beyond the rail centreline so its 28 cm solid
                        # width cannot protrude back into the far footway tip.
                        for start,end in outside_spans(rail_a,rail_b,road['id'],margin=.2):
                            if (end-start)*math.dist(rail_a[:2],rail_b[:2])<.08:continue
                            p=tuple(rail_a[k]+(rail_b[k]-rail_a[k])*start for k in range(3))
                            q=tuple(rail_a[k]+(rail_b[k]-rail_a[k])*end for k in range(3))
                            beam(builder,p,q,.28,1.05,'rail')
                            guards.append({'ic':ic['id'],'road':road['id'],'start':p,'end':q})
                length=math.dist(a[:2],b[:2]);along+=length
                if road['kind']=='expressway':
                    # Keep the median visible in the design model. The final
                    # integration must preserve it through every merge.
                    beam(builder,a[:3],b[:3],.7,.8,'rail')
                # The outer portion of the 24 m mainline remains a hard
                # shoulder through the merge; two 3.5 m lanes per carriageway.
                stripes=[(s*v,v==4.25) for s in [-1,1] for v in [.75,4.25,7.75]] if road['kind']=='expressway' else [(s*(width/2-.45),False) for s in [-1,1]]
                if road['kind']=='arterial':stripes.append((0,True))
                at_junction=road['kind']=='ramp' and along<=32
                if road['kind']=='arterial':
                    at_junction=any(math.dist(a[:2],j['position'])<30 or math.dist(b[:2],j['position'])<30 for j in ic['junctionPlateaus'])
                if not at_junction:
                    for lateral,broken in stripes:
                        start=along-length;station=start
                        while station<along-1e-7:
                            stop=min(along,(math.floor(station/4)+1)*4)
                            if not broken or math.floor(station/4)%2==0:
                                corners=[]
                                for fraction,edge in [((station-start)/length,-.065),((stop-start)/length,-.065),((stop-start)/length,.065),((station-start)/length,.065)]:
                                    ca=offset(points,i,lateral+edge);cb=offset(points,i+1,lateral+edge)
                                    corners.append(tuple(ca[k]+(cb[k]-ca[k])*fraction+(.018 if k==2 else 0) for k in range(3)))
                                pavement(builder,corners,road['id'],'mark')
                            station=stop
                if road['kind']=='arterial' or along<next_support:continue
                next_support=along+48
                px,py,h=a[:3]
                common=ic['roads'][0]['points'];first,last=common[0],common[-1]
                dx,dy=last[0]-first[0],last[1]-first[1];norm=dx*dx+dy*dy
                t=max(0,min(1,((px-first[0])*dx+(py-first[1])*dy)/norm))
                if math.hypot(px-first[0]-t*dx,py-first[1]-t*dy)<20:continue
                if road['kind']=='ramp' and abs(px-ic['node'][0])<17:continue
                foot=min(ground(px+dx,py+dy) for dx in [-1.6,1.6] for dy in [-1.6,1.6])-.2
                top=h-thickness
                if top-foot<1.2:continue
                builder.box(px,py,foot,3.2,3.2,.35,'structure')
                builder.box(px,py,foot,1.6,1.6,top-foot,'structure')
                supports.append({'ic':ic['id'],'road':road['id'],'position':[px,py,foot],'top':top})
            finish(builder,ic,road['id'])
    cylinder=bpy.data.scenes.new('SW_izma_motorway_cylinder');cylinder['owner']=scene['owner']
    scene.view_layers[0].update()
    for obj in scene.objects:
        if obj.type!='MESH':continue
        mesh=obj.data.copy();copy=bpy.data.objects.new(obj.name+'_cylinder',mesh);cylinder.collection.objects.link(copy)
        for vertex,original in zip(mesh.vertices,obj.data.vertices):
            v=obj.matrix_world@original.co;x,y,h=-v.y,v.x,v.z;a=x/radius
            vertex.co=(math.cos(a)*(radius-h),y,math.sin(a)*(radius-h))
        copy['owner']=scene['owner'];copy['motorway_id']=obj['motorway_id'];copy['runtime_accepted']=False
    cylinder.view_layers[0].update()
    bpy.data.libraries.write(str(target),{scene,cylinder},fake_user=True,compress=True)
    report={'origin':'ai','created':'2026-09-20','owner':scene['owner'],'status':scene['status'],
        'nativeSha256':hashlib.sha256(target.read_bytes()).hexdigest(),'planSha256':scene['planSha256'],
        'objects':records,'supports':supports,'guards':guards,
        'materials':{name:'#'+''.join(f'{round(channel*255):02x}' for channel in material.diffuse_color[:3]) for name,material in materials.items()},
        'remaining':['verify common-road and ramp clipped surfaces','verify merge and junction side-wall openings',
                     'support and other-road clearance','replacement of old T junctions in base',
                     'runtime export, LOD, collision and actual XR validation']}
    target.with_suffix('.json').write_text(json.dumps(report,indent=2)+'\n')
    print(json.dumps({'objects':len(records),'vertices':sum(r['vertices'] for r in records),
                      'supports':len(supports),'guards':len(guards),'native':str(target),'status':report['status']}),flush=True)


if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--candidate-root',type=Path,required=True)
    args=parser.parse_args(sys.argv[sys.argv.index('--')+1:]);build(args.candidate_root)
