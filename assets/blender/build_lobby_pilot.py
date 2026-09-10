"""Author Meridian lobby on an existing tangent-fronted through-passage lot.
Uses the cafe's native-metre facade kit and PBR facade baking convention.
"""
import bpy,json,math,sys
from pathlib import Path
sys.dont_write_bytecode=True
ROOT=Path(__file__).resolve().parents[2];sys.path.insert(0,str(ROOT/'assets/blender'))
import importlib, building_mesh_kit
importlib.reload(building_mesh_kit)
from building_mesh_kit import MeshBuilder,detailed_facade,facade,atlas_uv,local,join,export
import bake_building_maps
importlib.reload(bake_building_maps)
from bake_building_maps import contact_ao,facade_maps
I=json.loads((ROOT/'assets/blender/lobby-pilot.json').read_text())['interior'];W,D,H=I['frontage'],I['depth'],I['building']['height']
scene=bpy.data.scenes.get('Spinward Meridian Lobby') or bpy.data.scenes.new('Spinward Meridian Lobby');bpy.context.window.scene=scene
scene.unit_settings.system='METRIC';scene.unit_settings.scale_length=1
for o in list(scene.objects):bpy.data.objects.remove(o,do_unlink=True)
def rgb(h):
 v=[int(h[i:i+2],16)/255 for i in (0,2,4)]
 return tuple(x/12.92 if x<=.04045 else ((x+.055)/1.055)**2.4 for x in v)+(1,)
def mat(name,color,rough=.8,metal=0,emission=None):
 m=bpy.data.materials.get('SWLO_'+name) or bpy.data.materials.new('SWLO_'+name);m.use_nodes=True;m.node_tree.nodes.clear()
 p=m.node_tree.nodes.new('ShaderNodeBsdfPrincipled');out=m.node_tree.nodes.new('ShaderNodeOutputMaterial');m.node_tree.links.new(p.outputs['BSDF'],out.inputs['Surface'])
 p.inputs['Base Color'].default_value=rgb(color);p.inputs['Roughness'].default_value=rough;p.inputs['Metallic'].default_value=metal
 p.inputs['Emission Color'].default_value=rgb(emission or '000000');p.inputs['Emission Strength'].default_value=.22 if emission else 0
 return m
stone=mat('STONE','b3b7b5');reveal=mat('REVEAL','5f7070');metal=mat('METAL','284a52',.4,.4)
wood=mat('WOOD','997150');glass=mat('GLASS','4e6973',.2,.25);lit=mat('WINDOW_LIGHT','728d91',.26,.15,'ffe0a7');light=mat('LIGHT','eadab8',.6,0,'ffe2a6')
materials=[stone,reveal,metal,wood,glass,lit,light]
b=MeshBuilder(scene,'SWLO_Structure',materials)
# Side walls and native solid furniture. Front/back wings are articulated below.
for p in I['parts']:
 if p['material']=='upper' or p['detail']==2:continue
 if p['detail']==3 and abs(p['z'])>D/2-.5:continue
 m=stone if p['material']=='wall' else wood if p['material']=='wood' else light
 b.box(p['x'],p['y'],p['z'],p['width'],p['height'],p['depth'],m)
for end in [-1,1]:
 for side in [-1,1]:
  wing=(W-3.2)/2;cx=side*(W+3.2)/4
  b.box(cx,.25,end*(D/2-.15),wing,.5,.3,reveal)
  b.box(cx,3.68,end*(D/2-.15),wing,1.04,.3,stone)
  bays=max(2,round(wing/1.8));pitch=wing/bays
  for j in range(bays):
   x=cx-wing/2+(j+.5)*pitch
   b.box(x,1.82,end*(D/2-.07),pitch-.10,2.64,.04,glass)
   b.box(x-pitch/2+.045,1.82,end*(D/2-.10),.09,2.64,.20,metal)
  b.box(cx,2.63,end*(D/2-.08),wing,.065,.14,metal)
 b.box(0,3.65,end*(D/2-.15),3.2,1.1,.3,stone)
 for side in [-1,1]:
  b.box(side*1.68,1.55,end*(D/2-.13),.16,3.1,.26,metal)
  b.box(side*1.72,1.55,end*(D/2-.005),.045,3.1,.008,light)
 # The access gap is zero on this lot. Canopies therefore stay INSIDE the
 # existing footprint; a copied cafe overhang would project into its road.
 b.box(0,3.28,end*(D/2-.6),4.3,.16,1.1,metal)
 b.box(0,3.185,end*(D/2-.6),3.8,.025,.9,wood)
 b.box(0,3.17,end*(D/2-.6),3.5,.02,.06,light)
 b.box(0,3.82,end*(D/2-.016),5.1,.44,.04,metal)
# Upper office bays above a double-ended public lobby.
detailed_facade(b,W,D,H,stone,reveal,glass,lit,metal,office=True)
b.box(0,4.24,0,W-.6,.08,D-.6,stone);b.box(0,H-.16,0,W,.12,D,reveal)
for side in [-1,1]:
 b.box(side*(W/2-.12),H-.10,0,.24,.2,D,stone)
 b.box(0,H-.10,side*(D/2-.12),W-.48,.2,.24,stone)
for x in [-W*.28,W*.28]:b.box(x,4.07,0,.18,.035,D*.8,light)
structure=b.finish();parts=[structure]
for end,text in [(1,'MERIDIAN'),(-1,'PUBLIC PASSAGE')]:
 curve=bpy.data.curves.new('SWLO_Sign','FONT');curve.body=text;curve.align_x='CENTER';curve.align_y='CENTER';curve.size=.32 if end==1 else .23;curve.extrude=0;curve.resolution_u=4
 o=bpy.data.objects.new('SWLO_Sign',curve);scene.collection.objects.link(o);o.location=local(0,3.82,end*(D/2+.009));o.rotation_euler=(math.pi/2,0,0 if end==1 else math.pi);curve.materials.append(light)
 for selected in list(bpy.context.selected_objects):selected.select_set(False)
 o.select_set(True);bpy.context.view_layer.objects.active=o;bpy.ops.object.convert(target='MESH');parts.append(o)
master=join(scene,'lobby_runtime_lod0',parts)
bpy.ops.object.mode_set(mode='EDIT');bpy.ops.mesh.select_all(action='SELECT');bpy.ops.mesh.normals_make_consistent(inside=False);bpy.ops.uv.smart_project(angle_limit=math.radians(66),island_margin=.002,margin_method='FRACTION');bpy.ops.object.mode_set(mode='OBJECT')
contact_ao(scene,master,ROOT/'assets/blender/lobby-ao.png','SWLO')
baked=facade_maps(scene,master,W,D,H,ROOT/'assets/blender','lobby')
def extract(name,predicate):
 master.data.calc_loop_triangles();builder=MeshBuilder(scene,name,list(master.data.materials))
 for t in master.data.loop_triangles:
  ps=[master.data.vertices[i].co.copy() for i in t.vertices]
  if predicate(ps):builder.face(ps,master.data.materials[t.material_index],[master.data.uv_layers.active.data[i].uv.copy() for i in t.loops])
 return builder.finish()
def exterior_low(name,level):
 builder=MeshBuilder(scene,name,[baked])
 for side in range(4):
  span=W if side<2 else D;depth=D/2 if side<2 else W/2
  y0=4.2 if level==1 else 0
  regions=[(-span/2,span/2,y0,H-.22)]
  if level==2 and side<2:regions=[(-span/2,-1.6,0,H-.22),(1.6,span/2,0,H-.22),(-1.6,1.6,3.1,H-.22)]
  for x0,x1,lo,hi in regions:
   ps=[(x0,lo),(x1,lo),(x1,hi),(x0,hi)]
   builder.face([facade(u,y,depth,side) for u,y in ps],baked,[atlas_uv(u,y,side,W,D,H) for u,y in ps])
 roof=extract(name+'_Roof',lambda ps:min(p.z for p in ps)>=H-.4)
 ceiling=extract(name+'_Ceiling',lambda ps:min(p.z for p in ps)>=4.2 and max(p.z for p in ps)<=4.28)
 objects=[builder.finish(),roof,ceiling]
 if level==1:
  objects.append(extract(name+'_Entry',lambda ps:max(p.z for p in ps)<4.2 and (max(abs(p.x) for p in ps)>W/2-.31 or max(abs(p.y) for p in ps)>D/2-1.2)))
 else:
  objects.append(extract(name+'_Canopy',lambda ps:min(p.z for p in ps)>3.15 and max(p.z for p in ps)<3.5 and min(abs(p.y) for p in ps)>D/2-1.2))
 return join(scene,name,objects)
lods=[master,exterior_low('lobby_runtime_lod1',1),exterior_low('lobby_runtime_lod2',2)]
for level,o in enumerate(lods):o['lod']=level;o['units']='metres'
path=ROOT/'public/assets/buildings/lobby-pilot-runtime.glb';export(scene,lods,path)
for o in lods[1:]:o.hide_set(True);o.hide_render=True;o.select_set(False)
bpy.context.view_layer.objects.active=master
bpy.data.libraries.write(str(ROOT/'assets/blender/lobby-pilot.blend'),{scene},fake_user=True,compress=True)
report={'bytes':path.stat().st_size,'levels':[],'front':I['building']['front'],'structural_dimensions':[W,D,H],'portal_width':3.2,'portal_height':3.1,'canopy':'Inside lot on both ends; 0m existing street approach'}
for o in lods:
 o.data.calc_loop_triangles();report['levels'].append({'name':o.name,'triangles':len(o.data.loop_triangles),'materials':len(set(p.material_index for p in o.data.polygons))})
(ROOT/'assets/blender/lobby-audit.json').write_text(json.dumps(report,indent=2)+'\n');print(json.dumps(report))
