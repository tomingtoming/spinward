"""Build a full-scale, editable three-strip Izma planning model through MCP.

Input is the authored plan JSON. No existing study scene is modified. The
separate .blend contains a metric unrolled model and its cylindrical mapping.
These are massing studies: road grades, junction ramps and detail LODs are not
finished. Diagram-only strokes and labels never enter the cylinder model.
"""
import bpy
import json
import math
import random
from pathlib import Path
from mathutils import Vector

ROOT = Path(__file__).resolve().parents[2]
PLAN = json.loads((ROOT/'assets/blender/izma-colony-plan.json').read_text())
OUT = ROOT/'qa/webxr/evidence/colony-plan-20260917'
OUT.mkdir(parents=True, exist_ok=True)
OWNER = 'spinward-izma-colony-plan-v1'
R = PLAN['radius']
HALF = R*PLAN['landArcRadians']/2
SEPARATION = math.tau*R/3
NODES = {n['id']:n for n in PLAN['nodes']}
PALETTE = {
    'earth': '#718563', 'reserve': '#59664f', 'water': '#4f929b',
    'rail': '#dabd72', 'arterial': '#656963', 'local': '#7c8176',
    'expressway': '#ba967d', 'transfer': '#d8c9a6', 'walk': '#ada992',
    'mixed': '#c5b39a', 'housing': '#dbd1b8', 'civic': '#bebec4',
    'campus': '#c6b6a7', 'industry': '#919ca0', 'farming': '#c1b390',
    'park': '#b6bda0', 'utility': '#7e8b8e', 'station': '#f1db9f',
    'return': '#76a6ad', 'study': '#eb9f77', 'text': '#e7e1cf', 'dark': '#202c2b'
}
materials = {}
for key, colour in PALETTE.items():
    mat = bpy.data.materials.get('SWC_'+key) or bpy.data.materials.new('SWC_'+key)
    mat.diffuse_color = tuple(int(colour[i:i+2],16)/255 for i in (1,3,5))+(1,)
    mat['srgb'] = colour
    materials[key] = mat
for use in ['mixed','housing','civic','campus','industry','farming','park']:
    mat=bpy.data.materials.new('SWC_diagram_'+use)
    mat.diffuse_color=tuple(materials['earth'].diffuse_color[i]*.5+materials[use].diffuse_color[i]*.5 for i in range(3))+(1,)
    materials['diagram_'+use]=mat


def new_scene(name):
    old = bpy.data.scenes.get(name)
    if old:
        if old.get('owner') != OWNER:
            raise RuntimeError('Unowned scene '+name)
        for obj in list(old.objects):
            bpy.data.objects.remove(obj, do_unlink=True)
        bpy.data.scenes.remove(old)
    scene = bpy.data.scenes.new(name)
    scene['owner'], scene['status'] = OWNER, PLAN['status']
    scene['plan_version'] = PLAN['version']
    scene.unit_settings.system = 'METRIC'
    scene.unit_settings.scale_length = 1
    return scene


flat = new_scene('SWC_izma_unrolled')
wrapped = new_scene('SWC_izma_cylinder')
all_objects = []
block_records = []
bridge_reservations = []


def map_point(band, p, wrap):
    x,y,h = p
    if not wrap:
        return (y, -band*SEPARATION-x, h)
    a = band*math.tau/3+x/R
    return (math.cos(a)*(R-h), y, math.sin(a)*(R-h))


def mesh(name, band, vs, fs, material, props=None, diagram=False, wrap_only=False):
    objs = []
    source_id = name+':'+str(len(all_objects))
    for scene, wrap in [(flat,False),(wrapped,True)]:
        if diagram and wrap:
            continue
        if wrap_only and not wrap:
            continue
        vertices = [map_point(band,p,wrap) for p in vs]
        data = bpy.data.meshes.new(name)
        data.from_pydata(vertices, [], fs); data.update()
        obj = bpy.data.objects.new(name, data)
        obj.data.materials.append(materials[material])
        scene.collection.objects.link(obj)
        obj['band'], obj['material'], obj['design_status'] = band, material, 'blockout'
        obj['source_id'] = source_id
        for k,v in (props or {}).items():
            obj[k] = v
        objs.append(obj)
    all_objects.extend(objs)
    return objs


def interpolate(points,y):
    for a,b in zip(points,points[1:]):
        if y <= b[1]:
            t = max(0,min(1,(y-a[1])/(b[1]-a[1])))
            return (a[0]+(b[0]-a[0])*t, a[2]+(b[2]-a[2])*t)
    return points[-1][0],points[-1][2]


def water_at(band,y):
    return interpolate(PLAN['water'][band]['reach'],y)


def smooth(a,b,x):
    t=max(0,min(1,(x-a)/(b-a)))
    return t*t*(3-2*t)


def ground(band,x,y):
    river,h = water_at(band,y)
    w = PLAN['water'][band]['width']
    banks = PLAN['water'][band]['bankWidth']
    d = abs(x-river)
    z = max(.12,h-1.7)+4*smooth(w/2,w/2+20,d)+5*smooth(w/2+30,banks,d)
    for hill in PLAN['hills']:
        if hill['band'] != band: continue
        hx,hy=hill['centre'];sx,sy=hill['size']
        z += hill['height']*math.exp(-((x-hx)/sx)**2-((y-hy)/sy)**2)*smooth(w/2+25,banks+120,d)
    # End and edge reserves return to a service deck above the hull.
    mask = smooth(0,200,HALF-abs(x))*smooth(0,850,20000-abs(y))
    return 1+(z-1)*mask


def terrain(band):
    water=PLAN['water'][band];w=water['width'];bank=water['bankWidth']
    def columns(y):
        c,_=water_at(band,y)
        left=[-HALF+i*(c-360+HALF)/20 for i in range(20)]
        middle=[c+d for d in [-360,-250,-bank,-w/2-30,-w/2-12,-w/2-2,0,w/2+2,w/2+12,w/2+30,bank,250,360]]
        right=[c+360+i*(HALF-c-360)/20 for i in range(1,21)]
        return left+middle+right
    ys=sorted(set([-20000+i*160 for i in range(251)]+[p[1] for p in water['reach']]))
    ncols=len(columns(0))
    vs=[(x,y,ground(band,x,y)) for y in ys for x in columns(y)]
    fs=[]
    for j in range(len(ys)-1):
        for i in range(ncols-1):
            a=j*ncols+i;b=a+1;c=b+ncols;d=a+ncols
            fs.extend([(a,b,c),(a,c,d)])
    terrain_objects=mesh('Terrain_band_'+str(band),band,vs,fs,'earth',{'surface':'planning terrain; final collision pending'})
    diagram=terrain_objects[0]
    districts=[d for d in PLAN['districts'] if d['band']==band]
    for d in districts:diagram.data.materials.append(materials['diagram_'+d['use']])
    for face in diagram.data.polygons:
        axial=sum(diagram.data.vertices[v].co.x for v in face.vertices)/len(face.vertices)
        for i,d in enumerate(districts):
            if d['axial'][0]<=axial<d['axial'][1]:face.material_index=i+1;break
    for y in [-19250,19250]:
        ribbon('End_reserve',band,[[-HALF,y],[HALF,y]],1500,'reserve',lambda x,y:ground(band,x,y)+.3)


def ribbon(name, band, points, width, material, altitude=None, diagram=False):
    vs=[];fs=[]
    for a,b in zip(points,points[1:]):
        length=math.hypot(b[0]-a[0],b[1]-a[1])
        count=max(1,math.ceil(length/70))
        dx,dy=(b[0]-a[0])/max(length,.001),(b[1]-a[1])/max(length,.001)
        for i in range(count+1):
            t=i/count;x=a[0]+(b[0]-a[0])*t;y=a[1]+(b[1]-a[1])*t
            for side in [-1,1]:
                px,py=x-dy*width/2*side,y+dx*width/2*side
                z=altitude(px,py) if altitude else ground(band,px,py)+1.5
                vs.append((px,py,z))
            if i:
                c=len(vs)-4;fs.append((c,c+1,c+3,c+2))
    return mesh(name,band,vs,fs,material,{'route_reservation':True},diagram)


def append_box(vs,fs,x,y,z,w,d,h,yaw=0):
    start=len(vs);c=math.cos(yaw);s=math.sin(yaw)
    for sz in [0,1]:
        for sy in [-1,1]:
            for sx in [-1,1]:
                px,py=sx*w/2,sy*d/2
                vs.append((x+px*c-py*s,y+px*s+py*c,z+sz*h))
    fs.extend(tuple(start+i for i in face) for face in [(0,2,3,1),(4,5,7,6),(0,1,5,4),(2,6,7,3),(0,4,6,2),(1,3,7,5)])


def box(name,band,x,y,z,w,d,h,mat,yaw=0):
    vs=[];fs=[];append_box(vs,fs,x,y,z,w,d,h,yaw)
    return mesh(name,band,vs,fs,mat)


def text(label,x,y,size=160):
    data=bpy.data.curves.new('Label','FONT');data.body=label;data.size=size
    data.align_x='LEFT';data.space_character=1.05
    obj=bpy.data.objects.new('Label_'+label,data)
    flat.collection.objects.link(obj);obj.location=(x,y,350)
    data.materials.append(materials['text'])
    obj['diagram_only']=True


def distance_to_segment(x,y,a,b):
    dx,dy=b[0]-a[0],b[1]-a[1]
    t=max(0,min(1,((x-a[0])*dx+(y-a[1])*dy)/max(.001,dx*dx+dy*dy)))
    return math.hypot(x-a[0]-t*dx,y-a[1]-t*dy)


road_segments = [[] for _ in range(3)]
for route in PLAN['routes']:
    for aid,bid in zip(route['nodes'],route['nodes'][1:]):
        a,b=NODES[aid],NODES[bid]
        if a['band']==b['band']:
            road_segments[a['band']].append((a['xy'],b['xy'],route['width'],route['kind']))


def build_blocks(band):
    rng=random.Random(3400+band)
    meshes={d['id']:([],[]) for d in PLAN['districts'] if d['band']==band}
    occupied={}
    for a,b,width,kind in road_segments[band]:
        if kind not in ['local','arterial']:continue
        length=math.dist(a,b);dx,dy=(b[0]-a[0])/length,(b[1]-a[1])/length
        count=int(length/64)
        for i in range(1,count):
            t=i/count;y=a[1]+(b[1]-a[1])*t
            district=next((d for d in PLAN['districts'] if d['band']==band and d['axial'][0]<=y<d['axial'][1]),None)
            if not district:continue
            density={'park':.09,'farming':.14,'industry':.6,'housing':.78}.get(district['use'],.92)
            for side in [-1,1]:
                if rng.random()>density:continue
                w=rng.uniform(22,42) if district['use']=='industry' else rng.uniform(12,25)
                depth=rng.uniform(28,58) if district['use']=='industry' else rng.uniform(14,32)
                setback=width/2+depth/2+rng.uniform(8,17)
                x=a[0]+(b[0]-a[0])*t-dy*setback*side
                py=y+dx*setback*side
                radius=math.hypot(w,depth)/2
                river,_=water_at(band,py)
                if abs(x-river)<PLAN['water'][band]['bankWidth']+radius:continue
                if abs(x)+radius>HALF-PLAN['edgeReserve']:continue
                if band==0 and -350<x<350 and -430<py<430:continue
                key=(math.floor(x/80),math.floor(py/80))
                if any(math.hypot(x-ox,py-oy)<radius+pr+6 for kx in range(key[0]-1,key[0]+2) for ky in range(key[1]-1,key[1]+2) for ox,oy,pr in occupied.get((kx,ky),[])):continue
                if any(distance_to_segment(x,py,ra,rb)<rw/2+radius+5 for ra,rb,rw,_ in road_segments[band]):continue
                occupied.setdefault(key,[]).append((x,py,radius))
                height=rng.randint(*district['storeys'])*3.2
                yaw=math.atan2(dy,dx);z=ground(band,x,py)
                vs,fs=meshes[district['id']]
                append_box(vs,fs,x,py,z,w,depth,height,yaw)
                block_records.append({'district':district['id'],'band':band,'position':[round(x,3),round(py,3),round(z,3)],
                                      'size':[round(w,3),round(depth,3),round(height,3)],'yaw':round(yaw,6)})
    for district_id,(vs,fs) in meshes.items():
        district=next(d for d in PLAN['districts'] if d['id']==district_id)
        mesh('Massing_'+district_id,band,vs,fs,district['use'],{'district':district_id,'massing_only':True,'blocks':len(vs)//8})


for band in range(3):
    terrain(band)
    water=PLAN['water'][band]
    ribbon('River_'+str(band),band,water['reach'],water['width'],'water',lambda x,y,b=band:water_at(b,y)[1]+.15)
    # A dashed underground return pipe in the diagram only. The cylinder
    # model keeps it below the surface; it is not another glowing river.
    for y in range(-18200,18200,500):
        ribbon('Pumped_return_diagram',band,[[1430,y],[1430,y+220]],24,'return',lambda x,y:260,True)
    for end in [0,-1]:
        x,y,h=water['reach'][end]
        box(('Recovery_' if end==0 else 'Supply_')+str(band),band,x+200,y,ground(band,x+200,y),160,220,20,'utility')
    build_blocks(band)
    # Window border girders: structural reservation distinct from urban ground.
    for edge in [-HALF,HALF]:
        ribbon('Window_edge_'+str(band),band,[[edge,-20000],[edge,20000]],32,'reserve',lambda x,y:0)
    text(chr(65+band)+' / '+PLAN['bands'][band]['nameEn'].upper(),-17800,-band*SEPARATION+2600,320)
    for d in [d for d in PLAN['districts'] if d['band']==band]:
        label=d['id'].upper()+'\n'+d['fabric'].upper()
        label_x=d['axial'][0]+200
        estimated_width=max(map(len,label.split('\n')))*220*.7
        for transfer_y in [-19000,6500,19000]:
            if label_x-100<transfer_y<label_x+estimated_width+100:label_x=transfer_y+250
        text(label,label_x,-band*SEPARATION+2130,220)


for route in PLAN['routes']:
    ns=[NODES[n] for n in route['nodes']]
    if len({n['band'] for n in ns})==1:
        band=ns[0]['band'];points=[n['xy'] for n in ns]
        lift=18 if route['kind']=='expressway' else 2
        def altitude(x,y,b=band,lift=lift):
            river,h=water_at(b,y)
            return max(ground(b,x,y)+lift,h+8)
        ribbon(route['id'],band,points,route['width'],route['kind'],altitude)
        ribbon(route['id']+'_diagram',band,points,max(45,route['width']),route['kind'],lambda x,y:200,True)
        for a,b in zip(points,points[1:]):
            for i in range(21):
                t=i/20;x=a[0]+(b[0]-a[0])*t;y=a[1]+(b[1]-a[1])*t
                river,h=water_at(band,y)
                if abs(x-river)<PLAN['water'][band]['width']/2:
                    bridge_reservations.append({'route':route['id'],'band':band,'position':[x,y],'status':'crossing requires final deck and clearance'})
                    break
    else:
        a,b=ns;band=a['band'];y=a['xy'][1]
        # Always run forward to the next band, including C -> A across 2pi.
        start=band*math.tau/3+a['xy'][0]/R
        end=(band+1)*math.tau/3+b['xy'][0]/R
        width=route['width'];vs=[];fs=[]
        height=105 if y==6500 else 30
        # Reserve separate road and rail decks at the centre crossing.
        if route['kind']=='expressway':height+=18
        count=160
        for i in range(count+1):
            angle=start+(end-start)*i/count
            x=(angle-band*math.tau/3)*R
            vs.extend([(x,y-width/2,height),(x,y+width/2,height)])
            if i:c=len(vs)-4;fs.append((c,c+1,c+3,c+2))
        mesh(route['id'],band,vs,fs,route['kind'],{'transfer_reservation':True,'ramps_pending':True},wrap_only=band==2)


for node in PLAN['nodes']:
    if node['role'] not in ['station','transfer','interchange']:continue
    x,y=node['xy'];band=node['band']
    material='station' if node['role']!='interchange' else 'expressway'
    box('Reserved_'+node['id'],band,x,y,ground(band,x,y)+5,70,180,12,material)

# The completed district's exact footprint is visible without claiming the
# surrounding blockout is integrated with its collision or existing entrances.
ribbon('Existing_640x800_study',0,[[-320,-400],[320,-400],[320,400],[-320,400],[-320,-400]],32,'study',lambda x,y:250,True)

text('SPINWARD / IZMA - THREE STRIPS, 40 KM',-19800,3900,460)
text('AUTHORED LAND-USE + TRANSPORT BLOCKOUT / 2026-09-17',-19800,3310,240)
text('GOLD: RAIL     GRAY: GENERAL ROAD     TAN: EXPRESSWAY     BLUE: WATER     DASHED: PUMPED RETURN     CORAL: COMPLETED STUDY',-19800,-17700,220)
text('ALIGNMENTS AND MASSING ONLY - RAMPS, GRADES, PARCELS AND PLAYABLE CONNECTIONS REMAIN TO BE BUILT.',-19800,-18200,215)
text('C -> A TRANSFERS CONTINUE ACROSS THE UNROLLED MAP SEAM (VISIBLE IN THE CYLINDER MODEL).',-19800,-17200,220)
text('Diagram strokes enlarged; terrain tint = primary land use. Terrain and cylinder dimensions are metric.',-19800,-18700,220)
for y in [-20000,-10000,0,10000,20000]:
    text(f'{y/1000:+.0f} km',y-380,-19500,180)


def camera(scene,name,position,target,scale=None):
    data=bpy.data.cameras.new(name);obj=bpy.data.objects.new(name,data);scene.collection.objects.link(obj)
    obj.location=position;obj.rotation_euler=(Vector(target)-obj.location).to_track_quat('-Z','Y').to_euler()
    # The closest visible surface in these overview cameras is kilometres
    # away. A 10 cm near plane wastes depth precision over the 40 km model
    # and made the shallow river flicker against its bed in Workbench.
    data.clip_start=100;data.clip_end=100000
    if scale:data.type='ORTHO';data.ortho_scale=scale
    else:data.lens=22
    scene.camera=obj
    return obj


def render(scene,name,width,height):
    scene.render.engine='BLENDER_WORKBENCH'
    scene.display.shading.light='FLAT';scene.display.shading.color_type='MATERIAL'
    scene.display.shading.show_shadows=False;scene.display.shading.show_cavity=True
    scene.display.shading.cavity_type='BOTH';scene.display.shading.show_specular_highlight=False
    scene.display.shading.background_type='WORLD'
    scene.world=bpy.data.worlds.new('SWC_world_'+name);scene.world.color=(.025,.04,.04)
    scene.render.resolution_x=width;scene.render.resolution_y=height;scene.render.resolution_percentage=100
    scene.render.image_settings.file_format='PNG';scene.render.filepath=str(OUT/(name+'.png'))
    scene.view_settings.view_transform='Standard'
    bpy.ops.render.render(write_still=True,scene=scene.name)


camera(flat,'Unrolled_plan_camera',(0,-7500,65000),(0,-7500,0),44000)
camera(wrapped,'End_axis_camera',(0,-21500,0),(0,0,0))
render(flat,'unrolled',2400,1360)
render(wrapped,'cylinder',1600,1000)
camera(wrapped,'Oblique_camera',(14000,-36000,15000),(0,-3000,0),46500)
render(wrapped,'oblique',1600,1000)

scenes={flat,wrapped}
bpy.context.view_layer.update()
blend=ROOT/'assets/blender/izma-colony.blend'
bpy.data.libraries.write(str(blend),scenes,fake_user=True,compress=True)
# Keep positions as a build artifact for future instanced LODs. It is derived
# from the model recipe, not another runtime random generator.
(ROOT/'assets/blender/izma-colony-blocks.json').write_text(json.dumps(block_records,separators=(',',':'))+'\n')
counts={}
for scene in scenes:
    triangles=0
    for obj in scene.objects:
        if obj.type=='MESH':obj.data.calc_loop_triangles();triangles+=len(obj.data.loop_triangles)
    counts[scene.name]={'objects':len(scene.objects),'triangles':triangles}
result={'blend':str(blend),'blockCount':len(block_records),'districts':len(PLAN['districts']),
        'scenes':counts,'bridgeReservations':len(bridge_reservations),
        'status':'full extent model; not yet playable or finished terrain',
        'renders':[str(OUT/(n+'.png')) for n in ['unrolled','cylinder','oblique']]}
(OUT/'model.json').write_text(json.dumps(result,indent=2)+'\n')
(OUT/'bridge-reservations.json').write_text(json.dumps(bridge_reservations,indent=2)+'\n')
