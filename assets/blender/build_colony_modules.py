"""Metric structural modules for the complete colony; only owns SWCM scene."""
import bpy, json
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2]
previous=bpy.context.window.scene
name='SWCM_colony_modules'
old=bpy.data.scenes.get(name)
if old:
    if old.get('spinward_asset')!='colony-modules-v1':raise RuntimeError('Unowned scene')
    for o in list(old.objects):
        if len(o.users_scene)==1:bpy.data.objects.remove(o,do_unlink=True)
    bpy.data.scenes.remove(old)
scene=bpy.data.scenes.new(name);scene['spinward_asset']='colony-modules-v1';scene.unit_settings.system='METRIC';bpy.context.window.scene=scene
mat=bpy.data.materials.new('SWCM_structure');mat.diffuse_color=(.7,.72,.68,1)
def cube(name,parts):
    objects=[]
    for x,y,z,w,h,d in parts:
        bpy.ops.mesh.primitive_cube_add(size=1,location=(x,-z,y))
        o=bpy.context.object;o.name=name;o.scale=(w,d,h);bpy.ops.object.transform_apply(location=False,rotation=False,scale=True);objects.append(o)
    bpy.ops.object.select_all(action='DESELECT')
    for o in objects:o.select_set(True)
    bpy.context.view_layer.objects.active=objects[0];bpy.ops.object.join();o=bpy.context.object;o.name=name
    scene.cursor.location=(0,0,0);bpy.ops.object.origin_set(type='ORIGIN_CURSOR');o.data.materials.append(mat)
    # Box UVs are explicit per-face, independent of Blender's cube atlas.
    uv=o.data.uv_layers.active or o.data.uv_layers.new()
    for p in o.data.polygons:
        n=p.normal
        for li in p.loop_indices:
            v=o.data.vertices[o.data.loops[li].vertex_index].co
            uv.data[li].uv=((v.y if abs(n.x)>.5 else v.x)+.5,v.z+.5)
    return o
cube('structure',[(0,0,0,1,1,1)])
cube('window_frame',[(-.49,0,.025,.02,1,.05),(.49,0,.025,.02,1,.05),(0,-.49,.025,.96,.02,.05),(0,.49,.025,.96,.02,.05),(0,0,.025,.015,.96,.05)])
cube('canopy',[(0,0,0,1,1,1)])
cube('door',[(0,0,0,1,1,1)])
bpy.ops.object.select_all(action='SELECT')
path=ROOT/'public/assets/buildings/colony-modules.glb'
bpy.ops.export_scene.gltf(filepath=str(path),export_format='GLB',use_selection=True,use_active_scene=True,export_yup=True,export_materials='EXPORT')
bpy.data.libraries.write(str(ROOT/'assets/blender/colony-modules.blend'),{scene},fake_user=True,compress=True)
bpy.context.window.scene=previous
result={'asset':str(path),'bytes':path.stat().st_size,'nodes':['structure','window_frame','canopy','door']}
