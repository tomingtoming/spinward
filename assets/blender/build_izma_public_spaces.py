"""Author 18 connected public places against the finished city, in an isolated scene.

Run with Blender MCP CLI against izma-colony.blend. This is an offline siting
recipe, not runtime random generation. The saved blend is the export source.
Rebuild after terrain/transport/parcels change; never overwrite their scenes.
"""
import bpy, bmesh, json, math, hashlib
from pathlib import Path
import sys
sys.path.insert(0,str(Path(__file__).resolve().parent))
from colony_manifest_io import read_manifest
from mathutils import Vector
from mathutils.bvhtree import BVHTree

ROOT=Path(__file__).resolve().parents[2]
MASTER=json.loads((ROOT/'assets/blender/izma-colony-plan.json').read_text())
BASE=read_manifest(ROOT/'src/worlds/generated/izmaColony.json')
PARCELS=json.loads((ROOT/'assets/blender/izma-parcels.json').read_text())
TRANSPORT=json.loads((ROOT/'assets/blender/izma-transport.json').read_text())
R=3200; SPACING=math.tau*R/3; OWNER='spinward-izma-public-v1'
scene=bpy.data.scenes.get('SW_izma_public')
if scene:
    assert scene.get('owner')==OWNER
    for obj in list(scene.objects):bpy.data.objects.remove(obj,do_unlink=True)
    bpy.data.scenes.remove(scene)
scene=bpy.data.scenes.new('SW_izma_public');scene['owner']=OWNER
bpy.context.window.scene=scene
scene.unit_settings.system='METRIC';scene.unit_settings.scale_length=1
definitions={
    'stone':{'color':'#a7a297','surface':'paving'},
    'brick':{'color':'#887c6c','surface':'paving'},
    'yard':{'color':'#808582','surface':'paving'},
    'grass':{'color':'#6a8055','surface':'grass'},
    'soil':{'color':'#635344','surface':'grass'},
    'wood':{'color':'#9b805c'}, 'steel':{'color':'#4c5c5d'},
    'roof':{'color':'#58635e'}, 'bark':{'color':'#70634d'},
    'leaf-olive':{'color':'#70834d'}, 'leaf-dark':{'color':'#4a7254'},
    'leaf-silver':{'color':'#8e9b73'},
    'light':{'color':'#e4d3ad','emission':{'color':'#ffd8a2','intensity':.42}},
}
materials={}
for name,d in definitions.items():
    mat=bpy.data.materials.new('SWP_'+name);mat['definition']=json.dumps(d)
    mat.diffuse_color=tuple(int(d['color'][i:i+2],16)/255 for i in [1,3,5])+(1,)
    materials[name]=mat
pool=BASE['base']['vertices']
def bvh(names):
    vs=[]
    for name in names:
        for i in BASE['base']['meshes'].get(name,[]):
            x,y,h=pool[i*3:i*3+3];a=x/R;vs.append((math.cos(a)*(R-h),y,math.sin(a)*(R-h)))
    return BVHTree.FromPolygons(vs,[tuple(range(i,i+3)) for i in range(0,len(vs),3)],all_triangles=True)
earth=bvh(['earth']);road=bvh(['local','arterial','walk'])
# Use the runtime's 64 m collision buckets to leave room for this public
# compound throughout every affected walking window, not just at its centre.
columns=round(math.tau*R/64);cell=math.tau*R/columns;collision_cells={};collision_cost=[]
def cells_for(bounds,margin=8):
    x0,y0,x1,y1=bounds
    for col in range(math.floor((x0-margin)/cell),math.floor((x1+margin)/cell)+1):
        for row in range(max(0,math.floor((y0-margin+20000)/64)),min(624,math.floor((y1+margin+20000)/64))+1):
            yield col%columns,row
def register(bounds,cost):
    idx=len(collision_cost);collision_cost.append(cost)
    for key in cells_for(bounds):collision_cells.setdefault(key,set()).add(idx)
for packed in [BASE['base'],BASE['architecture']['fixed']]:
    for surface in packed['surfaces']:register(surface['bounds'],len(surface['indices'])//3)
for x,y,z,w,d,h,yaw in BASE.get('structures',[])+BASE['architecture']['solids']:
    c,s=abs(math.cos(yaw)),abs(math.sin(yaw));hw=(w*c+d*s)/2;hd=(d*c+w*s)/2
    register([x-hw,y-hd,x+hw,y+hd],0)
window_cost={}
def fits_collision_budget(bounds):
    affected={(col+dc, row+dr)for col,row in cells_for(bounds)for dc in [-1,0,1]for dr in [-1,0,1]}
    for col,row in affected:
        key=(col%columns,row)
        if key not in window_cost:
            bodies=set()
            for dc in [-1,0,1]:
                for dr in [-1,0,1]:bodies.update(collision_cells.get(((col+dc)%columns,row+dr),set()))
            window_cost[key]=(len(bodies),sum(collision_cost[i]for i in bodies))
        count,triangles=window_cost[key]
        if count>30 or triangles>3300:return False
    return True
def height(tree,x,y):
    a=x/R;p=tree.ray_cast(Vector((0,y,0)),Vector((math.cos(a),0,math.sin(a))))[0]
    return None if p is None else R-math.hypot(p.x,p.z)
def ground(x,y):
    h=height(earth,x,y)
    if h is None:raise RuntimeError(('No terrain',x,y))
    return h
def project(x,y,a,b):
    dx,dy=b[0]-a[0],b[1]-a[1];t=max(0,min(1,((x-a[0])*dx+(y-a[1])*dy)/(dx*dx+dy*dy)))
    return a[0]+t*dx,a[1]+t*dy,t
nodes={n['id']:n for n in MASTER['nodes']};profiles={p['id']:p for p in TRANSPORT['profiles']}
segments=[[]for _ in range(3)]
for route in MASTER['routes']:
    for aid,bid in zip(route['nodes'],route['nodes'][1:]):
        a,b=nodes[aid],nodes[bid]
        if a['band']==b['band']:segments[a['band']].append((a['xy'],b['xy'],route))
def site(district,w,d):
    band=district['band'];cx,cy=district['centre'];radius=math.hypot(w,d)/2
    choices=[]
    for a,b,route in segments[band]:
        if route['kind'] not in ['local','arterial'] or route['id'] not in profiles:continue
        length=math.dist(a,b);dx,dy=(b[0]-a[0])/length,(b[1]-a[1])/length
        for k in range(1,math.ceil(length/20)):
            t=k/math.ceil(length/20);px=a[0]+t*(b[0]-a[0]);py=a[1]+t*(b[1]-a[1])
            if math.hypot(px-cx,py-cy)>2600:continue
            for side in [-1,1]:
                setback=route['width']/2+radius+7;x=px-dy*side*setback;y=py+dx*side*setback
                if not district['axial'][0]+radius<y<district['axial'][1]-radius:continue
                if abs(x)+radius>R*math.pi/6-MASTER['edgeReserve']:continue
                if band==0 and abs(x)<350+radius and abs(y)<430+radius:continue
                occupied=False
                for parcel in PARCELS['parcels']:
                    if parcel['band']!=band:continue
                    pr=math.hypot(*parcel['size'][:2])/2+4
                    if math.hypot(x+band*SPACING-parcel['position'][0],y-parcel['position'][1])<radius+pr+6:occupied=True;break
                    # Also reserve the actual entrance corridor, not only the body.
                    qx,qy,_=project(x+band*SPACING,y,parcel['access']['start'],parcel['access']['end'])
                    if math.hypot(x+band*SPACING-qx,y-qy)<radius+3:occupied=True;break
                if occupied:continue
                for aa,bb,rr in segments[band]:
                    qx,qy,_=project(x,y,aa,bb)
                    if math.hypot(x-qx,y-qy)<radius+rr['width']/2+5:occupied=True;break
                if occupied:continue
                water=MASTER['water'][band]
                if any(math.hypot(x-project(x,y,aa,bb)[0],y-project(x,y,aa,bb)[1])<radius+water['bankWidth'] for aa,bb in zip(water['reach'],water['reach'][1:])):continue
                choices.append((math.hypot(x-cx,y-cy),x+band*SPACING,y,math.atan2(dy*side,dx*side),route,px+band*SPACING,py))
    rejected={}
    def reject(reason):rejected[reason]=rejected.get(reason,0)+1
    for distance,x,y,yaw,route,rx,ry in sorted(choices,key=lambda a:a[0]):
        c,s=math.cos(yaw),math.sin(yaw)
        def point(u,v):return x+c*u-s*v,y+s*u+c*v
        heights=[ground(*point(u*w/2,v*d/2)) for u in [-1,0,1]for v in [-1,0,1]]
        if max(heights)-min(heights)>min(w,d)*.075:reject('grade');continue
        # v=-depth/2 is always the street frontage. The entrance stays at u=0.
        end=point(0,-d/2);vx,vy=x-rx,y-ry;l=math.hypot(vx,vy);vx/=l;vy/=l
        offset=route['width']/2+(2.05 if route['width']>=10 else -.12)
        start=(rx+vx*offset,ry+vy*offset);length=math.dist(start,end)
        start_h=height(road,*start)
        if start_h is None:reject('no-pavement');continue
        if abs(start_h-ground(*start))>1.5:reject('elevated');continue
        rows=[];count=math.ceil(length/1.5)
        for i in range(count+1):
            t=i/count;px=start[0]+t*(end[0]-start[0]);py=start[1]+t*(end[1]-start[1])
            sides=[(px-vy*2*side,py+vx*2*side)for side in [-1,1]]
            required=[]
            for q in sides:
                rh=height(road,*q)
                required.append(max(ground(*q)+.07,rh+.015 if rh is not None else -1000))
            rows.append([sides,required])
        # Preserve gentle crossfall instead of flattening each four-metre row
        # above its high side. Both edges must join their own drawn pavement.
        heights=[[max(row[1][side]-abs(i-j)*length/count/12 for j,row in enumerate(rows))for side in [0,1]]for i in range(count+1)]
        road_starts=[height(road,*q)for q in rows[0][0]]
        if any(rh is None or heights[0][side]>rh+.1 for side,rh in enumerate(road_starts)):reject('walk-start');continue
        if any(heights[-1][side]>ground(*q)+.16 for side,q in enumerate(rows[-1][0])):reject('walk-end');continue
        for row,h in zip(rows,heights):row[1]=h
        boundary=[point(u*w/2,v*d/2)for u in [-1,1]for v in [-1,1]]+rows[0][0]
        if not fits_collision_budget([min(q[0]for q in boundary),min(q[1]for q in boundary),max(q[0]for q in boundary),max(q[1]for q in boundary)]):reject('collision-budget');continue
        return {'id':district['id'],'band':band,'name':district['name'],'use':district['use'],
            'position':[x,y],'yaw':yaw,'size':[w,d],'route':route['id'],'centreDistance':distance,
            'entry':[*start,sum(heights[0])/2],'threshold':[*end,sum(heights[-1])/2],'thresholdSides':list(reversed(heights[-1])),'rows':rows,
            'target':[*point(0,0),ground(*point(0,0))+.07]}
    raise RuntimeError(('No public site with safe frontage',district['id'],len(choices),rejected))

class Mesh:
    def __init__(self):self.v=[];self.f=[];self.m=[];self.physical=[];self.floor=[]
    def face(self,points,mat,physical=False,floor=False):
        n=len(self.v);self.v.extend(points);self.f.append(tuple(range(n,n+len(points))))
        self.m.append(mat);self.physical.append(physical);self.floor.append(floor)
    def box(self,u,v,z,w,d,h,mat,physical=True):
        a,b=u-w/2,u+w/2;c,e=v-d/2,v+d/2;t=z+h
        for points in [[(a,c,z),(b,c,z),(b,c,t),(a,c,t)],[(b,e,z),(a,e,z),(a,e,t),(b,e,t)],
                       [(a,e,z),(a,c,z),(a,c,t),(a,e,t)],[(b,c,z),(b,e,z),(b,e,t),(b,c,t)]]:
            self.face(points,mat,physical)
        self.face([(a,c,t),(b,c,t),(b,e,t),(a,e,t)],mat,physical,physical)
    def canopy(self,u,v,z,w,d,h,mat,detail):
        bm=bmesh.new();bmesh.ops.create_icosphere(bm,subdivisions=detail,radius=.5)
        for f in bm.faces:self.face([(u+p.co.x*w,v+p.co.y*d,z+h/2+p.co.z*h)for p in f.verts],mat)
        bm.free()
    def save(self,p,lod):
        me=bpy.data.meshes.new(p['id']+f'-{lod}');me.from_pydata(self.v,[],self.f);me.update()
        keys=list(materials)
        for key in keys:me.materials.append(materials[key])
        for poly,key in zip(me.polygons,self.m):poly.material_index=keys.index(key)
        for name,values in [('physical',self.physical),('ground_surface',self.floor)]:
            attr=me.attributes.new(name=name,type='BOOLEAN',domain='FACE')
            for item,value in zip(attr.data,values):item.value=value
        obj=bpy.data.objects.new('Public_'+p['id']+f'_{lod}',me);scene.collection.objects.link(obj)
        obj['place_id']=p['id'];obj['lod']=lod
        obj.location=(p['position'][1],-p['position'][0],0);obj.rotation_euler.z=p['yaw']-math.pi/2
        obj.hide_render=lod==1

places=[]
for di,district in enumerate(MASTER['districts']):
    use=district['use'];w,d=(60,42)if use in ['park','farming','campus']else(48,34)
    for size in [(w,d),(36,28)]:
        try:p=site(district,*size);w,d=size;break
        except RuntimeError:
            if size==(36,28):raise
    x,y=p['position'];c,s=math.cos(p['yaw']),math.sin(p['yaw'])
    def world(u,v):return x+c*u-s*v,y+s*u+c*v
    def gh(u,v):return ground(*world(u,v))+.07
    fixed=Mesh();near=Mesh();mid=Mesh();proxies=[]
    nx,ny=math.ceil(w/6),math.ceil(d/6)
    us=sorted(set([-w/2+w*i/nx for i in range(nx+1)]+[-2,2]))
    vs=sorted(set([-d/2+d*i/ny for i in range(ny+1)]+[-d/2+3]))
    def surface(u,v):
        h=gh(u,v)
        # Blend the final access row into the plaza, with no curb at the mouth.
        if abs(u)<2.01 and v<-d/2+3:
            t=(u+2)/4;edge=p['thresholdSides'][0]*(1-t)+p['thresholdSides'][1]*t
            h=edge*(1-(v+d/2)/3)+h*((v+d/2)/3)
        return h
    for u0,u1 in zip(us,us[1:]):
        for v0,v1 in zip(vs,vs[1:]):
            u=(u0+u1)/2;v=(v0+v1)/2
            green=use in ['housing','park','farming','campus'] and abs(u)>4 and abs(v)>3.5 and v>-d/2+6
            mat='grass'if green else ('yard'if use=='industry'else 'brick'if use=='mixed'else 'stone')
            fixed.face([(a,b,surface(a,b))for a,b in [(u0,v0),(u1,v0),(u1,v1),(u0,v1)]],mat,True,True)
    # The four plaza edges close down to terrain; an uncurbed 4 m entrance
    # crosses the front edge and is sampled from exactly the same support.
    for axis,edge,length in [(0,-w/2,d),(0,w/2,d),(1,-d/2,w),(1,d/2,w)]:
        count=math.ceil(length/6)
        for i in range(count):
            q0=-length/2+length*i/count;q1=-length/2+length*(i+1)/count
            uv=[(edge,q0),(edge,q1)]if axis==0 else[(q0,edge),(q1,edge)]
            fixed.face([(u,v,ground(*world(u,v))-.12)for u,v in uv]+[(u,v,surface(u,v))for u,v in reversed(uv)],'stone')
    def local(q):
        dx,dy=q[0]-x,q[1]-y;return c*dx+s*dy,-s*dx+c*dy
    rows=p.pop('rows')
    for a,b in zip(rows,rows[1:]):
        fixed.face([(*local(q),h)for q,h in [(a[0][0],a[1][0]),(a[0][1],a[1][1]),(b[0][1],b[1][1]),(b[0][0],b[1][0])]],'stone',True,True)
        for side in [0,1]:
            qa,qb=a[0][side],b[0][side]
            fixed.face([(*local(qa),ground(*qa)-.12),(*local(qb),ground(*qb)-.12),(*local(qb),b[1][side]),(*local(qa),a[1][side])],'stone')
    p['walkSamples']=[[(row[0][0][0]+row[0][1][0])/2,(row[0][0][1]+row[0][1][1])/2,sum(row[1])/2]for row in rows]
    # Shape large enough to read at colony scale; fine boards remain near-only.
    def box(u,v,z,bw,bd,bh,mat,physical=True,proxy=False):
        near.box(u,v,z,bw,bd,bh,mat,physical);mid.box(u,v,z,bw,bd,bh,mat,physical)
        if proxy:proxies.append([u,v,z,bw,bd,bh,mat,'box'])
    def bench(u,v,length=3.2):
        h=max(gh(u,v),gh(u+length-.22,v))
        for a in [u,u+length-.22]:box(a,v,gh(a,v)-.04,.22,.58,h+.37-gh(a,v)+.04,'steel')
        box(u+length/2-.11,v,h+.37,length,.62,.09,'wood')
        box(u+length/2-.11,v+.27,h+.46,length,.09,.37,'wood')
    # Open shelter: protected sitting space with actual pillar/roof collisions.
    su,sv=-w*.29,d*.24;sh=max(gh(su+u,sv+v)for u in [-4,4]for v in [-3,3])
    for u in [-3.65,3.65]:
        for v in [-2.65,2.65]:box(su+u,sv+v,gh(su+u,sv+v),.22,.22,sh+3.05-gh(su+u,sv+v),'steel',True,True)
    box(su,sv,sh+3.05,8.1,6.1,.22,'roof',True,True)
    box(su,sv,sh+2.99,2.2,.16,.06,'light',False)
    def lamp(u,v,h,intensity,distance):
        light=bpy.data.lights.new('SWP_Light_'+p['id'],type='POINT')
        light.color=(1,.79,.54);light.energy=intensity
        obj=bpy.data.objects.new(light.name,light);scene.collection.objects.link(obj)
        wx,wy=world(u,v);obj.location=(wy,-wx,h);obj['place_id']=p['id']
        obj['color']='#ffdfa8';obj['intensity']=intensity;obj['distance']=distance
    lamp(su,sv,sh+2.84,42,17)
    for u,v in [(3.2,-d/2+3),(w*.12,d*.08)]:
        h=gh(u,v)
        box(u,v,h-.06,.14,.14,3.46,'steel',True,True)
        box(u,v,h+3.35,.65,.65,.1,'roof',False,True)
        box(u,v,h+3.29,.54,.54,.06,'light',False)
        lamp(u,v,h+3.21,72,22)
    bench(su-2.7,sv+1.8,5.4)
    box(su,sv,sh+.69,2.3,1.1,.1,'wood')
    for u in [su-.85,su+.85]:box(u,sv,gh(u,sv)-.04,.16,.65,sh+.69-gh(u,sv)+.04,'steel')
    trees=[(w*.32,-d*.22),(w*.32,d*.26),(-w*.32,-d*.22)]
    if use in ['park','farming','campus','housing']:trees.extend([(w*.12,d*.33),(-w*.12,d*.34)])
    if use=='industry':trees=trees[:2]
    for ti,(u,v) in enumerate(trees):
        h=gh(u,v);crown=5.1+(di+ti)%3*.55;leaf=['leaf-olive','leaf-dark','leaf-silver'][(di+ti)%3]
        bottom=min(gh(u+du,v+dv)for du in [-1.9,1.9]for dv in [-1.9,1.9])-.08
        h=max(gh(u+du,v+dv)for du in [-1.9,1.9]for dv in [-1.9,1.9])
        box(u,v,bottom,3.8,3.8,h+.36-bottom,'stone')
        box(u,v,h+.36,3.5,3.5,.05,'soil',False)
        box(u,v,h+.4,.35,.35,3.8,'bark',True,True)
        near.canopy(u,v,h+2.8,crown,crown*.87,crown*.95,leaf,2)
        mid.canopy(u,v,h+2.8,crown,crown*.87,crown*.95,leaf,1)
        proxies.append([u,v,h+2.8,crown,crown*.87,crown*.95,leaf,'canopy'])
        bench(u-1.5,v-2.7)
    if use in ['mixed','civic']:
        # Market/civic courts have low stone sitting edges, leaving the axis open.
        for u in [-w*.29,w*.29]:box(u,0,gh(u,0),8,1,.46,'stone')
    if use=='industry':
        # Keep a broad apron empty; workers' seating is off the movement area.
        for u in [-7,7]:box(u,-d*.25,gh(u,-d*.25),.16,5,.012,'stone',False)
    if use=='farming':
        for v in [-3,3,9]:
            box(w*.13,v,gh(w*.13,v),5,2,.28,'wood')
            box(w*.13,v,gh(w*.13,v)+.28,4.7,1.7,.06,'soil',False)
    # A supported neighbourhood noticeboard, not a floating destination marker.
    for u in [-3.4,-1.8]:box(u,-d/2+3,gh(u,-d/2+3),.09,.09,1.8,'steel')
    box(-2.6,-d/2+3,gh(-2.6,-d/2+3)+.9,1.9,.12,.9,'wood')
    box(-2.6,-d/2+2.93,gh(-2.6,-d/2+3)+1,1.65,.01,.62,'stone',False)
    # Entrance always outside the roof; aim into the open circulation axis.
    p['proxyParts']=proxies;p['shelter']=[*world(su,sv),sh];p['trees']=len(trees)
    p['layout']={'industry':'works-rest-court','mixed':'market-court','civic':'civic-square',
                 'housing':'neighbourhood-green','park':'park-rest-garden','campus':'campus-court','farming':'allotment-rest-garden'}[use]
    fixed.save(p,-1);near.save(p,0);mid.save(p,1);places.append(p)

scene.view_layers[0].update()
terrain_hash=hashlib.sha256(json.dumps([pool,BASE['base']['meshes']['earth']],separators=(',',':')).encode()).hexdigest()
contract={'version':1,'origin':'ai','created':'2026-09-18','terrainHash':terrain_hash,
          'parcelsHash':hashlib.sha256((ROOT/'assets/blender/izma-parcels.json').read_bytes()).hexdigest(),
          'materials':definitions,'places':places}
(ROOT/'assets/blender/izma-public-spaces.json').write_text(json.dumps(contract,ensure_ascii=False,indent=2)+'\n')
path=ROOT/'assets/blender/izma-public-spaces.blend'
bpy.data.libraries.write(str(path),{scene},fake_user=True,compress=True)
result={'places':len(places),'source':str(path),'objects':len(scene.objects),
        'sites':[{k:p[k]for k in ['id','position','route','centreDistance','layout']}for p in places]}
