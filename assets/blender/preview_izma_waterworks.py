"""Render saved waterworks with their actual surrounding native terrain."""
import argparse
import json
import math
from pathlib import Path
import sys
import bpy
from mathutils import Vector

ASSETS = Path(__file__).resolve().parent
sys.path.insert(0, str(ASSETS))
from colony_manifest_io import read_manifest


def preview(candidate, output):
    native = candidate / 'assets/blender/izma-waterworks.blend'
    bpy.ops.wm.open_mainfile(filepath=str(native))
    scene = bpy.data.scenes['SW_izma_waterworks']
    assert scene.get('owner') == 'spinward-izma-waterworks-v1'
    bpy.context.window.scene = scene
    plan = json.loads((native.with_name('izma-waterworks-plan.json')).read_text())
    source = read_manifest(ASSETS.parents[1] / 'src/worlds/generated/izmaColony.json')
    base = source['base']
    scene.render.engine = 'BLENDER_WORKBENCH'
    scene.render.resolution_x = 1200
    scene.render.resolution_y = 900
    scene.render.resolution_percentage = 100
    scene.display.shading.light = 'STUDIO'
    scene.display.shading.color_type = 'MATERIAL'
    scene.display.shading.show_shadows = False
    scene.display.shading.show_cavity = False
    scene.display.shading.show_specular_highlight = False
    scene.display.shading.background_type = 'WORLD'
    if scene.world is None:
        scene.world = bpy.data.worlds.new('Waterworks_preview_world')
    scene.world.color = (.35, .42, .44)
    camera_data = bpy.data.cameras.new('Waterworks_preview_camera')
    camera = bpy.data.objects.new(camera_data.name, camera_data)
    scene.collection.objects.link(camera)
    scene.camera = camera
    camera_data.lens = 44
    camera_data.clip_end = 3000
    context = []
    output.mkdir(parents=True, exist_ok=True)
    files = []
    for site in plan['facilities']:
        for obj in scene.objects:
            if obj.type == 'MESH' and 'waterworks_id' in obj:
                obj.hide_render = obj['waterworks_id'] != site['id'] or obj['lod'] not in [-1, 0]
        for obj in context:
            data = obj.data
            bpy.data.objects.remove(obj, do_unlink=True)
            if data.users == 0:
                bpy.data.meshes.remove(data)
        context = []
        cx, cy = site['position']
        for material, indices in base['meshes'].items():
            points = []
            for i in range(0, len(indices), 3):
                tri = [base['vertices'][j * 3:j * 3 + 3] for j in indices[i:i + 3]]
                if max(p[0] for p in tri) < cx - 400 or min(p[0] for p in tri) > cx + 400:
                    continue
                if max(p[1] for p in tri) < cy - 1000 or min(p[1] for p in tri) > cy + 1000:
                    continue
                points.extend((y, -x, h) for x, y, h in tri)
            if not points:
                continue
            mesh = bpy.data.meshes.new('Context_' + material)
            mesh.from_pydata(points, [], [tuple(range(i, i + 3)) for i in range(0, len(points), 3)])
            mesh.update()
            obj = bpy.data.objects.new(mesh.name, mesh)
            scene.collection.objects.link(obj)
            mat = bpy.data.materials.new('Context_' + material)
            color = source['palette'][material]
            mat.diffuse_color = tuple(int(color[i:i + 2], 16) / 255 for i in [1, 3, 5]) + (1,)
            mesh.materials.append(mat)
            context.append(obj)
        frames = [('overview', (170, -255, 200), (0, 0, 0))]
        if site['id'] in ['a-supply', 'b-recovery']:
            frames.append(('inspection', (18, -24, 8), (0, 0, 3)))
        if site['id'] == 'b-recovery':
            frames.extend([('junction-top', (0, 6, 22), (0, 6, 3.38)),
                           ('junction-side', (8, -3, 4.5), (0, 6, 3.38))])
        if site['id'] == 'c-recovery':
            frames.append(('filter-reeds', (92, -43, 12), (75, -25, 2.6)))
        if site['id'] == 'a-recovery':
            px, py, ph = site['riverPort']
            end = (py - cy, -(px - cx), ph - site['floor'])
            frames.append(('river-port', (end[0] + 10, end[1] + 8, end[2] + 4), end))
        for name, offset, aim in frames:
            centre = Vector((cy, -cx, site['floor']))
            camera.location = centre + Vector(offset)
            camera.rotation_euler = ((centre + Vector(aim)) - camera.location).to_track_quat('-Z', 'Y').to_euler()
            scene.view_layers[0].update()
            target = output / (site['id'] + '-' + name + '.png')
            scene.render.filepath = str(target)
            bpy.ops.render.render(write_still=True)
            files.append(str(target))
    print(json.dumps({'native': str(native), 'frames': files}), flush=True)


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--candidate-root', type=Path, required=True)
    parser.add_argument('--output-dir', type=Path, required=True)
    args = parser.parse_args(sys.argv[sys.argv.index('--') + 1:])
    preview(args.candidate_root, args.output_dir)
