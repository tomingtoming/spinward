"""Author all 18 districts from the saved parcel positions and finished terrain.

Run in isolated Blender against izma-colony.blend. The separate output scene
contains one editable near and middle mesh per parcel; no GUI scene is changed.
Rebuilding replaces only this derived scene. export_izma_districts.py consumes
the saved meshes, not this recipe. Existing study interiors are untouched.
"""
import bpy, json, math, hashlib
from pathlib import Path
from mathutils import Vector
from mathutils.bvhtree import BVHTree

def build(config=None):
    config=config or {}
    ROOT=Path(__file__).resolve().parents[2]
    PLAN=json.loads((ROOT/'assets/blender/izma-architecture-plan.json').read_text())
    PLAN['materials'].update(config.get('materials',{}))
    MASTER=json.loads((ROOT/'assets/blender/izma-colony-plan.json').read_text())
    BLOCKS=config.get('blocks',json.loads((ROOT/'assets/blender/izma-colony-blocks.json').read_text()))
    BASE=json.loads((ROOT/'src/worlds/generated/izmaColony.json').read_text())
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

    class Builder:
        def __init__(self):self.v=[];self.f=[];self.m=[];self.g=[]
        def face(self,points,mat,floor=False):
            n=len(self.v);self.v.extend(points);self.f.append(tuple(range(n,n+len(points))));self.m.append(mat)
            self.g.append(floor)
        def quad(self,a,b,c,d,mat,floor=False):
            # At R=3200, a 12 m chord sags less than 6 mm. Share that
            # tessellation between drawing and collision instead of over-sampling roofs.
            count=max(1,math.ceil(max(math.dist(a,b),math.dist(c,d))/12))
            for i in range(count):
                def lerp(p,q,t):return tuple(p[k]+(q[k]-p[k])*t for k in range(3))
                self.face([lerp(a,b,i/count),lerp(a,b,(i+1)/count),lerp(d,c,(i+1)/count),lerp(d,c,i/count)],mat,floor)
        def box(self,x,y,z,w,d,h,mat,roof=False,cap=True):
            if min(w,d,h)<=0:return
            a,b=x-w/2,x+w/2;c,e=y-d/2,y+d/2;t=z+h
            self.quad((a,c,z),(b,c,z),(b,c,t),(a,c,t),mat)
            self.quad((b,e,z),(a,e,z),(a,e,t),(b,e,t),mat)
            self.quad((a,e,z),(a,c,z),(a,c,t),(a,e,t),mat)
            self.quad((b,c,z),(b,e,z),(b,e,t),(b,c,t),mat)
            if not cap:return
            # Cross-split the top so a large pad follows the same mesh in all uses.
            rows=max(1,math.ceil(d/12))
            for i in range(rows):
                y0=c+d*i/rows;y1=c+d*(i+1)/rows
                self.quad((a,y0,t),(b,y0,t),(b,y1,t),(a,y1,t),mat,roof)
        def gable(self,x,y,z,w,d,h,mat):
            a,b=x-w/2,x+w/2;c,e=y-d/2,y+d/2
            rows=max(1,math.ceil(d/12))
            for i in range(rows):
                y0=c+d*i/rows;y1=c+d*(i+1)/rows
                self.quad((a,y0,z),(x,y0,z+h),(x,y1,z+h),(a,y1,z),mat,True)
                self.quad((x,y0,z+h),(b,y0,z),(b,y1,z),(x,y1,z+h),mat,True)
            self.face([(a,c,z),(b,c,z),(x,c,z+h)],mat)
            self.face([(b,e,z),(a,e,z),(x,e,z+h)],mat)
        def finish(self,name,parcel,lod):
            data=bpy.data.meshes.new(name);data.from_pydata(self.v,[],self.f);data.update()
            used=sorted(set(self.m))
            for material in used:data.materials.append(materials[material])
            lookup={m:i for i,m in enumerate(used)}
            for p,m in zip(data.polygons,self.m):p.material_index=lookup[m]
            ground_faces=data.attributes.new('ground_surface','BOOLEAN','FACE')
            for value,flag in zip(ground_faces.data,self.g):value.value=flag
            obj=bpy.data.objects.new(name,data);scene.collection.objects.link(obj)
            obj.location=(parcel['position'][1],-parcel['position'][0],parcel['floor'])
            obj.rotation_euler.z=parcel['yaw']-math.pi/2
            obj['parcel_id']=parcel['id'];obj['lod']=lod;obj['district']=parcel['district']
            obj['family']=parcel['family'];obj.hide_render=lod==1
            return obj

    def facade(builder,x,y,z,w,d,floors,kind,n,lod,wall,balcony=False,ground_shop=False):
        office=kind=='office';floor_h=3.4 if office else 3.2
        for side in range(4):
            span=w if side<2 else d;depth=d/2 if side<2 else w/2
            pitch=[2.8,3.3,3.9][(n+side)%3] if not office else [2.4,3.0,3.6][n%3]
            bays=max(2,int(span/pitch));pitch=span/bays
            def at(u,v,h,extra=.045):
                if side==0:return (x+u,y-depth-extra,z+h)
                if side==1:return (x-u,y+depth+extra,z+h)
                if side==2:return (x+depth+extra,y+u,z+h)
                return (x-depth-extra,y-u,z+h)
            for row in range(floors):
                is_shop=row==0 and (kind in ['shop-house','workshop','civic','pavilion'] or ground_shop)
                wh=(2.7 if n%3==0 else 2.15) if office else (2.15 if balcony and side==0 and row>0 else 1.2)
                if is_shop:wh=2.3
                bottom=row*floor_h+(0.24 if wh>2 else 1.0)
                ww=pitch*(.78 if office or is_shop else [.46,.56,.64][(n+side)%3])
                for col in range(bays):
                    # Reserve the central ground-floor doorway; upper residential
                    # panes are waist-height unless they serve a balcony.
                    if side==0 and row==0 and abs(-span/2+(col+.5)*pitch)<1.5:continue
                    u=-span/2+(col+.5)*pitch
                    key=seed(f'{n}:{side}:{row}:{col}')
                    pane='glass' if key%10>=4 else ('window-cool' if office else ['window-warm','window-neutral','window-cool'][(key//10)%3])
                    builder.face([at(u-ww/2,0,bottom),at(u+ww/2,0,bottom),at(u+ww/2,0,bottom+wh),at(u-ww/2,0,bottom+wh)],pane)
                    if lod==0:
                        builder.face([at(u-.025,0,bottom,.065),at(u+.025,0,bottom,.065),at(u+.025,0,bottom+wh,.065),at(u-.025,0,bottom+wh,.065)],'metal')
            if side==0 and balcony:
                for row in range(1,floors):
                    slab_y=y-depth-.8;level=z+row*floor_h
                    builder.box(x,slab_y,level-.16,w*.92,1.6,.16,'foundation',True)
                    builder.box(x,slab_y-.75,level,w*.92+.1,.1,.98,wall)
                    for edge in [-1,1]:builder.box(x+edge*w*.46,slab_y,level,.1,1.6,.98,wall)
                    if lod==0:
                        for j in range(1,bays):builder.box(x-w*.46+j*w*.92/bays,slab_y,level,.07,1.48,1.45,'metal')

    if 'plan' in config:BLOCKS=config['plan'](locals())
    parcels=[];family_counts={};district_counts={};sampled_doors=[]
    for i,block in enumerate(BLOCKS):
        band=block['band'];lx,ly,_=block['position'];x=lx+band*SPACING;y=ly
        parcel_id=block.get('id',f"{block['district']}-{i:04d}");n=seed(parcel_id)
        family=block.get('family') or choose(PLAN['districts'][block['district']],n)
        ow,od,oh=block['size'];yaw=block['yaw']
        w=min(ow,9.2+(n%6)*.6) if family in ['house','farmhouse'] and not block.get('fixedSize') else ow
        d=min(od,15.5) if family in ['house','farmhouse','pavilion'] else od
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
        if family=='office':
            volumes=[(0,0,0,w,d,min(2,floors)*floor_h),(0,d*.06,2*floor_h,w*.78,d*.74,(floors-2)*floor_h)]
        elif family=='civic':
            volumes=[(w*.18,0,0,w*.64,d,height),(-w*.32,d*.24,0,w*.36,d*.52,max(1,floors-1)*floor_h)]
        elif family=='apartment':volumes=[(0,d*.08,0,w,d*.76,height)]
        else:volumes=[(0,0,0,w,d,height)]
        for u,v,z,pw,pd,ph in volumes:
            part(u,v,z,pw,pd,ph,wall)
            parcel['solids'].append([u,v,bottom-floor,pw,pd,z+ph-(bottom-floor)])
        if family=='apartment':
            slab_y=d*.08-d*.76/2-.8
            for row in range(1,floors):
                z=row*floor_h
                part(0,slab_y,z-.16,w*.92,1.6,1.14,wall)
                parcel['balconyGuards'].append([0,slab_y,z,w*.92+.1,1.6,.98,.1])
        pitched=family in ['house','farmhouse','shop-house','warehouse']
        roof_h=min(3.1,w*.19) if pitched else .24
        if pitched:part(0,0,height,w+.65,d+.65,roof_h,roof,'gable')
        else:
            for u,v,z,pw,pd,ph in volumes:part(u,v,z+ph,pw+.25,pd+.25,.24,roof)
        # Door is on the first volume's street-facing facade; civic courts stay open.
        main=volumes[0];du=main[0];dv=main[1]-main[4]/2
        if family=='warehouse':du=-w/2+1.5
        door=world(du,dv,floor);parcel['doors'].append(door)
        for lod in [0,1]:
            b=Builder();b.box(0,0,bottom-floor,w+.5,d+.5,floor-bottom,'foundation',cap=False)
            # Only exposed aprons/courts are walking surfaces. Hidden foundation
            # caps under closed rooms would waste collision triangles.
            cuts_x=sorted(set([-w/2-.25,w/2+.25]+[u+side*pw/2 for u,v,z,pw,pd,ph in volumes if z==0 for side in [-1,1]]))
            cuts_y=sorted(set([-d/2-.25,d/2+.25]+[v+side*pd/2 for u,v,z,pw,pd,ph in volumes if z==0 for side in [-1,1]]))
            for x0,x1 in zip(cuts_x,cuts_x[1:]):
                for y0,y1 in zip(cuts_y,cuts_y[1:]):
                    if any(z==0 and abs((x0+x1)/2-u)<pw/2 and abs((y0+y1)/2-v)<pd/2 for u,v,z,pw,pd,ph in volumes):continue
                    b.quad((x0,y0,0),(x1,y0,0),(x1,y1,0),(x0,y1,0),'foundation',True)
            for u,v,z,pw,pd,ph in volumes:
                # The visible roof slab/gable supplies the walking surface. The
                # hidden wall-volume top must not add a second subdivided roof.
                b.box(u,v,z,pw,pd,ph,wall)
                if family!='warehouse':facade(b,u,v,z,pw,pd,round(ph/floor_h),family,n+round(z)*17,lod,wall,family=='apartment',parcel['groundShop'] and z==0)
            if pitched:b.gable(0,0,height,w+.65,d+.65,roof_h,roof)
            else:
                for u,v,z,pw,pd,ph in volumes:b.box(u,v,z+ph,pw+.25,pd+.25,.24,roof,True)
            # Human-scale doorway, porch canopy and visible support posts.
            public=family in ['office','civic'];dw=2.8 if public else (1.9 if family=='apartment' else 1.1)
            door_material='wood' if family in ['house','farmhouse'] else 'metal'
            b.box(du,dv-.055,0,dw,.1,2.4,door_material)
            b.box(du,dv-.118,.35,dw-.22,.025,1.86,'glass')
            if public:b.box(du,dv-.14,.15,.065,.035,2.2,'metal')
            canopy=4.2 if public else dw+1.0
            b.box(du,dv-.85,2.75,canopy,1.8,.16,'roof-slate' if public else roof)
            for u in [-1,1]:b.box(du+u*(canopy/2-.13),dv-1.6,0,.09,.09,2.75,'metal')
            if family in ['shop-house','workshop','pavilion'] or parcel['groundShop']:
                b.box(0,dv-.25,2.75,w*.86,.35,.48,wall)
                b.box(0,dv-.8,config.get('shopAwningBottom',2.55),w*.88,1.6,.12,roof)
            if family=='warehouse':
                count=max(1,int((w-4)/7))
                for k in range(count):
                    u=-w/2+4+(k+.5)*(w-4)/count
                    b.box(u,-d/2-.035,.1,4.0,.04,3.8,'metal')
                    if lod==0:
                        for row in range(9):b.box(u,-d/2-.063,.35+row*.4,4,.02,.035,'foundation')
            if lod==0:
                b.box(du+.46,dv-.15,.95,.035,.035,.27,'metal')
                if family in ['office','apartment','civic']:
                    top=volumes[-1];b.box(top[0],top[1],top[2]+top[5]+.24,min(2.5,top[3]*.2),2.4,1.1,'metal')
            b.finish(parcel_id+f'_lod{lod}',parcel,lod)
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
