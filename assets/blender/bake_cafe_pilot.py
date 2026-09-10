"""Bake one shared AO atlas and export the selected cafe, using Blender Cycles."""
import bpy
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2]
scene=bpy.data.scenes['Spinward Cafe Pilot'];bpy.context.window.scene=scene
model=scene.objects['cafe_pilot_lod0']
for o in list(bpy.context.selected_objects):o.select_set(False)
model.select_set(True);bpy.context.view_layer.objects.active=model
# A fresh image prevents export from reusing a previously packed byte stream.
image=bpy.data.images.new('SWCP_AO',width=2048,height=2048,alpha=False)
image.colorspace_settings.name='Non-Color'
for m in model.data.materials:
 nodes=m.node_tree.nodes
 tex=nodes.get('SWCP_AO') or nodes.new('ShaderNodeTexImage');tex.name='SWCP_AO';tex.image=image;nodes.active=tex
scene.render.engine='CYCLES';scene.cycles.samples=32
scene.render.threads_mode='FIXED';scene.render.threads=4
scene.render.bake.margin=2;scene.render.bake.use_clear=True
# Bake local contact occlusion, not room-wide sky visibility. The 0.7 m
# radius keeps broad facade fields clean and shades recesses and connections.
restore=[]
for m in model.data.materials:
 nodes=m.node_tree.nodes;links=m.node_tree.links
 output=next(n for n in nodes if n.type=='OUTPUT_MATERIAL')
 previous=output.inputs['Surface'].links[0].from_socket
 ao=nodes.new('ShaderNodeAmbientOcclusion');ao.inputs['Distance'].default_value=.7;ao.samples=32;ao.only_local=True
 emission=nodes.new('ShaderNodeEmission');links.new(ao.outputs['Color'],emission.inputs['Color']);links.new(emission.outputs[0],output.inputs['Surface'])
 restore.append((m,output,previous,ao,emission))
try:
 bpy.ops.object.bake(type='EMIT')
finally:
 for m,output,previous,ao,emission in restore:
  m.node_tree.links.new(previous,output.inputs['Surface']);m.node_tree.nodes.remove(ao);m.node_tree.nodes.remove(emission)
image.filepath_raw=str(ROOT/'assets/blender/cafe-pilot-ao.png');image.file_format='PNG';image.save();image.pack()
group=bpy.data.node_groups.get('glTF Material Output') or bpy.data.node_groups.new('glTF Material Output','ShaderNodeTree')
if not group.interface.items_tree:group.interface.new_socket(name='Occlusion',in_out='INPUT',socket_type='NodeSocketFloat')
for m in model.data.materials:
 nodes=m.node_tree.nodes;node=nodes.get('SWCP_GltfOutput') or nodes.new('ShaderNodeGroup');node.name='SWCP_GltfOutput';node.node_tree=group
 m.node_tree.links.new(nodes['SWCP_AO'].outputs['Color'],node.inputs['Occlusion'])
root=ROOT
bpy.ops.export_scene.gltf(filepath=str(root/'public/assets/buildings/cafe-pilot.glb'),export_format='GLB',use_selection=True,use_active_scene=True,export_yup=True,export_materials='EXPORT',export_cameras=False,export_lights=False)
bpy.data.libraries.write(str(root/'assets/blender/cafe-pilot.blend'),{scene},fake_user=True,compress=True)
print('AO baked and exported')
