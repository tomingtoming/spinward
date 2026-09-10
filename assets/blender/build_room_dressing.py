"""Small non-solid furnishings for the two existing public rooms.
All anchors come from their metre-scale interior contracts. The walkways stay clear.
"""
import bpy,math,json,sys
from pathlib import Path
from mathutils import Vector
sys.dont_write_bytecode=True
ROOT=Path(__file__).resolve().parents[2];sys.path.insert(0,str(ROOT/'assets/blender'))
import importlib,building_mesh_kit
importlib.reload(building_mesh_kit)
from building_mesh_kit import MeshBuilder,local,join,export
scene=bpy.data.scenes.get('Spinward Room Dressing') or bpy.data.scenes.new('Spinward Room Dressing');bpy.context.window.scene=scene
scene.unit_settings.system='METRIC';scene.unit_settings.scale_length=1
for o in list(scene.objects):bpy.data.objects.remove(o,do_unlink=True)
def rgb(h):
 v=[int(h[i:i+2],16)/255 for i in (0,2,4)]
 return tuple(x/12.92 if x<=.04045 else ((x+.055)/1.055)**2.4 for x in v)+(1,)
def mat(name,color,rough=.8,metallic=0):
 m=bpy.data.materials.get('SWRM_'+name) or bpy.data.materials.new('SWRM_'+name);m.use_nodes=True;m.node_tree.nodes.clear()
 p=m.node_tree.nodes.new('ShaderNodeBsdfPrincipled');out=m.node_tree.nodes.new('ShaderNodeOutputMaterial');m.node_tree.links.new(p.outputs['BSDF'],out.inputs['Surface'])
 p.inputs['Base Color'].default_value=rgb(color);p.inputs['Roughness'].default_value=rough;p.inputs['Metallic'].default_value=metallic
 p.inputs['Emission Color'].default_value=rgb(color);p.inputs['Emission Strength'].default_value=.035
 return m
ivory=mat('IVORY','e4d9bc',.5);metal=mat('METAL','9eaaa8',.3,.45);dark=mat('DARK','243c3b',.6);coffee=mat('COFFEE','493226',.86);terra=mat('TERRA','b06b4a');leaf=mat('LEAF','477252');paper=mat('PAPER','cbb783')
mats=[ivory,metal,dark,coffee,terra,leaf,paper]
def lathe(b,x,y,z,profile,material,n=12):
 for (r0,h0),(r1,h1) in zip(profile,profile[1:]):
  for j in range(n):
   a=2*math.pi*j/n;v=2*math.pi*(j+1)/n
   b.face([local(x+r0*math.cos(a),y+h0,z+r0*math.sin(a)),local(x+r0*math.cos(v),y+h0,z+r0*math.sin(v)),local(x+r1*math.cos(v),y+h1,z+r1*math.sin(v)),local(x+r1*math.cos(a),y+h1,z+r1*math.sin(a))],material)
def pipe(b,start,end,radius,material,n=8):
 a,bp=Vector(local(*start)),Vector(local(*end));axis=(bp-a).normalized();u=axis.orthogonal().normalized();v=axis.cross(u)
 rings=[[p+radius*(u*math.cos(2*math.pi*j/n)+v*math.sin(2*math.pi*j/n)) for j in range(n)] for p in [a,bp]]
 for j in range(n):b.face([rings[0][j],rings[0][(j+1)%n],rings[1][(j+1)%n],rings[1][j]],material)
 b.face(list(reversed(rings[0])),material);b.face(rings[1],material)
def cup(b,x,y,z,r=.11):
 # The hollow lip and coffee surface enclose the previous simple ceramic proxy.
 lathe(b,x,y,z,[(0,0),(r*.88,0),(r,.24),(r*.83,.24),(r*.78,.21),(0,.21)],ivory)
 lathe(b,x,y+.211,z,[(0,0),(r*.77,0)],coffee)
 # Closed handle on one side, eight short tube segments.
 for j in range(8):
  a=2*math.pi*j/8;v=2*math.pi*(j+1)/8
  pipe(b,(x+r+.065*math.cos(a),y+.13+.08*math.sin(a),z),(x+r+.065*math.cos(v),y+.13+.08*math.sin(v),z),.018,ivory,6)
def plant(b,x,y,z):
 lathe(b,x,y,z,[(0,0),(.17,0),(.235,.30),(.245,.31),(.245,.34),(.215,.34),(.20,.29),(0,.29)],terra)
 lathe(b,x,y+.292,z,[(0,0),(.20,0)],coffee)
 for j in range(7):
  a=j*2.4;top=.66+.12*(j%3);dx=math.cos(a)*.31;dz=math.sin(a)*.31
  pipe(b,(x,y+.29,z),(x+dx*.42,y+top,z+dz*.42),.01,leaf,5)
  center=Vector(local(x+dx*.65,y+top-.08,z+dz*.65));tip=Vector(local(x+dx,y+top+.08,z+dz));base=Vector(local(x+dx*.2,y+top-.25,z+dz*.2));width=Vector(local(-math.sin(a)*.105,0,math.cos(a)*.105))
  b.face([base,center-width,tip,center+Vector((0,0,.025))],leaf);b.face([base,center+Vector((0,0,.025)),tip,center+width],leaf)
def text(parts,body,x,y,z,size,material=ivory):
 c=bpy.data.curves.new('SWRM_Letters','FONT');c.body=body;c.align_x='CENTER';c.align_y='CENTER';c.size=size;c.resolution_u=3;c.extrude=0
 o=bpy.data.objects.new('SWRM_Letters',c);scene.collection.objects.link(o);o.location=local(x,y,z);o.rotation_euler=(math.pi/2,0,0);c.materials.append(material)
 for s in list(bpy.context.selected_objects):s.select_set(False)
 o.select_set(True);bpy.context.view_layer.objects.active=o;bpy.ops.object.convert(target='MESH');parts.append(o)
models=[];reports=[]
for kind in ['cafe','lobby']:
 I=json.loads((ROOT/f'assets/blender/{kind}-pilot.json').read_text())['interior'];W,D=I['frontage'],I['depth']
 b=MeshBuilder(scene,kind+'_room_props',mats);parts=[]
 for side in [-1,1]:plant(b,side*(W/2-1.4),.60,.60)
 if kind=='cafe':
  z=-D/2+1.25;x=-4.0
  b.box(x,1.17,z,1.4,.14,.74,dark);b.box(x,1.53,z-.10,1.28,.60,.54,metal)
  b.box(x,1.62,z+.185,1.12,.24,.035,dark);b.box(x,1.20,z+.31,1.22,.035,.20,metal)
  for dx in [-.33,.33]:
   pipe(b,(x+dx,1.52,z+.22),(x+dx,1.39,z+.22),.045,metal)
   pipe(b,(x+dx,1.44,z+.22),(x+dx,1.44,z+.42),.025,dark)
   b.box(x+dx,1.18,z+.33,.28,.025,.16,dark)
  for dx in [-.44,-.22,0,.22,.44]:pipe(b,(x+dx,1.69,z+.20),(x+dx,1.69,z+.235),.029,ivory)
  pipe(b,(x+.61,1.52,z),(x+.72,1.27,z+.30),.02,metal)
  text(parts,'ORBIT',x,1.78,z+.19,.075,dark)
  # Grinder and stacked saucers share the existing counter, away from its cups.
  b.box(-5.2,1.20,z,.35,.2,.4,dark);lathe(b,-5.2,1.30,z,[(.14,0),(.14,.35),(.19,.40),(.19,.62),(0,.65)],metal)
  for i in range(4):lathe(b,-2.75,1.10+i*.03,z,[(0,0),(.22,0),(.24,.025),(0,.03)],ivory)
  for dx in [-.55,0,.55]:cup(b,dx,1.10,z,.14)
  for side in [-1,1]:cup(b,side*min(3.2,W/2-2.4),1.01,1.8)
  bx=3.3;b.box(bx,2.46,-D/2+.34,2.55,1.95,.065,dark)
  for line,(body,y,size) in enumerate([('ORBIT COFFEE',3.13,.25),('ESPRESSO',2.69,.23),('LATTE',2.34,.23),('FILTER COFFEE',1.99,.20)]):text(parts,body,bx,y,-D/2+.38,size)
  b.box(3.56,1.038,1.55,.40,.05,.33,terra);b.box(3.56,1.071,1.55,.37,.02,.30,paper)
 else:
  bx=-3.85;b.box(bx,2.30,-D/2+.34,2.12,1.55,.065,dark)
  for body,y,size in [('MERIDIAN',2.82,.23),('PUBLIC LOBBY',2.46,.17),('01   STUDIOS',2.16,.15),('02   OFFICES',1.88,.15)]:text(parts,body,bx,y,-D/2+.38,size)
  for j in range(3):b.box(-W/2+1.4,.6225+j*.045,-.30,.52,.045,.36,[terra,paper,dark][j])
 parts.insert(0,b.finish());model=join(scene,kind+'_room_dressing',parts)
 model['units']='metres';model['non_solid']=True
 models.append(model);reports.append({'name':model.name,'triangles':len(model.data.loop_triangles),'materials':len(set(p.material_index for p in model.data.polygons))})
path=ROOT/'public/assets/buildings/room-dressing.glb';export(scene,models,path)
bpy.data.libraries.write(str(ROOT/'assets/blender/room-dressing.blend'),{scene},fake_user=True,compress=True)
report={'bytes':path.stat().st_size,'rooms':reports,'visibility':'Full within 12m of room envelope; fades out by 22m and above room ceiling','collision':'Non-solid detail on existing counter, tables, benches or walls; original colliders unchanged'}
(ROOT/'assets/blender/room-dressing-audit.json').write_text(json.dumps(report,indent=2)+'\n');print(json.dumps(report))
