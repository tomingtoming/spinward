"""Derive street/block LODs from the approved metric cafe using Blender baking.
Run in the connected Blender with __file__ set to this script's absolute path.
The master and its scene are retained; output lives in Spinward Cafe LODs.
"""
import bpy, json, math
from pathlib import Path
from mathutils import Vector
ROOT=Path(__file__).resolve().parents[2]
I=json.loads((ROOT/'assets/blender/cafe-pilot.json').read_text())['interior']
W,D,H=I['frontage'],I['depth'],I['building']['height']
source=bpy.data.scenes['Spinward Cafe Pilot'].objects['cafe_pilot_lod0']
scene=bpy.data.scenes.get('Spinward Cafe LODs') or bpy.data.scenes.new('Spinward Cafe LODs')
bpy.context.window.scene=scene
scene.unit_settings.system='METRIC';scene.unit_settings.scale_length=1
for o in list(scene.objects):bpy.data.objects.remove(o,do_unlink=True)
master=source.copy();master.data=source.data.copy();master.name='SWCL_BakeSource';scene.collection.objects.link(master)
# Never edit the approved master's materials during an emission bake.
for i,m in enumerate(master.data.materials):master.data.materials[i]=m.copy()
master.data.calc_loop_triangles()

def v(x,y,z):return(x,-z,y)
def surface(u,y,n,side):
 if side==0:return v(u,y,n)
 if side==1:return v(-u,y,-n)
 if side==2:return v(n,y,-u)
 return v(-n,y,u)
def uv(u,y,side):
 span=W if side<2 else D
 return ((side+(u/span+.5)*.984+.008)/4,.004+y/H*.992)
def obj(name,verts,faces,mats,indices=None,uvs=None):
 me=bpy.data.meshes.new(name);me.from_pydata(verts,[],faces);me.update()
 o=bpy.data.objects.new(name,me);scene.collection.objects.link(o)
 for m in mats:me.materials.append(m)
 if indices:
  for p,i in zip(me.polygons,indices):p.material_index=i
 if uvs:
  layer=me.uv_layers.new(name='UVMap')
  for p,coords in zip(me.polygons,uvs):
   for loop,coord in zip(p.loop_indices,coords):layer.data[loop].uv=coord
 return o
# Four outward facing receivers. UVs have gutters and a common metre scale
# within each facade; ray cages include the projecting 0.66 m canopy.
verts=[];faces=[];uvs=[]
for side in range(4):
 span=W if side<2 else D;depth=D/2 if side<2 else W/2
 points=[(-span/2,0),(span/2,0),(span/2,H),(-span/2,H)]
 n=len(verts);verts.extend(surface(u,y,depth,side) for u,y in points);faces.append(tuple(range(n,n+4)));uvs.append([uv(u,y,side) for u,y in points])
targetmat=bpy.data.materials.new('SWCL_BakeTarget');targetmat.use_nodes=True
receiver=obj('SWCL_Receiver',verts,faces,[targetmat],uvs=uvs)
scene.render.engine='CYCLES';scene.cycles.samples=1;scene.render.threads_mode='FIXED';scene.render.threads=4
scene.render.bake.use_selected_to_active=True;scene.render.bake.cage_extrusion=.85;scene.render.bake.max_ray_distance=1.2;scene.render.bake.margin=2
images={}
for channel in ['albedo','orm','emission']:
 image=bpy.data.images.new('SWCL_'+channel,width=2048,height=1024,alpha=False)
 image.colorspace_settings.name='Non-Color' if channel=='orm' else 'sRGB'
 tex=targetmat.node_tree.nodes.get('Image Texture') or targetmat.node_tree.nodes.new('ShaderNodeTexImage');tex.image=image;targetmat.node_tree.nodes.active=tex
 restore=[]
 for m in master.data.materials:
  nodes=m.node_tree.nodes;links=m.node_tree.links;p=nodes.get('Principled BSDF');out=next(n for n in nodes if n.type=='OUTPUT_MATERIAL');previous=out.inputs['Surface'].links[0].from_socket
  emission=nodes.new('ShaderNodeEmission')
  if channel=='albedo':emission.inputs['Color'].default_value=p.inputs['Base Color'].default_value
  elif channel=='orm':
   pack=nodes.new('ShaderNodeCombineColor');pack.mode='RGB';pack.inputs['Green'].default_value=p.inputs['Roughness'].default_value;pack.inputs['Blue'].default_value=p.inputs['Metallic'].default_value
   links.new(nodes['SWCP_AO'].outputs['Color'],pack.inputs['Red']);links.new(pack.outputs['Color'],emission.inputs['Color'])
  else:
   color=p.inputs['Emission Color'].default_value;strength=p.inputs['Emission Strength'].default_value
   if 'SHOP_GLASS' in m.name:strength*=.4
   emission.inputs['Color'].default_value=tuple(color[i]*strength for i in range(3))+(1,)
  links.new(emission.outputs[0],out.inputs['Surface']);restore.append((m,out,previous,emission))
 for o in list(bpy.context.selected_objects):o.select_set(False)
 master.select_set(True);receiver.select_set(True);bpy.context.view_layer.objects.active=receiver
 try:bpy.ops.object.bake(type='EMIT')
 finally:
  for m,out,previous,emission in restore:m.node_tree.links.new(previous,out.inputs['Surface']);m.node_tree.nodes.remove(emission)
 image.filepath_raw=str(ROOT/f'assets/blender/cafe-lod-{channel}.png');image.file_format='PNG';image.save();image.pack();images[channel]=image
 print('Baked',channel,flush=True)
scene.render.bake.use_selected_to_active=False
baked=bpy.data.materials.get('SWCP_BAKED_LIGHT') or bpy.data.materials.new('SWCP_BAKED_LIGHT');baked.use_nodes=True
baked.node_tree.nodes.clear();p=baked.node_tree.nodes.new('ShaderNodeBsdfPrincipled');output=baked.node_tree.nodes.new('ShaderNodeOutputMaterial');baked.node_tree.links.new(p.outputs['BSDF'],output.inputs['Surface'])
p.inputs['Roughness'].default_value=.72;p.inputs['Emission Strength'].default_value=1
for channel,socket in [('albedo','Base Color'),('emission','Emission Color')]:
 tex=baked.node_tree.nodes.new('ShaderNodeTexImage');tex.image=images[channel];baked.node_tree.links.new(tex.outputs['Color'],p.inputs[socket])
group=bpy.data.node_groups.get('glTF Material Output');node=baked.node_tree.nodes.new('ShaderNodeGroup');node.node_tree=group
tex=baked.node_tree.nodes.new('ShaderNodeTexImage');tex.image=images['orm'];separate=baked.node_tree.nodes.new('ShaderNodeSeparateColor');separate.mode='RGB';baked.node_tree.links.new(tex.outputs['Color'],separate.inputs['Color'])
baked.node_tree.links.new(separate.outputs['Red'],node.inputs['Occlusion']);baked.node_tree.links.new(separate.outputs['Green'],p.inputs['Roughness']);baked.node_tree.links.new(separate.outputs['Blue'],p.inputs['Metallic'])
# Copy approved metre geometry/UVs, dropping detail only by its semantic region.
def extract(name,predicate):
 vs=[];fs=[];mats=[];coords=[]
 for t in master.data.loop_triangles:
  points=[master.data.vertices[i].co.copy() for i in t.vertices];material=master.data.materials[t.material_index]
  if not predicate(points,material):continue
  n=len(vs);vs.extend(points);fs.append((n,n+1,n+2));mats.append(t.material_index);coords.append([master.data.uv_layers.active.data[i].uv.copy() for i in t.loops])
 return obj(name,vs,fs,list(source.data.materials),mats,coords)
def frontage(points,material):
 if max(p.z for p in points)>4.41:return False
 # Interior furnishings remain under BuildingInteriorLayer's own detail policy.
 if max(p.z for p in points)<4.2 and max(abs(p.x) for p in points)<W/2-.31 and max(-p.y for p in points)<D/2-1.3 and min(-p.y for p in points)>-D/2+.31:return False
 if 'LIGHT' in material.name and min(p.z for p in points)>3.5 and min(-p.y for p in points)>D/2+.025:return False
 return True
low1=extract('SWCL_Frontage',frontage)
roof=extract('SWCL_Roof',lambda ps,m:min(p.z for p in ps)>=H-.4)
# Upper four planes use the full-height facade atlas, preserving window rows.
def upper(name):
 vs=[];fs=[];coords=[]
 for side in range(4):
  span=W if side<2 else D;depth=D/2 if side<2 else W/2
  points=[(-span/2,4.2),(span/2,4.2),(span/2,H-.28),(-span/2,H-.28)]
  n=len(vs);vs.extend(surface(u,y,depth,side) for u,y in points);fs.append(tuple(range(n,n+4)));coords.append([uv(u,y,side) for u,y in points])
 return obj(name,vs,fs,[baked],uvs=coords)
# Keep only the forward caps of the original letters. Extrusion and rear
# faces cannot contribute at street LOD, but the letter contours still do.
sign=extract('SWCL_Sign',lambda ps,m:'LIGHT' in m.name and min(p.z for p in ps)>3.5 and min(-p.y for p in ps)>D/2+.025 and (ps[1]-ps[0]).cross(ps[2]-ps[0]).normalized().y<-.9)
def join(name,objects):
 for o in list(bpy.context.selected_objects):o.select_set(False)
 for o in objects:o.select_set(True)
 bpy.context.view_layer.objects.active=objects[0];bpy.ops.object.join();o=bpy.context.object;o.name=name;o.data.calc_loop_triangles();return o
lod1=join('cafe_pilot_lod1',[low1,upper('SWCL_Upper1'),roof,sign])
# LOD2 has a real portal and ceiling; it cannot become a solid box over a doorway.
vs=[];fs=[];coords=[]
for side in range(4):
 span=W if side<2 else D;depth=D/2 if side<2 else W/2
 regions=[(-span/2,span/2,0,4.2)] if side!=0 else [(-span/2,-1.6,0,4.2),(1.6,span/2,0,4.2),(-1.6,1.6,3.1,4.2)]
 for x0,x1,y0,y1 in regions:
  points=[(x0,y0),(x1,y0),(x1,y1),(x0,y1)];n=len(vs);vs.extend(surface(u,y,depth,side) for u,y in points);fs.append(tuple(range(n,n+4)));coords.append([uv(u,y,side) for u,y in points])
ground=obj('SWCL_Ground2',vs,fs,[baked],uvs=coords)
roof2=extract('SWCL_Roof2',lambda ps,m:min(p.z for p in ps)>=H-.4)
ceiling=extract('SWCL_Ceiling2',lambda ps,m:min(p.z for p in ps)>=4.2 and max(p.z for p in ps)<=4.28 and max(abs(p.x) for p in ps)<=W/2-.29 and max(abs(p.y) for p in ps)<=D/2-.29)
canopy=extract('SWCL_Canopy2',lambda ps,m:min(p.z for p in ps)>3.15 and max(p.z for p in ps)<3.5 and min(-p.y for p in ps)>D/2-.6)
# Plane walls need their interior side when forcing LOD2 from an occupied room.
baked.surface_render_method='DITHERED';baked.use_backface_culling=False
lod2=join('cafe_pilot_lod2',[ground,upper('SWCL_Upper2'),roof2,ceiling,canopy])
for i,o in [(1,lod1),(2,lod2)]:o['lod']=i;o['units']='metres'
for o in [master,receiver]:bpy.data.objects.remove(o,do_unlink=True)
for o in list(bpy.context.selected_objects):o.select_set(False)
lod1.select_set(True);lod2.select_set(True)
path=ROOT/'public/assets/buildings/cafe-pilot-lods.glb'
bpy.ops.export_scene.gltf(filepath=str(path),export_format='GLB',use_selection=True,use_active_scene=True,export_yup=True,export_materials='EXPORT',export_cameras=False,export_lights=False)
# Keep the saved Blender viewport reviewable; switch levels in the Outliner.
lod2.hide_set(True);lod2.hide_render=True;lod2.select_set(False);bpy.context.view_layer.objects.active=lod1
bpy.data.libraries.write(str(ROOT/'assets/blender/cafe-pilot-lods.blend'),{scene},fake_user=True,compress=True)
report={'source_master_triangles':22700,'bytes':path.stat().st_size,'levels':[]}
for o in [lod1,lod2]:report['levels'].append({'name':o.name,'triangles':len(o.data.loop_triangles),'materials':len(set(p.material_index for p in o.data.polygons)),'dimensions':list(o.dimensions)})
(ROOT/'assets/blender/cafe-lod-audit.json').write_text(json.dumps(report,indent=2)+'\n');print(json.dumps(report))
