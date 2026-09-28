"""Render native JCT candidates; no runtime or installed-source claim."""
import argparse
import json
from pathlib import Path
import sys
import bpy
from mathutils import Vector


def render(candidate,output):
    assert output.is_absolute() and not output.exists()
    native=candidate/'assets/blender/izma-junctions.blend'
    bpy.ops.wm.open_mainfile(filepath=str(native))
    plan=json.loads(native.with_name('izma-junction-plan.json').read_text())
    scene=bpy.data.scenes['SW_izma_junctions'];bpy.context.window.scene=scene
    scene.render.engine='BLENDER_WORKBENCH';scene.render.resolution_x=1440;scene.render.resolution_y=1080
    scene.render.resolution_percentage=100;scene.display.shading.light='STUDIO';scene.display.shading.color_type='MATERIAL'
    scene.display.shading.show_shadows=True;scene.display.shading.show_cavity=True;scene.display.shading.cavity_type='BOTH'
    scene.display.shading.show_specular_highlight=False;scene.display.shading.background_type='WORLD'
    scene.world=bpy.data.worlds.new('JCT_candidate_world');scene.world.color=(.28,.35,.38)
    data=bpy.data.cameras.new('JCT_candidate_camera');camera=bpy.data.objects.new(data.name,data)
    scene.collection.objects.link(camera);scene.camera=camera;data.clip_end=50000;data.lens=45
    output.mkdir(parents=True);views=[]
    for ident,label,eye,aim in [('band-0-jct-1','central',(1100,-1050,1350),(0,0,0)),
                               ('band-2-jct-2','terminal',(900,-850,1000),(0,-130,0)),
                               ('band-1-jct-1','underpass',(30,-90,1.8),(0,35,1.8))]:
        site=next(s for s in plan['sites'] if s['id']==ident)
        centre=Vector((site['y'],-site['x'],site['mainlineHeight']))
        camera.location=centre+Vector(eye);camera.rotation_euler=(centre+Vector(aim)-camera.location).to_track_quat('-Z','Y').to_euler()
        scene.view_layers[0].update();scene.render.filepath=str(output/(ident+'-'+label+'.png'))
        bpy.ops.render.render(write_still=True);views.append({'site':ident,'label':label,'path':scene.render.filepath})
    result={'origin':'ai','created':'2026-09-21','scope':'Native candidate without source context; no runtime acceptance.','views':views}
    (output/'report.json').write_text(json.dumps(result,indent=2)+'\n');return result


if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--candidate-root',type=Path,required=True);p.add_argument('--output',type=Path,required=True)
    a=p.parse_args(sys.argv[sys.argv.index('--')+1:]);print(json.dumps(render(a.candidate_root,a.output)))
