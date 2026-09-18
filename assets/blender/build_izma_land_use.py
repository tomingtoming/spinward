"""Save planted courts, working yards and productive land as native meshes.

Terrain-colour overlays follow the existing terrain triangles; that terrain
continues to support bodies. Access ramps and solid fixtures have their own
native collision faces. Furniture and trees share the existing tile LOD cache.
"""
import bpy, bmesh, json, math, hashlib
from pathlib import Path
from mathutils import Vector
from mathutils.bvhtree import BVHTree

ROOT=Path(__file__).resolve().parents[2];ASSETS=ROOT/'assets/blender';R=3200
layout=json.loads((ASSETS/'izma-land-use-layout.json').read_text())
for name,digest in layout['dependencies'].items():
    assert hashlib.sha256((ASSETS/name).read_bytes()).hexdigest()==digest,('Stale land reservations',name)
base=json.loads((ROOT/'src/worlds/generated/izmaColony.json').read_text())['base']
owner='spinward-izma-land-use-v1';scene=bpy.data.scenes.get('SW_izma_land_use')
if scene:
    assert scene.get('owner')==owner
    for obj in list(scene.objects):bpy.data.objects.remove(obj,do_unlink=True)
    bpy.data.scenes.remove(scene)
scene=bpy.data.scenes.new('SW_izma_land_use');scene['owner']=owner;bpy.context.window.scene=scene
scene.unit_settings.system='METRIC';scene.unit_settings.scale_length=1
definitions={
 'garden':{'color':'#78815b','surface':'grass'},'meadow':{'color':'#7b8762','surface':'grass'},
 'woodland-floor':{'color':'#596b49','surface':'grass'},'soil':{'color':'#7b6953','surface':'grass'},
 'yard':{'color':'#92928a','surface':'paving'},'path':{'color':'#afa79a','surface':'paving'},
 'crop':{'color':'#7a8d4a'},'leaf-olive':{'color':'#6f8553'},'leaf-dark':{'color':'#4a7350'},
 'leaf-silver':{'color':'#8c996a'},'bark':{'color':'#74634d'},'wood':{'color':'#9a815e'},
 'steel':{'color':'#617070'},'roof':{'color':'#707e7a'},'crate':{'color':'#ad976f'},
 'plinth':{'color':'#92938a'},
}
materials={}
for name,d in definitions.items():
    m=bpy.data.materials.new('SWL_'+name);m['definition']=json.dumps(d)
    m.diffuse_color=tuple(int(d['color'][i:i+2],16)/255 for i in [1,3,5])+(1,);materials[name]=m

def area(p):return sum(p[i][0]*p[(i+1)%len(p)][1]-p[(i+1)%len(p)][0]*p[i][1]for i in range(len(p)))/2
def positive(p):return p if area(p)>=0 else list(reversed(p))
def clip(subject,polygon):
    for a,b in zip(polygon,polygon[1:]+polygon[:1]):
        out=[]
        for p,q in zip(subject,subject[1:]+subject[:1]):
            dp=(b[0]-a[0])*(p[1]-a[1])-(b[1]-a[1])*(p[0]-a[0])
            dq=(b[0]-a[0])*(q[1]-a[1])-(b[1]-a[1])*(q[0]-a[0])
            if dp>=-1e-7:out.append(p)
            if (dp>1e-7 and dq< -1e-7)or(dp< -1e-7 and dq>1e-7):
                t=dp/(dp-dq);out.append([p[k]+(q[k]-p[k])*t for k in range(2)])
        subject=out
        if len(subject)<3:return []
    return subject if abs(area(subject))>1e-6 else []
def contains(poly,x,y,margin=0):
    return all((b[0]-a[0])*(y-a[1])-(b[1]-a[1])*(x-a[0])>=margin*math.dist(a,b)-1e-6 for a,b in zip(poly,poly[1:]+poly[:1]))
def keys(poly):
    for x in range(math.floor(min(p[0]for p in poly)/128),math.floor(max(p[0]for p in poly)/128)+1):
        for y in range(math.floor(min(p[1]for p in poly)/128),math.floor(max(p[1]for p in poly)/128)+1):yield x,y
def seed(text):return int.from_bytes(hashlib.sha256(text.encode()).digest()[:4],'big')
pool=base['vertices'];triangles=[];earth_cells={};vertices=[]
for i in range(0,len(base['meshes']['earth']),3):
    ids=base['meshes']['earth'][i:i+3];points=[pool[k*3:k*3+3]for k in ids]
    poly=positive([p[:2]for p in points]);idx=len(triangles);triangles.append(poly)
    for key in keys(poly):earth_cells.setdefault(key,[]).append(idx)
    vertices.extend((math.cos(x/R)*(R-h),y,math.sin(x/R)*(R-h))for x,y,h in points)
earth=BVHTree.FromPolygons(vertices,[tuple(range(i,i+3))for i in range(0,len(vertices),3)],all_triangles=True)
road_vertices=[]
manifest=json.loads((ROOT/'src/worlds/generated/izmaColony.json').read_text())
for packed,names in [(base,['local','arterial','walk']),(manifest['neighbourhoods']['fixed'],['arch-lane'])]:
    for name in names:
        for index in packed['meshes'].get(name,[]):
            x,y,h=packed['vertices'][index*3:index*3+3];road_vertices.append((math.cos(x/R)*(R-h),y,math.sin(x/R)*(R-h)))
roads=BVHTree.FromPolygons(road_vertices,[tuple(range(i,i+3))for i in range(0,len(road_vertices),3)],all_triangles=True)
def height(tree,x,y):
    p=tree.ray_cast(Vector((0,y,0)),Vector((math.cos(x/R),0,math.sin(x/R))))[0]
    # A clipped vertex can be exactly on an outer terrain edge. BVH ray/edge
    # rounding must not turn that shared vertex into missing land. Keep the
    # fallback within 0.2 mm; it cannot bridge a real terrain hole.
    if p is None:
        for dx,dy in [(.0002,0),(-.0002,0),(0,.0002),(0,-.0002)]:
            p=tree.ray_cast(Vector((0,y+dy,0)),Vector((math.cos((x+dx)/R),0,math.sin((x+dx)/R))))[0]
            if p is not None:break
    return None if p is None else R-math.hypot(p.x,p.z)
def ground(x,y):
    h=height(earth,x,y);assert h is not None,('No terrain',x,y);return h

canopies={}
for lod,detail in [(0,2),(1,1)]:
    bm=bmesh.new();bmesh.ops.create_icosphere(bm,subdivisions=detail,radius=.5)
    canopies[lod]=[[tuple(v.co)for v in f.verts]for f in bm.faces];bm.free()
meshes={};physics={};proxies={};fixtures=[]
def mesh_key(x,y,band):return f'{band}-{math.floor((x-band*math.tau*R/3+R*math.pi/6)/512)}-{math.floor((y+20000)/512)}'
def face(points,material,lod,zone,physical=False):
    x=sum(p[0]for p in points)/len(points);y=sum(p[1]for p in points)/len(points)
    tile=mesh_key(x,y,zone['band']);key=(tile,lod)
    group=meshes.setdefault(key,{'faces':[],'districts':set(),'band':zone['band']})
    group['faces'].append((points,material,physical));group['districts'].add(zone['district'])
def box(x,y,z,w,d,h,mat,yaw,zone,lods=(0,1),physical=True):
    c,s=math.cos(yaw),math.sin(yaw)
    vs=[(x+c*u-s*v,y+s*u+c*v,z+zz)for zz in [0,h]for u,v in [(-w/2,-d/2),(w/2,-d/2),(w/2,d/2),(-w/2,d/2)]]
    for lod in lods:
        for ids in [(0,1,5,4),(1,2,6,5),(2,3,7,6),(3,0,4,7),(4,5,6,7)]:face([vs[i]for i in ids],mat,lod,zone,physical and lod==0)
    proxies.setdefault(mesh_key(x,y,zone['band']),[]).append([x,y,z,w,d,h,yaw,'land-'+mat,'box'])

for zone in layout['zones']:
    use=zone['use'];pieces=zone['pieces'];outline=zone['outline'];n=seed(zone['id'])
    mat={'service-yard':'yard','allotments':'soil','woodland':'woodland-floor','orchard':'meadow'}.get(use,'garden')
    # Clip against individual native terrain triangles. Offsetting by 2.5 cm
    # removes coplanar flicker; the original terrain provides physical support.
    for piece in pieces:
        ids={i for key in keys(piece)for i in earth_cells.get(key,[])}
        for i in ids:
            p=clip(piece,triangles[i])
            if p:face([(x,y,ground(x,y)+.025)for x,y in p],mat,-1,zone)
    access=zone.get('access');zone['accessRejected']=None
    if access:
        a,b=access['start'],access['end'];length=math.dist(a,b);dx,dy=(b[0]-a[0])/length,(b[1]-a[1])/length
        count=math.ceil(length/1.5);rows=[]
        for i in range(count+1):
            t=i/count;xy=[a[0]+(b[0]-a[0])*t,a[1]+(b[1]-a[1])*t]
            sides=[[xy[0]-dy*side*1.2,xy[1]+dx*side*1.2]for side in [-1,1]]
            rows.append([sides,[max(ground(*p)+.05,(height(roads,*p)or -10000)+.015)for p in sides]])
        h=[[max(row[1][side]-abs(i-j)*length/count/12 for j,row in enumerate(rows))for side in [0,1]]for i in range(count+1)]
        start_h=[height(roads,*p)for p in rows[0][0]]
        if any(rh is None or h[0][k]>rh+.15 for k,rh in enumerate(start_h)):
            zone['accessRejected']='junction-grade';zone['access']=None
        else:
            for i in range(count):
                face([(*rows[j][0][k],h[j][k])for j,k in [(i,0),(i,1),(i+1,1),(i+1,0)]],'path',-1,zone,True)
                for k in [0,1]:
                    a,b=rows[i][0][k],rows[i+1][0][k]
                    face([(*a,ground(*a)-.02),(*b,ground(*b)-.02),(*b,h[i+1][k]),(*a,h[i][k])],'plinth',-1,zone,True)
            access['profile']=[[(row[0][0][0]+row[0][1][0])/2,(row[0][0][1]+row[0][1][1])/2,sum(h[i])/2]for i,row in enumerate(rows)]
    zone['walkProfiles']=[]
    for a,b in zone.get('walks',[]) if zone.get('access') else []:
        length=math.dist(a,b);dx,dy=(b[0]-a[0])/length,(b[1]-a[1])/length;count=math.ceil(length/2);rows=[]
        for i in range(count+1):
            x=a[0]+dx*length*i/count;y=a[1]+dy*length*i/count
            sides=[(x-dy*side*1.15,y+dx*side*1.15)for side in [-1,1]]
            rows.append([(xx,yy,ground(xx,yy)+.055)for xx,yy in sides])
        if any(abs(rows[i+1][k][2]-rows[i][k][2])/(length/count)>.12 for i in range(count)for k in [0,1]):continue
        for i in range(count):face([rows[j][k]for j,k in [(i,0),(i,1),(i+1,1),(i+1,0)]],'path',-1,zone,True)
        zone['walkProfiles'].append([[sum(p[k]for p in row)/2 for k in range(3)]for row in rows])
    angle=math.atan2(outline[1][1]-outline[0][1],outline[1][0]-outline[0][0]);c,s=math.cos(angle),math.sin(angle)
    origin=outline[0]
    def local(x,y):return c*(x-origin[0])+s*(y-origin[1]),-s*(x-origin[0])+c*(y-origin[1])
    def world(u,v):return origin[0]+c*u-s*v,origin[1]+s*u+c*v
    local_outline=[local(*p)for p in outline]
    gap=11 if use=='orchard' else 9 if use in ['woodland','allotments'] else 18 if use=='shared-garden' else 13 if use=='rear-gardens' else 16
    zone_fixtures=[]
    def clear_path(x,y,radius):
        access=zone.get('access')
        if not access:return True
        for a,b in [[access['start'],access['end']],*[(p[0][:2],p[-1][:2])for p in zone['walkProfiles']]]:
            dx,dy=b[0]-a[0],b[1]-a[1];t=max(0,min(1,((x-a[0])*dx+(y-a[1])*dy)/(dx*dx+dy*dy)))
            if math.hypot(x-a[0]-t*dx,y-a[1]-t*dy)<=radius+1.5:return False
        return True
    for i in range(math.floor(min(p[0]for p in local_outline)/gap),math.ceil(max(p[0]for p in local_outline)/gap)):
        for j in range(math.floor(min(p[1]for p in local_outline)/gap),math.ceil(max(p[1]for p in local_outline)/gap)):
            k=seed(f"{zone['id']}:{i}:{j}");jitter=0 if use in ['orchard','allotments','service-yard']else 7
            x,y=world((i+.5)*gap+(k%101/100-.5)*jitter,(j+.5)*gap+((k//101)%101/100-.5)*jitter)
            radius=3 if use not in ['allotments','service-yard']else 4.2
            if not any(contains(p,x,y,radius)for p in pieces)or not clear_path(x,y,radius):continue
            h=ground(x,y)+.025
            if use=='service-yard':
                # A low equipment store and pallet stacks leave the approach
                # clear; large roadless asphalt areas are not called car parks.
                if k%4:continue
                corners=[(x+c*u-s*v,y+s*u+c*v)for u in [-3.2,3.2]for v in [-2.2,2.2]]
                supports=[ground(*p)for p in corners]
                if max(supports)-min(supports)>.9:continue
                bottom=min(supports)-.04;h=max(supports)+.06
                box(x,y,bottom,6.4,4.4,h-bottom,'plinth',angle,zone)
                if k%8==0:
                    box(x,y,h,5.8,3.8,2.5,'steel',angle,zone);box(x,y,h+2.5,6.1,4.1,.15,'roof',angle,zone)
                    kind='equipment-store'
                else:
                    box(x,y,h,2.4,1.2,.28,'wood',angle,zone);box(x,y,h+.28,2.1,1.05,1.2,'crate',angle,zone);kind='pallet-stack'
            elif use=='allotments':
                for row in [-1,0,1]:
                    u=(i+.5)*gap+row*2.2;v=(j+.5)*gap;xx,yy=world(u,v)
                    for segment in range(4):
                        v0=v-3+segment*1.5;v1=v0+1.5
                        corners=[world(uu,vv)for uu,vv in [(u-.6,v0),(u+.6,v0),(u+.6,v1),(u-.6,v1)]]
                        for lod in [0,1]:face([(px,py,ground(px,py)+.15)for px,py in corners],'crop',lod,zone)
                    proxies.setdefault(mesh_key(xx,yy,zone['band']),[]).append([xx,yy,ground(xx,yy)+.025,1.2,6,.125,angle,'land-crop','box'])
                kind='growing-beds'
            else:
                if use=='shared-garden' and k%7==0:
                    box(x,y,h,2,.55,.44,'wood',angle,zone);box(x-s*.22,y+c*.22,h+.44,2,.12,.5,'wood',angle,zone);kind='bench'
                else:
                    crown=4.2+(k%4)*.55;height_tree=5+(k%5)*.5
                    box(x,y,h,.3,.3,height_tree*.58,'bark',0,zone)
                    leaf=['leaf-olive','leaf-dark','leaf-silver'][(k//7)%3]
                    for lod in [0,1]:
                        for tri in canopies[lod]:face([(x+u*crown,y+v*crown,h+height_tree*.55+(z+.5)*crown*.85)for u,v,z in tri],leaf,lod,zone)
                    proxies.setdefault(mesh_key(x,y,zone['band']),[]).append([x,y,h+height_tree*.55,crown,crown,crown*.85,0,'land-'+leaf,'canopy']);kind='tree'
            item={'zone':zone['id'],'kind':kind,'position':[x,y,h],'clearance':radius};zone_fixtures.append(item);fixtures.append(item)
    # Low garden boundaries make the outer parcel edge visible. Openings stay
    # clear of verified approaches and paths; avoid filling narrow fragments.
    if use=='rear-gardens':
        for a,b in zip(outline,outline[1:]+outline[:1]):
            length=math.dist(a,b);dx,dy=(b[0]-a[0])/length,(b[1]-a[1])/length;count=math.ceil(length/4)
            for i in range(count):
                x=a[0]+dx*length*(i+.5)/count-dy*.6;y=a[1]+dy*length*(i+.5)/count+dx*.6
                points=[(x+dx*side*length/count/2,y+dy*side*length/count/2)for side in [-1,0,1]]
                if not all(any(contains(p,*q,.4)for p in pieces)for q in points)or not clear_path(x,y,2):continue
                levels=[ground(*q)for q in points];bottom=min(levels)-.02
                box(x,y,bottom,length/count+.02,.7,max(levels)-bottom+.85,'leaf-dark',math.atan2(dy,dx),zone)
    zone['fixtures']=len(zone_fixtures)

for (tile,lod),data in meshes.items():
    vs=[];faces=[];mats=[];flags=[]
    # A local origin keeps Blender's single-precision vertices accurate even
    # at the end of a 40 km band.
    points=[p for face,_,_ in data['faces']for p in face];ox=sum(p[0]for p in points)/len(points);oy=sum(p[1]for p in points)/len(points)
    for points,mat,physical in data['faces']:
        faces.append(tuple(range(len(vs),len(vs)+len(points))));vs.extend((y-oy,-(x-ox),h)for x,y,h in points);mats.append(mat);flags.append(physical)
    me=bpy.data.meshes.new(f'land-{tile}-{lod}');me.from_pydata(vs,[],faces);me.update()
    names=sorted(set(mats))
    for name in names:me.materials.append(materials[name])
    for p,mat in zip(me.polygons,mats):p.material_index=names.index(mat)
    attribute=me.attributes.new('physical','BOOLEAN','FACE')
    for value,flag in zip(attribute.data,flags):value.value=flag
    obj=bpy.data.objects.new(me.name,me);scene.collection.objects.link(obj);obj.location=(oy,-ox,0)
    obj['tile']=tile;obj['lod']=lod;obj['band']=data['band'];obj['districts']=json.dumps(sorted(data['districts']));obj.hide_render=lod==1
scene.view_layers[0].update()
bpy.data.libraries.write(str(ASSETS/'izma-land-use.blend'),{scene},fake_user=True,compress=True)
contract={**layout,'materials':definitions,'fixtures':fixtures,'proxies':proxies,
 'terrainHash':hashlib.sha256(json.dumps([base['vertices'],base['meshes']['earth']],separators=(',',':')).encode()).hexdigest(),
 'layoutHash':hashlib.sha256((ASSETS/'izma-land-use-layout.json').read_bytes()).hexdigest()}
(ASSETS/'izma-land-use.json').write_text(json.dumps(contract,separators=(',',':'))+'\n')
result={'zones':len(layout['zones']),'fixtures':len(fixtures),'accesses':sum(bool(z['access'])for z in layout['zones']),
 'rejectedAccesses':sum(bool(z['accessRejected'])for z in layout['zones']),'nativeObjects':len(scene.objects),
 'blendBytes':(ASSETS/'izma-land-use.blend').stat().st_size}
