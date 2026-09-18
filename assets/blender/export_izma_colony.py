"""Export the saved colony model as a shared always-present terrain base and
independently fetched 512 m building tiles. No background network job is made.
The original neighbourhood is cut out exactly; its boundary meets a graded
connection collar. This is the first runtime pass, not finished city content.
"""
import bpy
import math
import json
import hashlib
from pathlib import Path
import sys
sys.path.insert(0,str(Path(__file__).resolve().parent))
from colony_manifest_io import write_manifest
from mathutils import Vector
from mathutils.bvhtree import BVHTree

ROOT=Path(__file__).resolve().parents[2]
R=3200
SPACING=math.tau*R/3
SCENE=bpy.data.scenes['SWC_izma_unrolled']
SCENE.view_layers[0].update()
TILE=512
palette={}
base={}
floors={}
barriers={}
structures=[]
blocks=json.loads((ROOT/'assets/blender/izma-colony-blocks.json').read_text())
plan=json.loads((ROOT/'assets/blender/izma-colony-plan.json').read_text())


def local(band,p):return (-p.y-band*SPACING,p.x,p.z)
def world(band,p):
    x,y,h=p;a=band*math.tau/3+x/R
    return (math.cos(a)*(R-h),y,math.sin(a)*(R-h))
def flatten(vs):return [round(v,5) for p in vs for v in p]


def clip(poly,axis,bound,keep_less):
    out=[]
    for a,b in zip(poly,poly[1:]+poly[:1]):
        da=a[axis]-bound;db=b[axis]-bound
        inside_a=da<=1e-8 if keep_less else da>=-1e-8
        inside_b=db<=1e-8 if keep_less else db>=-1e-8
        if inside_a:out.append(a)
        if inside_a!=inside_b:
            t=da/(da-db)
            out.append(tuple(a[k]+(b[k]-a[k])*t for k in range(3)))
    return out


def outside_study(poly):
    # Partition the complement; unlike four independent half-planes, these
    # pieces do not overlap at the rectangle's corners.
    result=[];remaining=poly
    for axis,bound,less in [(0,-320,True),(0,320,False),(1,-400,True),(1,400,False)]:
        part=clip(remaining,axis,bound,less)
        if len(part)>2:result.append(part)
        remaining=clip(remaining,axis,bound,not less)
        if len(remaining)<3:break
    return result


def collar(p):
    x,y,h=p
    d=max(abs(x)-320,abs(y)-400,0)
    t=min(1,d/180);t=t*t*(3-2*t)
    return (x,y,.03+(h-.03)*t)


def append(band,material,tri,surface):
    a,b,c=tri
    area=abs((b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]))
    if area<1e-8 and surface:return
    if band==0 and surface and any(abs(p[0])<540 and abs(p[1])<620 for p in tri):
        # Match the small study's curvature precision through the join.
        # A long edge at h=.03 rises above it after cylinder projection.
        edges=[(tri[i],tri[(i+1)%3],tri[(i+2)%3]) for i in range(3)]
        a,b,c=max(edges,key=lambda e:math.dist(e[0][:2],e[1][:2]))
        if math.dist(a[:2],b[:2])>24:
            mid=tuple((a[k]+b[k])/2 for k in range(3))
            append(band,material,[a,mid,c],surface);append(band,material,[mid,b,c],surface)
            return
    global_tri=[(p[0]+band*SPACING,p[1],p[2]) for p in tri]
    base.setdefault(material,[]).extend(global_tri)
    if surface:
        x=sum(p[0] for p in global_tri)/3;y=sum(p[1] for p in global_tri)/3
        # A 256 m terrain body still streams through the shared 64 m index.
        # Preserve all triangles; avoid one body descriptor per large face.
        floors.setdefault((math.floor(x/256),math.floor(y/256)),[]).extend(global_tri)
    elif material=='parapet':
        x=sum(p[0] for p in global_tri)/3;y=sum(p[1] for p in global_tri)/3
        barriers.setdefault((math.floor(x/128),math.floor(y/128)),[]).extend(global_tri)


for obj in SCENE.objects:
    if obj.type!='MESH' or 'band' not in obj:continue
    name=obj.name;band=obj['band'];material=obj['material']
    if obj.get('runtime_replaced'):continue
    if obj.get('collider_boxes'):
        for box in json.loads(obj['collider_boxes']):structures.append([box[0]+band*SPACING,*box[1:]])
    # Building proxies are exported separately from surface geometry.
    if obj.get('massing_only') or name.startswith(('Reserved_','Supply_','Recovery_','Existing_')):continue
    if name.endswith('_diagram') or material=='return':continue
    if obj.get('transfer_reservation'):continue  # Their ramps/supports are not designed yet.
    if material not in ['earth','reserve','water','rail','arterial','local','expressway','walk','verge','ballast','structure','kerb','parapet']:continue
    palette[material]=obj.data.materials[0]['srgb']
    obj.data.calc_loop_triangles()
    for face in obj.data.loop_triangles:
        tri=[local(band,obj.matrix_world @ obj.data.vertices[i].co) for i in face.vertices]
        pieces=outside_study(tri) if band==0 else [tri]
        for poly in pieces:
            if band==0 and material not in ['water'] and not obj.get('runtime_transport'):
                poly=[collar(p) for p in poly]
            if band==0 and material=='water':
                # The preserved study uses 1.5 m water over its central reach.
                poly=[(x,y,h+(1.5-1.55)*max(0,1-max(abs(y)-400,0)/1000)) for x,y,h in poly]
            for i in range(1,len(poly)-1):
                is_surface=bool(obj.get('runtime_surface')) if obj.get('runtime_transport') else material not in ['water','rail']
                append(band,material,[poly[0],poly[i],poly[i+1]],is_surface)

# Query the exported visible terrain, not the planning formula, for the base
# of each candidate building. This includes the projection's chord height.
vertices=[];triangles=[]
for floor in floors.values():
    for i in range(0,len(floor),3):
        start=len(vertices)
        for x,y,h in floor[i:i+3]:
            a=x/R;vertices.append((math.cos(a)*(R-h),y,math.sin(a)*(R-h)))
        triangles.append((start,start+1,start+2))
tree=BVHTree.FromPolygons(vertices,triangles,all_triangles=True)
tile_data={}
box_faces=[(0,2,3),(0,3,1),(4,5,7),(4,7,6),(0,1,5),(0,5,4),(2,6,7),(2,7,3),(0,4,6),(0,6,2),(1,3,7),(1,7,5)]
districts={d['id']:d for d in plan['districts']}
for n,block in enumerate(blocks):
    band=block['band'];x,y,h=block['position'];w,d,height=block['size'];yaw=block['yaw']
    a=band*math.tau/3+x/R;direction=Vector((math.cos(a),0,math.sin(a)))
    hit=tree.ray_cast(Vector((0,y,0)),direction)
    if hit[0] is not None:h=R-math.hypot(hit[0].x,hit[0].z)
    h=max(.03,h)
    key=f'{band}-{math.floor((x+R*math.pi/6)/TILE)}-{math.floor((y+20000)/TILE)}'
    tile=tile_data.setdefault(key,{'band':band,'districts':set(),'boxes':[],'meshes':{}})
    tile['districts'].add(block['district'])
    material=districts[block['district']]['use']
    source_material=bpy.data.materials['SWC_'+material]
    palette[material]=source_material['srgb']
    tile['boxes'].append([x+band*SPACING,y,h,w,d,height,yaw,material])
    vs=[];c=math.cos(yaw);s=math.sin(yaw)
    # Foundation extends into the grade; roof height is the nominal massing.
    for z in [-1.2,height]:
        for sy in [-1,1]:
            for sx in [-1,1]:
                px,py=sx*w/2,sy*d/2
                vs.append((x+px*c-py*s+band*SPACING,y+px*s+py*c,h+z))
    out=tile['meshes'].setdefault(material,[])
    for face in box_faces:out.extend(vs[i] for i in face)


def pack(groups,surfaces=None,walls=None):
    pool=[];lookup={}
    def indices(vs):
        result=[]
        for p in vs:
            key=tuple(round(v,5) for v in p)
            if key not in lookup:lookup[key]=len(pool)//3;pool.extend(key)
            result.append(lookup[key])
        return result
    meshes={key:indices(vs) for key,vs in groups.items()}
    ss=[]
    for vs in (surfaces or {}).values():
        xs=[p[0] for p in vs];ys=[p[1] for p in vs]
        ss.append({'indices':indices(vs),'bounds':[min(xs),min(ys),max(xs),max(ys)]})
    for vs in (walls or {}).values():
        xs=[p[0] for p in vs];ys=[p[1] for p in vs]
        ss.append({'indices':indices(vs),'bounds':[min(xs),min(ys),max(xs),max(ys)],'groundSurface':False})
    return {'vertices':pool,'meshes':meshes,'surfaces':ss}


asset_dir=ROOT/'public/landscapes/izma'
asset_dir.mkdir(parents=True,exist_ok=True)
manifest={'version':1,'radius':R,'span':40000,'palette':palette,'base':pack(base,floors,barriers),'tiles':[],'structures':structures,
          'visits':{d['id']:{'band':d['band'],'position':d['centre']} for d in plan['districts']}}
for key,tile in sorted(tile_data.items()):
    packed=pack(tile['meshes'])
    encoded=json.dumps(packed,separators=(',',':'))+'\n'
    digest=hashlib.sha256(encoded.encode()).hexdigest()[:12]
    filename=key+'-'+digest+'.json'
    (asset_dir/filename).write_text(encoded)
    boxes=tile['boxes'];xs=[b[0] for b in boxes];ys=[b[1] for b in boxes]
    manifest['tiles'].append({'id':key,'url':'/landscapes/izma/'+filename,'band':tile['band'],
                              'bounds':[min(xs)-40,min(ys)-40,max(xs)+40,max(ys)+40],
                              'districts':sorted(tile['districts']),'boxes':boxes})
target=ROOT/'src/worlds/generated/izmaColony.json'
write_manifest(target, manifest)
result={'output':str(target),'baseBytes':target.stat().st_size,'tiles':len(tile_data),'boxes':len(blocks),
        'baseTriangles':sum(len(v)//3 for v in base.values()),'surfaceTiles':len(floors),
        'note':'terrain, graded transport and box massing; districts and full transport remain unfinished'}
