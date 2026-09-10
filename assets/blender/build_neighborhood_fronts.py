"""Three closed shops on a real cafe-neighbourhood lot; metres, front-local axes."""
import bpy,math,json,sys,importlib
from pathlib import Path
sys.dont_write_bytecode=True
ROOT=Path(__file__).resolve().parents[2];sys.path.insert(0,str(ROOT/'assets/blender'))
import building_mesh_kit;importlib.reload(building_mesh_kit)
from building_mesh_kit import MeshBuilder,local,join,export
contract=json.loads((ROOT/'assets/blender/neighborhood-fronts.json').read_text())
scene=bpy.data.scenes.get('Spinward Neighbourhood Shops') or bpy.data.scenes.new('Spinward Neighbourhood Shops');bpy.context.window.scene=scene
scene.unit_settings.system='METRIC'
for o in list(scene.objects):bpy.data.objects.remove(o,do_unlink=True)
def rgba(h):
 v=[int(h[i:i+2],16)/255 for i in (0,2,4)];return tuple(x/12.92 if x<=.04045 else ((x+.055)/1.055)**2.4 for x in v)+(1,)
def mat(name,color,emit=.035,metal=0):
 m=bpy.data.materials.get('SWNF_'+name) or bpy.data.materials.new('SWNF_'+name);m.use_nodes=True
 p=m.node_tree.nodes.get('Principled BSDF');p.inputs['Base Color'].default_value=rgba(color);p.inputs['Roughness'].default_value=.72;p.inputs['Metallic'].default_value=metal
 p.inputs['Emission Color'].default_value=rgba(color);p.inputs['Emission Strength'].default_value=emit;return m
stone=mat('stone','b5a993');dark=mat('dark','273b3b');wood=mat('wood','987859');ivory=mat('ivory','ded7bf',.12);glass=mat('window','34494d',.15);green=mat('leaf','78935c');orange=mat('fruit','c28b51');metal=mat('metal','9da6a0',.04,.25)
def text(parts,body,x,y,z,size,material):
 c=bpy.data.curves.new('SWNF_text','FONT');c.body=body;c.align_x='CENTER';c.align_y='CENTER';c.size=size;c.resolution_u=2
 o=bpy.data.objects.new('SWNF_text',c);scene.collection.objects.link(o);o.location=local(x,y,z);o.rotation_euler=(math.pi/2,0,0);c.materials.append(material)
 for s in list(bpy.context.selected_objects):s.select_set(False)
 o.select_set(True);bpy.context.view_layer.objects.active=o;bpy.ops.object.convert(target='MESH');parts.append(o)
def disk(b,x,y,z,r,material,n=16):
 for j in range(n):
  a=2*math.pi*j/n;c=2*math.pi*(j+1)/n
  b.face([local(x,y,z),local(x+r*math.cos(a),y+r*math.sin(a),z),local(x+r*math.cos(c),y+r*math.sin(c),z)],material)
models=[];audit=[]
for shop in contract['shops']:
 brand=mat(shop['id'],shop['color']);mats=[stone,dark,wood,ivory,glass,green,orange,metal,brand]
 for lod in [0,1]:
  b=MeshBuilder(scene,shop['id'],mats);parts=[];x=shop['x'];n=contract['building']['width']/2+.16
  b.box(x,2.2,n,10.4,4,.025,stone)
  b.box(x,.48,n+.035,10.25,.45,.06,brand)
  # Two glazed displays and one closed, clearly identified door.
  for u in [-1.25,2.65]:
   b.box(x+u,1.78,n+.03,3.45,2.12,.025,dark)
   b.box(x+u,1.78,n+.05,3.25,1.93,.02,glass)
   b.box(x+u,.78,n+.10,3.52,.13,.12,wood)
  b.box(x-4.2,1.62,n+.04,1.5,2.7,.04,brand)
  b.box(x-4.2,2.12,n+.067,1.27,1.42,.018,glass)
  b.box(x-3.69,1.34,n+.085,.045,.28,.04,ivory)
  for u in [-5.12,-3.32,.68,4.60]:b.box(x+u,1.84,n+.065,.12,3.07,.09,brand)
  b.box(x,3.69,n+.055,10.25,.81,.08,brand)
  text(parts,shop['label'],x,3.90,n+.10,.35,ivory)
  if lod==0:
   text(parts,shop['subtitle'],x,3.59,n+.10,.13,ivory)
   text(parts,'CLOSED',x-4.2,2.19,n+.081,.16,ivory)
   text(parts,'BACK AT 08:00',x-4.2,1.94,n+.081,.075,ivory)
  # A pitched fabric canopy, closed at both ends; broad planes survive LOD.
  left=x-5.175;right=x+5.175
  for points in [
   [(left,3.48,n-.03),(right,3.48,n-.03),(right,3.20,n+.77),(left,3.20,n+.77)],
   [(left,3.16,n+.77),(right,3.16,n+.77),(right,3.44,n-.03),(left,3.44,n-.03)],
   [(left,3.48,n-.03),(left,3.20,n+.77),(left,3.16,n+.77),(left,3.44,n-.03)],
   [(right,3.44,n-.03),(right,3.16,n+.77),(right,3.20,n+.77),(right,3.48,n-.03)]]:
   b.face([local(*p) for p in points],brand)
  b.box(x,3.095,n+.75,10.35,.21,.045,brand)
  if lod==0:
   for j in range(15):
    if j%2==0:
     u=x-4.83+j*.69
     b.face([local(u-.17,3.485,n-.03),local(u+.17,3.485,n-.03),local(u+.17,3.205,n+.77),local(u-.17,3.205,n+.77)],stone)
     b.box(u,3.095,n+.779,.34,.21,.008,stone)
   if shop['id']=='folio':
    for u in [-1.25,2.65]:
     for row in range(3):
      y=1.0+row*.52;b.box(x+u,y,n+.087,3.05,.07,.085,wood)
      for j in range(13):
       h=.25+.09*((j+row)%3);b.box(x+u-1.35+j*.225,y+.04+h/2,n+.096,.145,h,.065,[brand,ivory,green,orange][(j+row)%4])
   elif shop['id']=='spin-cycle':
    for u in [-2.3,-1.25,-.2,1.6,2.65,3.7]:
     b.box(x+u,1.30,n+.095,.92,1.03,.08,ivory)
     disk(b,x+u,1.26,n+.14,.35,metal);disk(b,x+u,1.26,n+.143,.27,dark);disk(b,x+u+.035,1.29,n+.146,.18,glass)
     b.box(x+u,1.69,n+.14,.7,.085,.012,dark)
     disk(b,x+u+.26,1.70,n+.15,.025,orange,8)
   else:
    # Continuous shelves and uprights visibly support both tiers of crates.
    for u in [-1.25,2.65]:
     for y in [.78,1.42]:b.box(x+u,y,n+.08,3.20,.06,.13,metal)
     for edge in [-1.56,1.56]:b.box(x+u+edge,1.12,n+.035,.06,.68,.04,metal)
    for u in [-2.35,-1.25,-.15,1.55,2.65,3.75]:
     for row in range(2):
      y=.95+row*.64;b.box(x+u,y,n+.08,.96,.28,.12,wood)
      for j in range(4):
       for k in range(2):disk(b,x+u-.31+j*.20,y+.12+k*.14,n+.15,.10,green if row else orange,7)
      b.box(x+u,y-.03,n+.145,.82,.025,.018,dark)
  model=join(scene,f"{shop['id']}_lod{lod}",[b.finish(),*parts]);models.append(model)
  audit.append({'name':model.name,'triangles':len(model.data.loop_triangles),'materials':len(set(p.material_index for p in model.data.polygons))})
path=ROOT/'public/assets/buildings/neighborhood-fronts.glb';export(scene,models,path)
bpy.data.libraries.write(str(ROOT/'assets/blender/neighborhood-fronts.blend'),{scene},fake_user=True,compress=True)
report={'bytes':path.stat().st_size,'models':audit,'projection':'display relief <= 0.32m; awning <= 0.95m above 2.9m; road setback 2m','collision':'Original closed-building envelope and central access unchanged'}
(ROOT/'assets/blender/neighborhood-fronts-audit.json').write_text(json.dumps(report,indent=2)+'\n');print(json.dumps(report))
