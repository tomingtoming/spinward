"""Derive a lighter contact LOD, preserving the approved master for comparison.
Requires build_cafe_pilot.py and build_cafe_lods.py scenes, or append their blends.
"""
import bpy,json,sys
sys.dont_write_bytecode=True
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2];sys.path.insert(0,str(ROOT/'assets/blender'))
import importlib, building_mesh_kit
importlib.reload(building_mesh_kit)
from building_mesh_kit import MeshBuilder,detailed_facade,join,export
I=json.loads((ROOT/'assets/blender/cafe-pilot.json').read_text())['interior'];W,D,H=I['frontage'],I['depth'],I['building']['height']
source=bpy.data.scenes['Spinward Cafe Pilot'].objects['cafe_pilot_lod0'];source.data.calc_loop_triangles()
scene=bpy.data.scenes.get('Spinward Cafe Close') or bpy.data.scenes.new('Spinward Cafe Close');bpy.context.window.scene=scene
scene.unit_settings.system='METRIC';scene.unit_settings.scale_length=1
for o in list(scene.objects):bpy.data.objects.remove(o,do_unlink=True)
materials=list(source.data.materials);baked=bpy.data.materials['SWCP_BAKED_LIGHT']
builder=MeshBuilder(scene,'SWCC_Contact',materials)
for t in source.data.loop_triangles:
 ps=[source.data.vertices[i].co.copy() for i in t.vertices]
 m=materials[t.material_index]
 if max(p.z for p in ps)>4.41 and min(p.z for p in ps)<H-.4 and not m.name.endswith('PLINTH'):continue
 # Preserve front letter contours; 2mm extruded edges and the back face are
 # below useful contact resolution and lie against the existing backing.
 if 'LIGHT' in m.name and min(p.z for p in ps)>3.5 and min(-p.y for p in ps)>D/2+.025:
  if (ps[1]-ps[0]).cross(ps[2]-ps[0]).normalized().y>-.9:continue
 builder.face(ps,m,[source.data.uv_layers.active.data[i].uv.copy() for i in t.loops])
contact=builder.finish()
trim=bpy.data.materials.get('SWCC_METAL') or bpy.data.materials['SWCP_METAL'].copy();trim.name='SWCC_METAL'
for node in list(trim.node_tree.nodes):
 if node.type in ['GROUP','TEX_IMAGE']:trim.node_tree.nodes.remove(node)
builder=MeshBuilder(scene,'SWCC_Upper',[baked,trim])
detailed_facade(builder,W,D,H,baked,None,baked,baked,trim,baked=True,mullions=True)
model=join(scene,'cafe_runtime_lod0',[contact,builder.finish()]);model['lod']=0;model['units']='metres'
levels=[model]
for level in [1,2]:
 source_lod=bpy.data.scenes['Spinward Cafe LODs'].objects[f'cafe_pilot_lod{level}']
 copy=source_lod.copy();copy.name=f'cafe_runtime_lod{level}';scene.collection.objects.link(copy);levels.append(copy)
path=ROOT/'public/assets/buildings/cafe-pilot-runtime.glb';export(scene,levels,path)
for o in levels[1:]:o.hide_set(True);o.hide_render=True;o.select_set(False)

bpy.data.libraries.write(str(ROOT/'assets/blender/cafe-pilot-close.blend'),{scene},fake_user=True,compress=True)
report={'master_triangles':len(source.data.loop_triangles),'triangles':len(model.data.loop_triangles),'materials':len(set(p.material_index for p in model.data.polygons)),'bytes':path.stat().st_size,'retained':'3.2m portal, ground floor, furnishings, roof, 19cm window recesses, projected sill silhouette','changed':'Narrow vertical piers and spandrels for cylinder curvature; retained front mullion planes and original reveal AO; triangular sill profiles; sign front caps'}
(ROOT/'assets/blender/cafe-close-audit.json').write_text(json.dumps(report,indent=2)+'\n');print(json.dumps(report))
