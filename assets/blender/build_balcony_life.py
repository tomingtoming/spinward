"""Small metric outdoor furniture. Owns only SWBL_balcony_life."""
import bpy, json, sys
from pathlib import Path
ROOT = Path(__file__).resolve().parents[2]
sys.dont_write_bytecode = True
sys.path.insert(0, str(ROOT / 'assets/blender'))
from building_mesh_kit import MeshBuilder, export

previous = bpy.context.window.scene
name = 'SWBL_balcony_life'
old = bpy.data.scenes.get(name)
if old:
    if old.get('spinward_asset') != 'balcony-life-v1':
        raise RuntimeError('Unowned scene')
    for obj in list(old.objects):
        if len(obj.users_scene) == 1:
            bpy.data.objects.remove(obj, do_unlink=True)
    bpy.data.scenes.remove(old)
scene = bpy.data.scenes.new(name)
scene['spinward_asset'] = 'balcony-life-v1'
scene.unit_settings.system = 'METRIC'
bpy.context.window.scene = scene
try:
    material = bpy.data.materials.new('SWBL_furniture')
    material.diffuse_color = (.56, .52, .43, 1)
    objects, audit = [], {}
    for lod in [0, 1]:
        chair = MeshBuilder(scene, 'balcony_chair_lod' + str(lod), [material])
        # Runtime coordinates in metres; y=0 is the deck. Four legs remain in both LODs.
        for x in [-.195, .195]:
            for z in [-.15, .15]: chair.box(x, .205, z, .035, .41, .035, material)
        chair.box(0, .425, 0, .46, .03, .38, material)
        for x in [-.195, .195]: chair.box(x, .62, -.166, .035, .4, .035, material)
        if lod == 0:
            for y in [.59, .67, .75]: chair.box(0, y, -.166, .39, .046, .026, material)
        else: chair.box(0, .68, -.166, .39, .2, .026, material)
        table = MeshBuilder(scene, 'balcony_table_lod' + str(lod), [material])
        table.box(0, .5825, 0, .32, .035, .3, material)
        if lod == 0:
            for x in [-.12, .12]:
                for z in [-.11, .11]: table.box(x, .2825, z, .026, .565, .026, material)
        else:
            table.box(0, .2825, 0, .045, .565, .045, material)
            table.box(0, .025, 0, .27, .05, .25, material)
        for builder in [chair, table]:
            obj = builder.finish()
            # Geometry stays in native metres; no scale-to-fit at runtime.
            for uv in list(obj.data.uv_layers): obj.data.uv_layers.remove(uv)
            objects.append(obj)
            audit[obj.name] = len(obj.data.loop_triangles)
    export(scene, objects, ROOT / 'public/assets/buildings/balcony-life.glb')
    bpy.data.libraries.write(str(ROOT / 'assets/blender/balcony-life.blend'), {scene})
    (ROOT / 'assets/blender/balcony-life-audit.json').write_text(json.dumps({'origin': 'ai', 'created': '2026-09-13', 'triangles': audit}, indent=2)+'\n')
finally:
    bpy.context.window.scene = previous
