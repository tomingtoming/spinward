"""Reusable metre-scale mug, liquid and counter sign for the cafe action."""
import bpy,math,json,sys,importlib
from pathlib import Path
sys.dont_write_bytecode=True
ROOT=Path(__file__).resolve().parents[2];sys.path.insert(0,str(ROOT/'assets/blender'))
import building_mesh_kit;importlib.reload(building_mesh_kit)
from building_mesh_kit import MeshBuilder,local,join,export
spec=json.loads((ROOT/'assets/blender/coffee-service.json').read_text())
scene=bpy.data.scenes.get('Spinward Coffee Service') or bpy.data.scenes.new('Spinward Coffee Service');bpy.context.window.scene=scene
scene.unit_settings.system='METRIC';scene.unit_settings.scale_length=1
for o in list(scene.objects):bpy.data.objects.remove(o,do_unlink=True)
def mat(name,h,rough):
 m=bpy.data.materials.get('SWCO_'+name) or bpy.data.materials.new('SWCO_'+name);m.use_nodes=True
 rgb=[int(h[i:i+2],16)/255 for i in (0,2,4)];color=tuple(v/12.92 if v<=.04045 else ((v+.055)/1.055)**2.4 for v in rgb)+(1,)
 p=m.node_tree.nodes.get('Principled BSDF');p.inputs['Base Color'].default_value=color;p.inputs['Roughness'].default_value=rough;p.inputs['Emission Color'].default_value=color;p.inputs['Emission Strength'].default_value=.035;return m
ivory=mat('ivory','e3d9c3',.32);coffee=mat('coffee','563421',.26);dark=mat('dark','253c3a',.72);gold=mat('gold','c29b65',.6)
mats=[ivory,coffee,dark,gold]
def lathe(b,profile,material,n=32):
 for (r0,y0),(r1,y1) in zip(profile,profile[1:]):
  for j in range(n):
   a=2*math.pi*j/n;c=2*math.pi*(j+1)/n
   b.face([local(r0*math.cos(a),y0,r0*math.sin(a)),local(r0*math.cos(c),y0,r0*math.sin(c)),local(r1*math.cos(c),y1,r1*math.sin(c)),local(r1*math.cos(a),y1,r1*math.sin(a))],material)
b=MeshBuilder(scene,'coffee_mug',mats)
lathe(b,[(0,0),(.036,0),(.039,.008),(.047,.105),(.047,.11),(.042,.11),(.041,.103),(.033,.013),(0,.013)],ivory)
# A closed elliptical ceramic handle, with enough segments to read at arm's length.
for j in range(24):
 def p(a,t):return local(.070+(.025+.005*math.cos(t))*math.cos(a),.061+(.034+.005*math.cos(t))*math.sin(a),.005*math.sin(t))
 for k in range(8):
  a=2*math.pi*j/24;c=2*math.pi*(j+1)/24;t=2*math.pi*k/8;u=2*math.pi*(k+1)/8;b.face([p(a,t),p(c,t),p(c,u),p(a,u)],ivory)
mug=b.finish();mug.name='coffee_mug'
b=MeshBuilder(scene,'coffee_liquid',mats);lathe(b,[(0,.093),(.039,.093)],coffee);liquid=b.finish();liquid.name='coffee_liquid'
b=MeshBuilder(scene,'coffee_station_sign',mats);parts=[]
z=spec['signFromBack']-spec['cupFromBack']
b.box(0,.025,z,1.24,.05,.20,dark);b.box(0,.26,z,1.22,.45,.045,dark)
lathe(b,[(0,-.008),(.10,-.008),(.10,0),(0,0)],gold)
for body,y,size in [('SELF SERVICE',.36,.115),('COFFEE',.235,.11),('CUP RETURN',.12,.085)]:
 c=bpy.data.curves.new('SWCO_text','FONT');c.body=body;c.align_x='CENTER';c.align_y='CENTER';c.size=size;c.resolution_u=2
 o=bpy.data.objects.new('SWCO_text',c);scene.collection.objects.link(o);o.location=local(0,y,z+.025);o.rotation_euler=(math.pi/2,0,0);c.materials.append(ivory)
 for s in list(bpy.context.selected_objects):s.select_set(False)
 o.select_set(True);bpy.context.view_layer.objects.active=o;bpy.ops.object.convert(target='MESH');parts.append(o)
board=join(scene,'coffee_station_sign',[b.finish(),*parts]);models=[mug,liquid,board]
report=[]
for o in models:o.data.calc_loop_triangles();report.append({'name':o.name,'triangles':len(o.data.loop_triangles)})
path=ROOT/'public/assets/buildings/coffee-service.glb';export(scene,models,path)
bpy.data.libraries.write(str(ROOT/'assets/blender/coffee-service.blend'),{scene},fake_user=True,compress=True)
audit={'bytes':path.stat().st_size,'models':report};(ROOT/'assets/blender/coffee-service-audit.json').write_text(json.dumps(audit,indent=2)+'\n');print(json.dumps(audit))
