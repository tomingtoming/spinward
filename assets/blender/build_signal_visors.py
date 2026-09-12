"""Original signal hoods, in native metres; owns only SWHV_signal_visors."""
import bpy, math, sys, json
from pathlib import Path
ROOT = Path(__file__).resolve().parents[2]
sys.dont_write_bytecode = True
sys.path.insert(0, str(ROOT/'assets/blender'))
from building_mesh_kit import MeshBuilder, local, export

previous = bpy.context.window.scene
name = 'SWHV_signal_visors'
old = bpy.data.scenes.get(name)
if old:
    if old.get('spinward_asset') != 'signal-visors-v1': raise RuntimeError('Unowned scene')
    for obj in list(old.objects):
        if len(obj.users_scene) == 1: bpy.data.objects.remove(obj, do_unlink=True)
    bpy.data.scenes.remove(old)
scene = bpy.data.scenes.new(name)
scene['spinward_asset'] = 'signal-visors-v1'
scene.unit_settings.system = 'METRIC'
bpy.context.window.scene = scene
try:
    material = bpy.data.materials.new('SWHV_charcoal')
    material.diffuse_color = (.22,.26,.29,1)
    objects, audit = [], {}
    for lod, segments in [(0,12),(1,5)]:
        b = MeshBuilder(scene,'signal_visors_lod'+str(lod),[material])
        for centre in [-.28,0,.28]:
            def p(r,z,a): return local(r*math.cos(a),centre+r*math.sin(a),z)
            for i in range(segments):
                a,c = [math.radians(-30+240*n/segments) for n in [i,i+1]]
                # Upper and side cover, open below. The shell penetrates the
                # backing plate by 5 mm; the round lens remains unobstructed.
                for points in [
                    [p(.132,.145,a),p(.132,.145,c),p(.132,.32,c),p(.132,.32,a)],
                    [p(.116,.145,c),p(.116,.145,a),p(.116,.32,a),p(.116,.32,c)],
                    [p(.132,.32,a),p(.132,.32,c),p(.116,.32,c),p(.116,.32,a)],
                    [p(.132,.145,c),p(.132,.145,a),p(.116,.145,a),p(.116,.145,c)]
                ]: b.face(points,material)
            for angle, reverse in [(math.radians(-30),False),(math.radians(210),True)]:
                points=[p(.116,.145,angle),p(.132,.145,angle),p(.132,.32,angle),p(.116,.32,angle)]
                b.face(points[::-1] if reverse else points,material)
            if lod == 0:
                for side in [-1,1]: b.box(side*.143,centre-.018,.155,.03,.046,.03,material)
        obj=b.finish()
        for uv in list(obj.data.uv_layers): obj.data.uv_layers.remove(uv)
        objects.append(obj)
        audit[obj.name]=len(obj.data.loop_triangles)
    export(scene,objects,ROOT/'public/assets/signal-visors.glb')
    bpy.data.libraries.write(str(ROOT/'assets/blender/signal-visors.blend'),{scene})
    result={'origin':'ai','created':'2026-09-13','triangles':audit,'lensRadius':.105,'hoodInnerRadius':.116,'mountZ':.145,'frontZ':.32}
    (ROOT/'assets/blender/signal-visors-audit.json').write_text(json.dumps(result,indent=2)+'\n')
finally:
    bpy.context.window.scene=previous
