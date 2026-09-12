"""Original river bridge, metric XYZ with Blender Z up. Run through Blender MCP.
The arch profile matches riverDistrictPlan.ts; all LODs retain clear springings.
"""
import bpy, math, os
from pathlib import Path
ROOT = Path('/Users/toming/keel/lake/spinward-development')
NAME = 'SWRV_river_bridge'
scene = bpy.data.scenes.get(NAME)
if scene and scene.get('spinward_owner') != 'river-district-v1':
    raise RuntimeError('Refusing to replace an unowned scene')
if scene is None:
    scene = bpy.data.scenes.new(NAME)
scene['spinward_owner'] = 'river-district-v1'
for obj in list(scene.objects):
    bpy.data.objects.remove(obj, do_unlink=True)
material = bpy.data.materials.get('SWRV_limestone') or bpy.data.materials.new('SWRV_limestone')
material.diffuse_color = (.65, .64, .56, 1)
for lod, count in enumerate([50, 24, 12]):
    vertices, faces = [], []
    for i in range(count + 1):
        x = -25 + 50 * i / count
        bottom = 3.75 + .9 * math.cos(x / 25 * math.pi / 2)
        # Converted to Three.js as x, height, depth by glTF's Y-up exporter.
        vertices += [(x, 5.8, bottom), (x, -5.8, bottom), (x, -5.8, 5.15), (x, 5.8, 5.15)]
        if i:
            a, b = (i - 1) * 4, i * 4
            for j in range(4):
                k = (j + 1) % 4
                faces.append((a+j, a+k, b+k, b+j))
    faces += [(3,2,1,0), tuple(count*4+j for j in range(4))]
    mesh = bpy.data.meshes.new(f'river_bridge_lod{lod}')
    mesh.from_pydata(vertices, [], faces); mesh.update()
    obj = bpy.data.objects.new(f'river_bridge_lod{lod}', mesh)
    scene.collection.objects.link(obj); obj.data.materials.append(material)
    obj['lod'] = lod; obj['clearance_at_spring'] = 2.55
original = bpy.context.window.scene
try:
    bpy.context.window.scene = scene
    for obj in scene.objects: obj.select_set(True)
    bpy.context.view_layer.objects.active = list(scene.objects)[0]
    bpy.ops.export_scene.gltf(filepath=str(ROOT / 'public/assets/buildings/river-bridge.glb'), export_format='GLB', use_selection=True, use_active_scene=True, export_yup=True)
    # Save the owned scene as a small reusable library without changing user's file.
    bpy.data.libraries.write(str(ROOT / 'assets/blender/river-bridge.blend'), {scene}, fake_user=True)
finally:
    bpy.context.window.scene = original
print({'scene': scene.name, 'lods': [(o.name, len(o.data.polygons)*2) for o in scene.objects], 'restored': original.name})
