"""Blender contact AO and reusable four-facade PBR atlas baking."""
import bpy
from building_mesh_kit import MeshBuilder,facade,atlas_uv

def select(source,target=None):
 for o in list(bpy.context.selected_objects):o.select_set(False)
 source.select_set(True)
 if target:target.select_set(True)
 bpy.context.view_layer.objects.active=target or source

def output_group():
 group=bpy.data.node_groups.get('glTF Material Output') or bpy.data.node_groups.new('glTF Material Output','ShaderNodeTree')
 if not group.interface.items_tree:group.interface.new_socket(name='Occlusion',in_out='INPUT',socket_type='NodeSocketFloat')
 return group

def contact_ao(scene,model,path,prefix):
 select(model);scene.render.engine='CYCLES';scene.cycles.samples=16
 scene.render.threads_mode='FIXED';scene.render.threads=4;scene.render.bake.use_selected_to_active=False
 scene.render.bake.margin=2;scene.render.bake.use_clear=True
 image=bpy.data.images.new(prefix+'_AO',width=1024,height=1024,alpha=False);image.colorspace_settings.name='Non-Color'
 restore=[]
 for m in model.data.materials:
  nodes=m.node_tree.nodes;links=m.node_tree.links;output=next(n for n in nodes if n.type=='OUTPUT_MATERIAL');previous=output.inputs['Surface'].links[0].from_socket
  tex=nodes.new('ShaderNodeTexImage');tex.name='ContactAO';tex.image=image;nodes.active=tex
  ao=nodes.new('ShaderNodeAmbientOcclusion');ao.inputs['Distance'].default_value=.7;ao.samples=16;ao.only_local=True
  emission=nodes.new('ShaderNodeEmission');links.new(ao.outputs['Color'],emission.inputs['Color']);links.new(emission.outputs[0],output.inputs['Surface']);restore.append((m,output,previous,ao,emission))
 try:bpy.ops.object.bake(type='EMIT')
 finally:
  for m,output,previous,ao,emission in restore:m.node_tree.links.new(previous,output.inputs['Surface']);m.node_tree.nodes.remove(ao);m.node_tree.nodes.remove(emission)
 image.filepath_raw=str(path);image.file_format='PNG';image.save();image.pack()
 for m in model.data.materials:
  node=m.node_tree.nodes.new('ShaderNodeGroup');node.node_tree=output_group();m.node_tree.links.new(m.node_tree.nodes['ContactAO'].outputs['Color'],node.inputs['Occlusion'])
 return image

def facade_maps(scene,model,w,d,h,folder,prefix):
 material=bpy.data.materials.new(prefix+'_Receiver');material.use_nodes=True
 builder=MeshBuilder(scene,prefix+'_Receiver',[material])
 for side in range(4):
  span=w if side<2 else d;depth=d/2 if side<2 else w/2
  points=[(-span/2,0),(span/2,0),(span/2,h),(-span/2,h)]
  builder.face([facade(u,y,depth,side) for u,y in points],material,[atlas_uv(u,y,side,w,d,h) for u,y in points])
 receiver=builder.finish();images={}
 scene.render.engine='CYCLES';scene.cycles.samples=1
 scene.render.bake.use_selected_to_active=True;scene.render.bake.cage_extrusion=.8;scene.render.bake.max_ray_distance=1.2;scene.render.bake.margin=2
 try:
  for channel in ['albedo','orm','emission']:
   image=bpy.data.images.new(prefix+'_'+channel,width=1024,height=1024,alpha=False);image.colorspace_settings.name='Non-Color' if channel=='orm' else 'sRGB'
   tex=material.node_tree.nodes.get('Image Texture') or material.node_tree.nodes.new('ShaderNodeTexImage');tex.image=image;material.node_tree.nodes.active=tex
   restore=[]
   for m in model.data.materials:
    nodes=m.node_tree.nodes;links=m.node_tree.links;p=nodes.get('Principled BSDF');out=next(n for n in nodes if n.type=='OUTPUT_MATERIAL');previous=out.inputs['Surface'].links[0].from_socket
    emission=nodes.new('ShaderNodeEmission');extras=[]
    if channel=='albedo':emission.inputs['Color'].default_value=p.inputs['Base Color'].default_value
    elif channel=='orm':
     pack=nodes.new('ShaderNodeCombineColor');pack.mode='RGB';extras.append(pack)
     pack.inputs['Green'].default_value=p.inputs['Roughness'].default_value;pack.inputs['Blue'].default_value=p.inputs['Metallic'].default_value
     links.new(nodes['ContactAO'].outputs['Color'],pack.inputs['Red']);links.new(pack.outputs['Color'],emission.inputs['Color'])
    else:
     color=p.inputs['Emission Color'].default_value;strength=p.inputs['Emission Strength'].default_value
     emission.inputs['Color'].default_value=tuple(color[i]*strength for i in range(3))+(1,)
    links.new(emission.outputs[0],out.inputs['Surface']);restore.append((m,out,previous,[emission]+extras))
   select(model,receiver)
   try:bpy.ops.object.bake(type='EMIT')
   finally:
    for m,out,previous,nodes in restore:
     m.node_tree.links.new(previous,out.inputs['Surface'])
     for n in nodes:m.node_tree.nodes.remove(n)
   image.filepath_raw=str(folder/f'{prefix}-{channel}.png');image.file_format='PNG';image.save();image.pack();images[channel]=image
 finally:
  scene.render.bake.use_selected_to_active=False;bpy.data.objects.remove(receiver,do_unlink=True)
 baked=bpy.data.materials.get(prefix+'_BAKED_LIGHT') or bpy.data.materials.new(prefix+'_BAKED_LIGHT');baked.use_nodes=True;baked.node_tree.nodes.clear()
 nodes=baked.node_tree.nodes;links=baked.node_tree.links;p=nodes.new('ShaderNodeBsdfPrincipled');out=nodes.new('ShaderNodeOutputMaterial');links.new(p.outputs['BSDF'],out.inputs['Surface']);p.inputs['Emission Strength'].default_value=1
 for channel,socket in [('albedo','Base Color'),('emission','Emission Color')]:
  tex=nodes.new('ShaderNodeTexImage');tex.image=images[channel];links.new(tex.outputs['Color'],p.inputs[socket])
 tex=nodes.new('ShaderNodeTexImage');tex.image=images['orm'];sep=nodes.new('ShaderNodeSeparateColor');sep.mode='RGB';links.new(tex.outputs['Color'],sep.inputs['Color'])
 group=nodes.new('ShaderNodeGroup');group.node_tree=output_group();links.new(sep.outputs['Red'],group.inputs['Occlusion']);links.new(sep.outputs['Green'],p.inputs['Roughness']);links.new(sep.outputs['Blue'],p.inputs['Metallic'])
 baked.use_backface_culling=False
 return baked
