"""Author the first metre-scale cafe pilot in Blender, preserving its live lot.
Run in Blender: exec(compile(open(__file__).read(), __file__, 'exec')).
Source contract: cafe-pilot.json, extracted from Spinward's existing city plan.
"""
from pathlib import Path
import math,json
import bpy
from mathutils import Vector

ROOT=Path(__file__).resolve().parents[2]
CONTRACT=json.loads((ROOT/'assets/blender/cafe-pilot.json').read_text())
I=CONTRACT['interior']; W=I['frontage']; D=I['depth']; H=I['building']['height']; R=4.2
PREFIX='SWCP_'
# Only replace this generator's own objects on subsequent modelling passes.
scene=bpy.data.scenes.get('Spinward Cafe Pilot') or bpy.data.scenes.new('Spinward Cafe Pilot')
bpy.context.window.scene=scene
for obj in list(scene.objects):
    if obj.name.startswith(PREFIX) or obj.name.startswith('cafe_pilot_lod0'): bpy.data.objects.remove(obj,do_unlink=True)
scene.unit_settings.system='METRIC'
scene.unit_settings.scale_length=1
scene.world=scene.world or bpy.data.worlds.new(PREFIX+'World')
scene.world.use_nodes=True
scene.world.node_tree.nodes['Background'].inputs['Color'].default_value=(0.30,0.38,0.48,1)
scene.world.node_tree.nodes['Background'].inputs['Strength'].default_value=0.45
parts=[]

def rgb(h):
    v=[int(h[i:i+2],16)/255 for i in (0,2,4)]
    return tuple(x/12.92 if x<=0.04045 else ((x+0.055)/1.055)**2.4 for x in v)+(1,)

def mat(name,color,rough=0.8,metal=0,emission=None):
    m=bpy.data.materials.get(PREFIX+name) or bpy.data.materials.new(PREFIX+name)
    m.use_nodes=True;m.diffuse_color=rgb(color);m.roughness=rough;m.metallic=metal
    for n in list(m.node_tree.nodes):
        if n.name in ['SWCP_AO','SWCP_GltfOutput']:m.node_tree.nodes.remove(n)
    p=m.node_tree.nodes.get('Principled BSDF');p.inputs['Base Color'].default_value=rgb(color)
    p.inputs['Roughness'].default_value=rough;p.inputs['Metallic'].default_value=metal
    p.inputs['Emission Color'].default_value=rgb(emission or '000000')
    p.inputs['Emission Strength'].default_value=0.22 if emission else 0
    return m

stone=mat('STONE','c9c1b1');base=mat('PLINTH','7d817c');metal=mat('METAL','384c4d',.45,.45)
wood=mat('WOOD','896448',.76);glass=mat('GLASS','536d76',.2,.25)
shopglass=mat('SHOP_GLASS','536d76',.2,.25,'ffe0a7')
litglass=mat('WINDOW_LIGHT','819190',.26,.15,'ffe0a7');light=mat('LIGHT','eadab8',.6,0,'ffe2a6')
# Keep the entire asset to a small number of shared materials.

def mesh(name,verts,faces,material):
    me=bpy.data.meshes.new(PREFIX+name);me.from_pydata(verts,[],faces);me.update()
    o=bpy.data.objects.new(PREFIX+name,me);scene.collection.objects.link(o);me.materials.append(material);parts.append(o);return o

# Author in runtime X/Y/Z (Y up, Z street); convert to Blender Z up with -Y street.
def v(p):return(p[0],-p[2],p[1])

def box(name,x,y,z,w,h,d,material,bevel=0):
    pts=[v((x+sx*w/2,y+sy*h/2,z+sz*d/2)) for sx,sy,sz in [(-1,-1,-1),(1,-1,-1),(1,1,-1),(-1,1,-1),(-1,-1,1),(1,-1,1),(1,1,1),(-1,1,1)]]
    o=mesh(name,pts,[(0,3,2,1),(4,5,6,7),(0,1,5,4),(1,2,6,5),(2,3,7,6),(3,0,4,7)],material)
    if bevel:
        mod=o.modifiers.new('Edge bevel','BEVEL');mod.width=bevel;mod.segments=1
        bpy.context.view_layer.objects.active=o;o.select_set(True)
        bpy.ops.object.modifier_apply(modifier=mod.name);o.select_set(False)
    return o

# Ground floor retains the exact wall/door and furniture volumes used by physics.
# The front wings are separately modelled below; the portal is 3.2 x 3.1 m.
for k,p in enumerate(I['parts']):
    if p['material']=='upper':continue
    if p['detail']<3:continue
    if p['z']>D/2-.5:continue
    box('GroundStructure'+str(k),p['x'],p['y'],p['z'],p['width'],p['height'],p['depth'],stone)

# Front wings: recessed opaque glass still represents the existing solid pane.
# The central 3.2 m walk-through opening remains physically and visually clear.
# Non-solid overhead canopies project 0.66 m into the existing 2 m approach.
for side in [-1,1]:
    wing=(W-3.2)/2; cx=side*(W+3.2)/4
    box('FrontSill',cx,.30,D/2-.15,wing,.60,.30,base)
    box('FrontFascia',cx,3.63,D/2-.15,wing,1.14,.30,stone)
    count=max(2,round(wing/2.9));pitch=wing/count
    for j in range(count):
        x=cx-wing/2+(j+.5)*pitch
        box('ShopGlass',x,1.84,D/2-.20,pitch-.18,2.43,.055,shopglass)
        for dx in [-pitch/2+.06,pitch/2-.06]:
            box('ShopMullion',x+dx,1.84,D/2-.12,.12,2.5,.18,metal,.01)
        box('WindowSill',x,.64,D/2-.09,pitch-.08,.10,.18,stone,.015)
        box('ShopTransom',x,2.70,D/2-.11,pitch-.10,.08,.16,metal)
        # A timber panel under the display gives the base a human-scale datum.
        box('TimberKick',x,.29,D/2+.005,pitch-.17,.40,.035,wood)
    box('Canopy',cx,3.30,D/2+.10,wing,.18,1.02,metal,.025)
    box('CanopySoffit',cx,3.195,D/2+.10,wing-.15,.03,.74,wood)
    box('CanopyLight',cx,3.18,D/2+.10,wing-.6,.025,.06,light)
# Original lintel + a visibly separate entrance surround.
box('EntryLintel',0,3.65,D/2-.15,3.2,1.1,.3,stone)
for side in [-1,1]:
    box('EntryJamb',side*1.69,1.55,D/2-.13,.18,3.10,.30,metal,.02)
box('EntryCanopy',0,3.28,D/2+.10,3.58,.17,1.12,metal,.025)
box('EntryLamp',0,3.175,D/2+.10,3.0,.025,.065,light)
box('EntrySignBacking',0,3.82,D/2+.015,3.6,.45,.03,metal)

# Text is real mesh at close range; no font dependency in the runtime.
curve=bpy.data.curves.new(PREFIX+'CafeSign','FONT');curve.body='ORBIT  CAFE';curve.align_x='CENTER';curve.align_y='CENTER';curve.size=.27;curve.extrude=.002
obj=bpy.data.objects.new(PREFIX+'CafeSign',curve);scene.collection.objects.link(obj);obj.location=v((0,3.82,D/2+.035));obj.rotation_euler=(math.pi/2,0,0);curve.materials.append(light)
bpy.context.view_layer.objects.active=obj;obj.select_set(True);bpy.ops.object.convert(target='MESH');obj.select_set(False);parts.append(obj)

# Shared local facade frame: u runs horizontally, n points out from each wall.
def facade(u,y,n,side):
    if side==0:return (u,y,n)
    if side==1:return (-u,y,-n)
    if side==2:return (n,y,-u)
    return (-n,y,u)

def facequad(name,coords,side,material):
    return mesh(name,[v(facade(*p,side)) for p in coords],[(0,1,2,3)],material)

def facadebox(name,u,y,n,w,h,d,side,material):
    x,yy,z=facade(u,y,n,side)
    return box(name,x,yy,z,w if side<2 else d,h,d if side<2 else w,material)

# Upper walls are a continuous grid with genuinely recessed window planes.
floors=max(1,round((H-R)/3.35));fh=(H-R)/floors
for side in range(4):
    span=W if side<2 else D; depth=D/2 if side<2 else W/2
    bays=max(3,round(span/3.2));pitch=span/bays;ww=pitch*.64;wh=fh*.54
    for row in range(floors):
        bottom=R+row*fh; wy=bottom+fh*.49
        for col in range(bays):
            u=-span/2+(col+.5)*pitch; left=u-ww/2;right=u+ww/2;lo=wy-wh/2;hi=wy+wh/2
            # Four coplanar opaque regions surround the opening; no hidden
            # duplicate wall exists behind the window plane.
            for x0,x1,y0,y1 in [(u-pitch/2,u+pitch/2,bottom,lo),(u-pitch/2,u+pitch/2,hi,bottom+fh),(u-pitch/2,left,lo,hi),(right,u+pitch/2,lo,hi)]:
                facequad('Wall',[(x0,y0,depth),(x1,y0,depth),(x1,y1,depth),(x0,y1,depth)],side,stone)
            for coords in [ [(left,lo,depth),(left,lo,depth-.19),(left,hi,depth-.19),(left,hi,depth)],[(right,lo,depth-.19),(right,lo,depth),(right,hi,depth),(right,hi,depth-.19)],[(left,lo,depth-.19),(left,lo,depth),(right,lo,depth),(right,lo,depth-.19)],[(left,hi,depth),(left,hi,depth-.19),(right,hi,depth-.19),(right,hi,depth)] ]:
                facequad('WindowReveal',coords,side,base)
            m=litglass if (row*11+col*7+side*13)%9<3 else glass
            facequad('Window',[(left,lo,depth-.19),(right,lo,depth-.19),(right,hi,depth-.19),(left,hi,depth-.19)],side,m)
            facadebox('Sill',u,lo,depth-.06,ww+.08,.085,.25,side,stone)
            # Single mullion close enough to read without several nested boxes.
            facadebox('WindowDivider',u,wy,depth-.135,.035,wh,.06,side,metal)
    # The cornice belongs to the same original envelope; no change in roof height.
    facadebox('Cornice',0,H-.16,depth-.06,span,.24,.12,side,base)
    facadebox('GroundDatum',0,R+.10,depth-.02,span,.20,.08,side,base)
# Roof deck and a recessed perimeter parapet, all below the existing roof collider.
box('RoofDeck',0,H-.16,0,W,.12,D,base)
for side in [-1,1]:
    box('Parapet',side*(W/2-.12),H-.10,0,.24,.20,D,stone)
    box('Parapet',0,H-.10,side*(D/2-.12),W-.48,.20,.24,stone)
# Ceiling closes the inaccessible upper floors and matches the room ceiling.
box('RoomCeiling',0,R+.04,0,W-.6,.08,D-.6,stone)

# Same solid furnishings as existing cafe; joinery and small objects stay
# within those volumes so no new invisible obstruction is introduced.
for k,p in enumerate(I['parts']):
    if p['detail']>=3 or p['material'] in ['sign']:continue
    if p['material']=='light' and p['y']>3:continue
    if p['material']=='light' and p['y']>2:continue
    if p['material']=='wood':
        box('Furniture'+str(k),p['x'],p['y'],p['z'],p['width'],p['height'],p['depth'],wood,min(.025,p['height']*.15))
    elif p['material']=='light':
        box('Ceramic'+str(k),p['x'],p['y'],p['z'],p['width'],p['height'],p['depth'],stone,.012)
# Ceiling strips are mounted overhead and do not create floor collision.
for x in [-W*.27,W*.27]:
    box('RoomLightHousing',x,R-.09,0,.32,.06,D*.65,metal)
    box('RoomLight',x,R-.13,0,.20,.02,D*.62,light)

# Consolidate geometry by material. Named components are authored above;
# regenerate them from this script. glTF emits one primitive per material.
for o in list(bpy.context.selected_objects):o.select_set(False)
for o in parts:o.select_set(True)
bpy.context.view_layer.objects.active=parts[0]
bpy.ops.object.join();model=bpy.context.object;model.name='cafe_pilot_lod0'
model.data.name='cafe_pilot_lod0_mesh'
# Recalculate normals after joining the hand-built surfaces.
bpy.ops.object.mode_set(mode='EDIT');bpy.ops.mesh.select_all(action='SELECT');bpy.ops.mesh.remove_doubles(threshold=0.00001);bpy.ops.mesh.normals_make_consistent(inside=False);bpy.ops.object.mode_set(mode='OBJECT')
model.data.calc_loop_triangles()
# Pack the AO atlas with a two-pixel gutter at 2048. A large fractional
# margin collapses thousands of small islands into subpixel UV regions.
bpy.ops.object.mode_set(mode='EDIT');bpy.ops.mesh.select_all(action='SELECT');bpy.ops.uv.smart_project(angle_limit=math.radians(66),island_margin=.001,margin_method='FRACTION');bpy.ops.object.mode_set(mode='OBJECT')
model['spinward_stage']='cafe-pilot-1';model['lod']=0;model['units']='metres'
# Frame the asset in the connected Blender viewport.
for window in bpy.context.window_manager.windows:
    if window.scene!=scene:continue
    for area in window.screen.areas:
        if area.type=='VIEW_3D':
            space=area.spaces.active
            space.shading.type='MATERIAL'
            space.region_3d.view_location=Vector((0,0,H*.42));space.region_3d.view_distance=H*1.7
            space.region_3d.view_rotation=Vector((1,-1,.6)).to_track_quat('Z','Y')
# Export only the pilot mesh, preserving native metres and materials.
path=ROOT/'public/assets/buildings/cafe-pilot.glb'
blendpath=ROOT/'assets/blender/cafe-pilot.blend'
bakepath=ROOT/'assets/blender/bake_cafe_pilot.py'
exec(compile(bakepath.read_text(),str(bakepath),'exec'),{'__file__':str(bakepath),'__name__':'__main__'})
report={'stage':1,'name':model.name,'triangles':len(model.data.loop_triangles),'vertices':len(model.data.vertices),'materials':len(model.data.materials),'native_dimensions':list(model.dimensions),'source':str(blendpath.relative_to(ROOT)),'glb':str(path.relative_to(ROOT)),'bytes':path.stat().st_size,'contract':CONTRACT['interior']['building'],'ao':{'size':[2048,2048],'images':1,'method':'Cycles contact AO, 0.7 m radius, 32 samples'},'limitations':['Master exceeds the planned 8–12k LOD0 target.','Buried-triangle and reference comparison audit pending.']}
(ROOT/'assets/blender/cafe-pilot-audit.json').write_text(json.dumps(report,indent=2))
print(json.dumps(report))
