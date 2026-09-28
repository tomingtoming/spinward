"""Build the authored end-ring decks, pedestrian margins and supported lamps.

Both the unfolded and cylindrical meshes are saved. Collision face flags are
on the native source; the application never reconstructs the bridge from lines.
"""
import argparse
import bisect
import hashlib
import json
import math
from pathlib import Path
import sys
import bpy

ASSETS=Path(__file__).resolve().parent
sys.path.insert(0,str(ASSETS))
from izma_mesh_builder import BuildingMeshBuilder

MATERIALS={'road':'#686e6b','walk':'#b0ac9b','structure':'#929b96',
           'kerb':'#c2bdaa','rail':'#667776','mark':'#ccc6ad','lamp':'#d4d1b6'}


def build(candidate):
    if not candidate.is_absolute() or candidate.resolve()==ASSETS.parents[1]:
        raise ValueError('Use a separate absolute candidate root')
    plan_path=candidate/'assets/blender/izma-interband-plan.json'
    plan=json.loads(plan_path.read_text());radius=plan['radius']
    for name,h in plan['dependencies'].items():
        assert hashlib.sha256((ASSETS/name).read_bytes()).hexdigest()==h
    scene=bpy.data.scenes.new('SW_izma_interband');bpy.context.window.scene=scene
    scene['owner']='spinward-izma-interband-v1';scene['planSha256']=hashlib.sha256(plan_path.read_bytes()).hexdigest()
    scene.unit_settings.system='METRIC';scene.unit_settings.scale_length=1
    materials={}
    for name,color in MATERIALS.items():
        material=bpy.data.materials.new('SWI_'+name)
        material.diffuse_color=tuple(int(color[i:i+2],16)/255 for i in [1,3,5])+(1,)
        material['spinward_material']='interband-'+name;materials[name]=material
    lights=[];records=[]

    def finish(builder,ident):
        parcel={'position':[0,0],'floor':0,'yaw':0,'id':ident,'district':'interband','family':'infrastructure'}
        obj=builder.finish('SWI_'+ident,parcel,-1)
        obj['interband_id']=ident;obj['owner']=scene['owner']
        physical=obj.data.attributes.new('physical','BOOLEAN','FACE')
        for item,material in zip(physical.data,builder.m):item.value=material not in ['mark','lamp']
        records.append({'id':ident,'vertices':len(obj.data.vertices),'faces':len(obj.data.polygons)})
        return obj

    def beam(builder,a,b,width,height,material,top=True,bottom=True):
        dx,dy=b[0]-a[0],b[1]-a[1];length=math.hypot(dx,dy)
        if length<1e-7:return
        nx,ny=-dy/length*width/2,dx/length*width/2
        v=[(p[0]+side*nx,p[1]+side*ny,p[2]+z)
           for p in [a,b] for z in [0,height] for side in [-1,1]]
        faces=[(0,4,6,2),(1,3,7,5)]
        if top:faces.append((2,6,7,3))
        if bottom:faces.append((0,1,5,4))
        for f in faces:builder.face([v[i] for i in f],material)

    def interpolate(profile,value,axis):
        # All ring x coordinates increase; approach y may decrease.
        direction=1 if profile[-1][axis]>profile[0][axis] else -1
        coordinates=[p[axis]*direction for p in profile]
        j=min(len(profile)-2,max(0,bisect.bisect_right(coordinates,value*direction)-1))
        a,b=profile[j:j+2];t=(value-a[axis])/(b[axis]-a[axis])
        return [a[k]+(b[k]-a[k])*t for k in range(3)]

    def lamp(builder,ident,x,y,floor):
        builder.box(x,y,floor,.6,.6,.18,'structure')
        builder.box(x,y,floor+.18,.13,.13,6.22,'rail')
        builder.box(x,y,floor+6.3,.62,.46,.13,'lamp')
        builder.box(x,y,floor+6.43,.72,.54,.1,'rail')
        data=bpy.data.lights.new('SWI_lamp_'+str(len(lights)),'POINT')
        data.energy=360;data.color=(1,.9,.73)
        obj=bpy.data.objects.new(data.name,data);scene.collection.objects.link(obj)
        obj.location=(y,-x,floor+6.27);obj['color']='#ffe5b9';obj['intensity']=360.;obj['distance']=44.
        obj['interband_id']=ident;obj['owner']=scene['owner']
        lights.append({'position':[x,y,floor+6.27],'color':'#ffe5b9','intensity':360,'distance':44})

    for ring in plan['rings']:
        builder=BuildingMeshBuilder(scene,materials);p=ring['profile'];y=ring['axial'];sign=ring['sign']
        gates=[g for g in plan['approaches'] if g['id'] in ring['gates']]
        breaks=set(v[0] for v in p)
        for gate in gates:
            for offset in [-12.4,-12.2,-10,10,12.2,12.4]:breaks.add(gate['x']+offset)
        positions=[interpolate(p,x,0) for x in sorted(breaks)]
        for a,b in zip(positions,positions[1:]):
            xa,_,ha=a;xb,_,hb=b;middle=(xa+xb)/2
            builder.quad((xa,y-8,ha),(xb,y-8,hb),(xb,y+8,hb),(xa,y+8,ha),'road',True)
            beam(builder,[xa,y,ha-1.2],[xb,y,hb-1.2],26.8,1.2,'structure',False)
            for side in [-1,1]:
                inner=side==-sign
                in_mouth=any(abs(middle-g['x'])<10-1e-5 for g in gates)
                if not (inner and in_mouth):
                    lo,hi=sorted([y+side*8,y+side*13.4])
                    builder.quad((xa,lo,ha+.14),(xb,lo,hb+.14),(xb,hi,hb+.14),(xa,hi,ha+.14),'walk',True)
                    builder.face([(xa,y+side*8,ha),(xb,y+side*8,hb),(xb,y+side*8,hb+.14),(xa,y+side*8,ha+.14)],'kerb')
                in_opening=any(abs(middle-g['x'])<12.4-1e-5 for g in gates)
                if not (inner and in_opening):
                    beam(builder,[xa,y+side*13.24,ha+.14],[xb,y+side*13.24,hb+.14],.32,1.1,'rail')
            # Painted centre marks use a small physical offset and have no collider.
            if math.floor((middle-p[0][0])/8)%2==0:
                builder.quad((xa,y-.08,ha+.012),(xb,y-.08,hb+.012),(xb,y+.08,hb+.012),(xa,y+.08,ha+.012),'mark')
        # Alternating fixtures every 24 m keep both walking edges within reach.
        # The native fixture positions still share the runtime's six-light pool.
        for i,point in enumerate(p[3:-3:3]):
            x,_,h=point;side=1 if i%2 else -1
            if any(abs(x-g['x'])<24 for g in gates):continue
            lamp(builder,ring['id'],x,y+side*12.4,h+.14)
        # The unrolled boundary is another ordinary span on the closed ring.
        # Its missing station would otherwise double the 24 m light spacing.
        x,_,h=p[0]
        lamp(builder,ring['id'],x,y+12.4,h+.14)
        for gate in gates:
            for dx,side in [(0,sign),(-16,-sign),(16,-sign)]:
                x=gate['x']+dx;h=interpolate(p,x,0)[2]
                lamp(builder,ring['id'],x,y+side*12.4,h+.14)
        finish(builder,ring['id'])

    for gate in plan['approaches']:
        builder=BuildingMeshBuilder(scene,materials);p=gate['profile'];x=gate['x']
        ring=next(r for r in plan['rings'] if gate['id'] in r['gates']);sign=ring['sign']
        foot_end=ring['axial']-sign*13.4
        breaks=sorted(set([v[1] for v in p]+[foot_end]),reverse=sign<0)
        positions=[interpolate(p,y,1) for y in breaks]
        for a,b in zip(positions,positions[1:]):
            _,ya,ha=a;_,yb,hb=b;middle=(ya+yb)/2
            builder.quad((x-10,ya,ha),(x+10,ya,ha),(x+10,yb,hb),(x-10,yb,hb),'road',True)
            beam(builder,[x,ya,ha-1.2],[x,yb,hb-1.2],24.4,1.2,'structure',False)
            for side in [-1,1]:
                if sign*(middle-foot_end)<0:
                    lo,hi=sorted([x+side*10,x+side*12.2])
                    builder.quad((lo,ya,ha+.14),(hi,ya,ha+.14),(hi,yb,hb+.14),(lo,yb,hb+.14),'walk',True)
                    builder.face([(x+side*10,ya,ha),(x+side*10,yb,hb),(x+side*10,yb,hb+.14),(x+side*10,ya,ha+.14)],'kerb')
                    if abs(middle-p[0][1])>22:
                        beam(builder,[x+side*12.04,ya,ha+.14],[x+side*12.04,yb,hb+.14],.32,1.1,'rail')
        for i,point in enumerate(p[5:-5:3]):
            _,y,h=point;side=1 if i%2 else -1
            lamp(builder,gate['id'],x+side*11.1,y,h+.14)
        finish(builder,gate['id'])

    supports=BuildingMeshBuilder(scene,materials)
    for support in plan['supports']:
        x,y,h=support['position'];height=support['height']
        supports.box(x,y,h,3.2,3.2,.35,'structure')
        supports.box(x,y,h,1.6,1.6,height,'structure')
    finish(supports,'supports')

    wrapped=bpy.data.scenes.new('SW_izma_interband_cylinder');wrapped['owner']=scene['owner']
    wrapped.unit_settings.system='METRIC';wrapped.unit_settings.scale_length=1
    scene.view_layers[0].update()
    for obj in scene.objects:
        if obj.type!='MESH':continue
        mesh=obj.data.copy();copy=bpy.data.objects.new(obj.name+'_cylinder',mesh);wrapped.collection.objects.link(copy)
        for vertex,original in zip(mesh.vertices,obj.data.vertices):
            v=obj.matrix_world @ original.co;x,y,h=-v.y,v.x,v.z;a=x/radius
            vertex.co=(math.cos(a)*(radius-h),y,math.sin(a)*(radius-h))
        copy['owner']=scene['owner'];copy['interband_id']=obj['interband_id']
    scene.view_layers[0].update();wrapped.view_layers[0].update()
    output=plan_path.with_name('izma-interband.blend')
    bpy.data.libraries.write(str(output),{scene,wrapped},fake_user=True,compress=True)
    report={'version':1,'origin':'ai','created':'2026-09-20','owner':scene['owner'],
            'planSha256':scene['planSha256'],'nativeSha256':hashlib.sha256(output.read_bytes()).hexdigest(),
            'objects':records,'supportedLights':len(lights),'supports':len(plan['supports']),
            'materials':MATERIALS,'scope':'two general-traffic end rings and six existing-road approaches; motorway/central structures pending'}
    output.with_suffix('.json').write_text(json.dumps(report,indent=2)+'\n')
    print(json.dumps(report),flush=True)


if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--candidate-root',type=Path,required=True)
    args=parser.parse_args(sys.argv[sys.argv.index('--')+1:]);build(args.candidate_root)
