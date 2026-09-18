"""Author all 18 districts from the saved parcel positions and finished terrain.

Run in isolated Blender against izma-colony.blend. The separate output scene
contains one editable near and middle mesh per parcel; no GUI scene is changed.
Rebuilding replaces only this derived scene. export_izma_districts.py consumes
the saved meshes, not this recipe. Existing study interiors are untouched.
"""
import bpy, json, math, hashlib, sys
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parent))
from colony_manifest_io import read_manifest
from mathutils import Vector
from mathutils.bvhtree import BVHTree

def build(config=None):
    config=config or {}
    ROOT=Path(__file__).resolve().parents[2]
    sys.path.insert(0,str(ROOT/'assets/blender'))
    from izma_building_forms import building_form
    from izma_building_meshes import render_building
    PLAN=json.loads((ROOT/'assets/blender/izma-architecture-plan.json').read_text())
    PLAN['materials'].update(config.get('materials',{}))
    MASTER=json.loads((ROOT/'assets/blender/izma-colony-plan.json').read_text())
    BLOCKS=config.get('blocks',json.loads((ROOT/'assets/blender/izma-colony-blocks.json').read_text()))
    BASE=read_manifest(ROOT/'src/worlds/generated/izmaColony.json')
    TRANSPORT=json.loads((ROOT/'assets/blender/izma-transport.json').read_text())
    R=3200;SPACING=math.tau*R/3;OWNER=config.get('owner','spinward-izma-districts-v1')
    scene_name=config.get('scene','SW_izma_districts')
    output_stem=config.get('stem','izma-districts')
    contract_name=config.get('contract','izma-parcels.json')
    scene=bpy.data.scenes.get(scene_name)
    if scene:
        assert scene.get('owner')==OWNER
        for o in list(scene.objects):bpy.data.objects.remove(o,do_unlink=True)
        bpy.data.scenes.remove(scene)
    scene=bpy.data.scenes.new(scene_name);scene['owner']=OWNER
    bpy.context.window.scene=scene
    scene.unit_settings.system='METRIC';scene.unit_settings.scale_length=1
    materials={}
    for name,definition in PLAN['materials'].items():
        mat=bpy.data.materials.get('SWD_'+name) or bpy.data.materials.new('SWD_'+name)
        color=definition['color'];rgb=[int(color[i:i+2],16)/255 for i in [1,3,5]]
        mat.diffuse_color=tuple(rgb)+(1,);mat['srgb']=color;mat['definition']=json.dumps(definition)
        materials[name]=mat

    pool=BASE['base']['vertices'];vs=[]
    for i in BASE['base']['meshes']['earth']:
        x,y,h=pool[i*3:i*3+3];a=x/R;vs.append((math.cos(a)*(R-h),y,math.sin(a)*(R-h)))
    earth=BVHTree.FromPolygons(vs,[tuple(range(i,i+3)) for i in range(0,len(vs),3)],all_triangles=True)
    road_vs=[]
    for material in ['local','arterial','walk','verge']:
        for i in BASE['base']['meshes'].get(material,[]):
            x,y,h=pool[i*3:i*3+3];a=x/R;road_vs.append((math.cos(a)*(R-h),y,math.sin(a)*(R-h)))
    streets=BVHTree.FromPolygons(road_vs,[tuple(range(i,i+3))for i in range(0,len(road_vs),3)],all_triangles=True)
    terrain_hash=hashlib.sha256(json.dumps([pool,BASE['base']['meshes']['earth']],separators=(',',':')).encode()).hexdigest()
    def ground(x,y):
        a=x/R;p=earth.ray_cast(Vector((0,y,0)),Vector((math.cos(a),0,math.sin(a))))[0]
        if p is None:raise RuntimeError(('Parcel outside terrain',x,y))
        return R-math.hypot(p.x,p.z)
    def street_height(x,y):
        a=x/R;p=streets.ray_cast(Vector((0,y,0)),Vector((math.cos(a),0,math.sin(a))))[0]
        h=R-math.hypot(p.x,p.z) if p is not None else -10000
        return max(h,config['extraStreetHeight'](x,y)) if 'extraStreetHeight' in config else h
    def seed(text):return int.from_bytes(hashlib.sha256(text.encode()).digest()[:4],'big')
    def choose(weights,n):
        k=n%sum(weights.values())
        for key,weight in weights.items():
            k-=weight
            if k<0:return key
    def project(x,y,a,b):
        dx,dy=b[0]-a[0],b[1]-a[1];t=max(0,min(1,((x-a[0])*dx+(y-a[1])*dy)/max(.0001,dx*dx+dy*dy)))
        return (a[0]+dx*t,a[1]+dy*t,t)
    nodes={n['id']:n for n in MASTER['nodes']};segments=[[]for _ in range(3)]
    profiles={p['id']:p for p in TRANSPORT['profiles']}
    for route in MASTER['routes']:
        if route['kind'] not in ['arterial','local'] or route['id'] not in profiles:continue
        for aid,bid in zip(route['nodes'],route['nodes'][1:]):
            a,b=nodes[aid],nodes[bid]
            if a['band']==b['band']:segments[a['band']].append((a['xy'],b['xy'],route))
    def frontage(band,x,y,route_id=None):
        choices=[]
        for a,b,route in segments[band]:
            if route_id is not None and route['id']!=route_id:continue
            px,py,t=project(x,y,a,b);choices.append((math.hypot(x-px,y-py),px,py,route))
        _,px,py,route=min(choices,key=lambda a:a[0])
        best=None
        for a,b in zip(profiles[route['id']]['points'],profiles[route['id']]['points'][1:]):
            qx,qy,t=project(px,py,a,b);dist=math.hypot(px-qx,py-qy)
            if best is None or dist<best[0]:best=(dist,a[2]+(b[2]-a[2])*t)
        return px,py,best[1],route

    # A motorway approach may be tagged as an ordinary road in the transport
    # graph, but its elevated portion cannot provide a front door at ground level.
    # Retain the district/use and choose a vacant ground-level plot before drawing
    # architecture; do not hide a bad site behind an arbitrarily long stair.
    all_segments=[[] for _ in range(3)]
    for route in MASTER['routes']:
        for aid,bid in zip(route['nodes'],route['nodes'][1:]):
            a,b=nodes[aid],nodes[bid]
            if a['band']==b['band']:all_segments[a['band']].append((a['xy'],b['xy'],route))
    occupied={i:(b['band'],*b['position'][:2],math.hypot(*b['size'][:2])/2)for i,b in enumerate(BLOCKS)}
    districts={d['id']:d for d in MASTER['districts']}

    def site(band,lx,y,yaw,w,d,family):
        x=lx+band*SPACING;rx,ry,rh,route=frontage(band,lx,y);rx+=band*SPACING
        if abs(rh-ground(rx,ry))>2:return None
        if (rx-x)*(-math.sin(yaw))+(ry-y)*math.cos(yaw)>0:yaw+=math.pi
        c,s=math.cos(yaw),math.sin(yaw)
        def world(u,v):return (x+c*u-s*v,y+s*u+c*v)
        samples=[ground(*world(u*w/2,v*d/2))for u in [-1,0,1]for v in [-1,0,1]]
        floor=max(samples)+.14
        du=w*.18 if family=='civic' else (-w/2+1.5 if family=='warehouse' else 0)
        dv=-d*.3 if family=='apartment' else -d/2
        door=world(du,dv)
        # Offset doors meet the same street on its perpendicular, so their walks
        # stop at the pavement edge instead of cutting diagonally into a lane.
        rx,ry,rh,route=frontage(band,door[0]-band*SPACING,door[1],route['id']);rx+=band*SPACING
        if abs(rh-ground(rx,ry))>2:return None
        vx,vy=door[0]-rx,door[1]-ry;length=math.hypot(vx,vy);vx/=length;vy/=length
        edge=route['width']/2+(2.15 if route['width']>=10 else -.04)
        start=(rx+vx*edge,ry+vy*edge);end=(door[0]-vx*.02,door[1]-vy*.02)
        distance=math.dist(start,end)
        if length<edge+config.get('minimumApproach',2) or distance>40:return None
        path_width=1.9;steps=max(2,math.ceil(distance/.45));rows=[]
        for k in range(steps+1):
            t=k/steps;px=start[0]+(end[0]-start[0])*t;py=start[1]+(end[1]-start[1])*t
            sides=[(px-vy*path_width*side/2,py+vx*path_width*side/2)for side in [-1,1]]
            terrain=[ground(*p)for p in sides]
            required=max(max(terrain)+.04,max(street_height(*p)for p in sides)+.04)
            # Reach the exposed foundation apron before its outer retaining face;
            # otherwise a stair aiming only at the door tunnels through the plinth.
            local_u=c*(px-x)+s*(py-y);local_v=-s*(px-x)+c*(py-y)
            if abs(local_u)<w/2+.65 and abs(local_v)<d/2+.65:required=max(required,floor)
            rows.append([sides,required,terrain])
        start_h=rows[0][1]
        if abs(floor-start_h)/distance>.30 or rows[-1][1]>floor+.0001:return None
        required=[max(row[1],start_h+(floor-start_h)*k/steps)for k,row in enumerate(rows)]
        # Prefer a continuous 1:12 access ramp whenever its support envelope
        # reaches both endpoints. A short apron lip must not turn a whole gentle
        # approach into dozens of millimetre-high treads.
        def envelope(grade):return [max(h-grade*distance*abs(k-j)/steps for j,h in enumerate(required))for k in range(steps+1)]
        heights=envelope(1/12)
        stairs=heights[0]>start_h+.025 or heights[-1]>floor+.002
        if stairs:heights=envelope(.30)
        if heights[0]>start_h+.025 or heights[-1]>floor+.002:return None
        for row,h in zip(rows,heights):row[1]=h
        if not stairs:
            # Ramps need metre sampling; stairs need human-sized treads.
            count=max(2,math.ceil(distance/1.2));rows=[rows[round(k*steps/count)]for k in range(count+1)]
        return {'position':[x,y],'yaw':yaw,'samples':samples,'floor':floor,'frontage':[rx,ry,rh],
                'route':route,'rows':rows,'stairs':stairs,'start':start,'end':end,'distance':distance}

    def vacant(index,band,x,y,w,d,district):
        radius=math.hypot(w,d)/2;region=districts[district]
        if not region['axial'][0]+radius<y<region['axial'][1]-radius:return False
        if abs(x)+radius>R*math.pi/6-MASTER['edgeReserve']:return False
        if band==0 and abs(x)<350+radius and abs(y)<430+radius:return False
        for a,b in zip(MASTER['water'][band]['reach'],MASTER['water'][band]['reach'][1:]):
            if y<=b[1]:
                t=max(0,min(1,(y-a[1])/(b[1]-a[1])));river=a[0]+(b[0]-a[0])*t;break
        else:river=MASTER['water'][band]['reach'][-1][0]
        if abs(x-river)<MASTER['water'][band]['bankWidth']+radius:return False
        if any(i!=index and ob==band and math.hypot(x-ox,y-oy)<radius+pr+6 for i,(ob,ox,oy,pr)in occupied.items()):return False
        for a,b,route in all_segments[band]:
            px,py,_=project(x,y,a,b)
            if math.hypot(x-px,y-py)<route['width']/2+radius+5:return False
        return True

    def place(index,block,w,d,family):
        band=block['band'];lx,ly,_=block['position']
        original=site(band,lx,ly,block['yaw'],w,d,family)
        if original:return original
        candidates=[]
        radius=math.hypot(w,d)/2
        for a,b,route in segments[band]:
            length=math.dist(a,b);dx,dy=(b[0]-a[0])/length,(b[1]-a[1])/length
            # Half-cell shifts allow new parcels into the existing sparse rows.
            for k in range(1,math.ceil(length/24)):
                t=k/math.ceil(length/24);px=a[0]+(b[0]-a[0])*t;py=a[1]+(b[1]-a[1])*t
                if math.hypot(px-lx,py-ly)>2400:continue
                setback=route['width']/2+radius+7
                for side in [-1,1]:
                    x,y=px-dy*setback*side,py+dx*setback*side
                    if abs(y-ly)>2000:continue
                    candidates.append((math.hypot(x-lx,y-ly),x,y,math.atan2(dy,dx)))
        for _,x,y,yaw in sorted(candidates):
            if not vacant(index,band,x,y,w,d,block['district']):continue
            candidate=site(band,x,y,yaw,w,d,family)
            if candidate:
                occupied[index]=(band,x,y,radius);candidate['relocatedFrom']=[lx+band*SPACING,ly]
                return candidate
        raise RuntimeError(('No ground-level frontage in district',index,block['district']))

    from izma_mesh_builder import BuildingMeshBuilder
    def Builder():return BuildingMeshBuilder(scene,materials)

    if 'plan' in config:BLOCKS=config['plan'](locals())
    parcels=[];family_counts={};district_counts={};sampled_doors=[]
    for i,block in enumerate(BLOCKS):
        band=block['band'];lx,ly,_=block['position'];x=lx+band*SPACING;y=ly
        parcel_id=block.get('id',f"{block['district']}-{i:04d}");n=seed(parcel_id)
        family=block.get('family') or choose(PLAN['districts'][block['district']],n)
        ow,od,oh=block['size'];yaw=block['yaw']
        w=min(ow,9.2+(n%6)*.6) if family in ['house','farmhouse'] and not block.get('fixedSize') else ow
        d=min(od,15.5) if family in ['house','farmhouse','pavilion'] and not block.get('fixedSize') else od
        placement=place(i,block,w,d,family)
        if block.get('fixedSize'):assert 'relocatedFrom' not in placement,('Planned parcel lost its frontage',parcel_id)
        x,y=placement['position'];yaw=placement['yaw'];c,s=math.cos(yaw),math.sin(yaw)
        rx,ry,rh=placement['frontage'];route=placement['route']
        floors=max(1,round(oh/3.2))
        limits={'house':(2,3),'farmhouse':(2,2),'shop-house':(2,4),'apartment':(3,9),'office':(4,20),'civic':(2,6),'workshop':(2,4),'warehouse':(1,2),'pavilion':(1,1)}
        lo,hi=limits[family];floors=max(lo,min(hi,floors))
        if family=='house' and not block.get('fixedSize'):floors=3 if n%4==0 else 2
        floor_h=3.4 if family=='office' else (5.2 if family=='warehouse' else 3.2)
        height=floors*floor_h
        def world(u,v,h=0):return (x+c*u-s*v,y+s*u+c*v,h)
        # Sample perimeter and interior, not only a centre height with a fixed skirt.
        samples=placement['samples']
        floor=max(samples)+.14;bottom=min(samples)-.4
        wall=['wall-ivory','wall-grey','wall-ochre','wall-brick','wall-white','wall-sage'][(n//100)%6]
        roof=['roof-slate','roof-tile','roof-green'][(n//1000)%3]
        parcel={'id':parcel_id,'band':band,'district':block['district'],'family':family,'route':route['id'],
                'position':[x,y],'floor':floor,'foundationBottom':bottom,'groundSamples':samples,'size':[w,d,height],
                'yaw':yaw,'floors':floors,'wall':wall,'roof':roof,'proxyParts':[],'solids':[],'balconyGuards':[],
                'frontage':[rx,ry,rh],'doors':[]}
        if 'relocatedFrom' in placement:parcel['relocatedFrom']=placement['relocatedFrom']
        if 'lot' in block:parcel['lot']=block['lot']
        parcel['groundShop']=family=='shop-house' or (family=='apartment' and n%5==0)
        def part(u,v,z,pw,pd,ph,mat,shape='box'):
            parcel['proxyParts'].append([u,v,z,pw,pd,ph,mat,shape])
        part(0,0,bottom-floor,w+.5,d+.5,floor-bottom,'foundation')
        parcel['solids'].append([0,0,bottom-floor,w+.5,d+.5,floor-bottom])
        form,volumes,roofs=building_form(family,w,d,floors,floor_h,n,config.get('variedMassing',False))
        parcel['form']=form;parcel['volumes']=volumes
        for u,v,z,pw,pd,ph in volumes:
            part(u,v,z,pw,pd,ph,wall)
            parcel['solids'].append([u,v,bottom-floor,pw,pd,z+ph-(bottom-floor)])
        if family=='apartment':
            slab_y=d*.08-d*.76/2-.8
            for row in range(1,floors):
                z=row*floor_h
                part(0,slab_y,z-.16,w*.92,1.6,1.14,wall)
                parcel['balconyGuards'].append([0,slab_y,z,w*.92+.1,1.6,.98,.1])
        for u,v,z,pw,pd,ph,shape in roofs:part(u,v,z,pw,pd,ph,roof,shape)
        # Door is on the first volume's street-facing facade; civic courts stay open.
        main=volumes[0];du=main[0];dv=main[1]-main[4]/2
        if family=='warehouse':du=-w/2+1.5
        door=world(du,dv,floor);parcel['doors'].append(door)
        render_building(Builder,parcel,n,config)
        # A short independent frontage walk meets the existing road edge and the
        # real door level. Steep plots get treads, not a vertical apron floating at
        # the high corner of the building. The building remains closed for now.
        start,end=placement['start'],placement['end'];distance=placement['distance']
        path_width=1.9;stairs=placement['stairs'];rows=placement['rows']
        b=Builder()
        def local(p,h):
            dx,dy=p[0]-x,p[1]-y
            return (c*dx+s*dy,-s*dx+c*dy,h-floor)
        levels=[]
        for a,q in zip(rows,rows[1:]):
            h0,h1=(max(a[1],q[1]),)*2 if stairs else (a[1],q[1]);levels.append(h0)
            b.face([local(a[0][0],h0),local(a[0][1],h0),local(q[0][1],h1),local(q[0][0],h1)],'paving',True)
            if stairs and len(levels)>1 and abs(levels[-2]-h0)>.0001:
                b.face([local(a[0][0],levels[-2]),local(a[0][1],levels[-2]),local(a[0][1],h0),local(a[0][0],h0)],'foundation')
            for side in [0,1]:
                b.face([local(a[0][side],a[2][side]-.12),local(q[0][side],q[2][side]-.12),local(q[0][side],h1),local(a[0][side],h0)],'foundation')
            if stairs:b.face([local(a[0][0],a[1]-.15),local(a[0][1],a[1]-.15),local(a[0][1],h0),local(a[0][0],h0)],'foundation')
        b.finish(parcel_id+'_access',parcel,-1)
        parcel['access']={'start':[*start,rows[0][1]],'end':[*end,rows[-1][1]],'width':path_width,'stairs':stairs,
                          'maximumStep':max([abs(a-b)for a,b in zip(levels,levels[1:])]+[0]),'length':distance}
        parcels.append(parcel);family_counts[family]=family_counts.get(family,0)+1
        district_counts[block['district']]=district_counts.get(block['district'],0)+1

    scene['terrain_hash']=terrain_hash;scene['parcel_count']=len(parcels)
    scene.view_layers[0].update()
    bpy.data.libraries.write(str(ROOT/'assets/blender'/f'{output_stem}.blend'),{scene},fake_user=True,compress=True)
    target=ROOT/'assets/blender'/contract_name;target.write_text(json.dumps({'version':1,'terrainHash':terrain_hash,'materials':PLAN['materials'],'parcels':parcels},separators=(',',':'))+'\n')
    result={'parcels':len(parcels),'districts':district_counts,'families':family_counts,'stairs':sum(p['access']['stairs']for p in parcels),'relocated':sum('relocatedFrom'in p for p in parcels),'blendBytes':(ROOT/'assets/blender'/f'{output_stem}.blend').stat().st_size,'contractBytes':target.stat().st_size,'scope':'saved native-metre buildings, foundations and frontage walks; interiors remain closed'}

    return {'summary':result,'parcels':parcels,'scene':scene,'Builder':Builder,'ground':ground,'street_height':street_height}

if not globals().get("_DISTRICTS_LIBRARY",False):
    result=build()["summary"]
