"""Render the native IC patch with the retained source visible around it."""
import argparse
import json
from pathlib import Path
import sys
import bpy
from mathutils import Vector

ASSETS=Path(__file__).resolve().parent;ROOT=ASSETS.parents[1]
sys.path.insert(0,str(ASSETS))
from colony_manifest_io import read_manifest


def render(integration,output,river_only=False):
    if not output.is_absolute() or output.exists():raise ValueError('Use a fresh absolute output folder')
    native=integration/'izma-motorway-integration.blend';edit=json.loads(native.with_suffix('.json').read_text())
    source=read_manifest(ROOT/'src/worlds/generated/izmaColony.json')
    assert json.loads((ROOT/'src/worlds/generated/izmaColony.json').read_text())['sourceSha256']==edit['sourceSha256']
    bpy.ops.wm.open_mainfile(filepath=str(native));scene=bpy.data.scenes['SW_izma_motorway_integration']
    bpy.context.window.scene=scene
    scene.render.engine='BLENDER_WORKBENCH';scene.render.resolution_x=1280;scene.render.resolution_y=960
    scene.render.resolution_percentage=100;scene.display.shading.light='STUDIO';scene.display.shading.color_type='MATERIAL'
    scene.display.shading.show_shadows=True;scene.display.shading.show_cavity=True;scene.display.shading.cavity_type='BOTH'
    scene.display.shading.show_specular_highlight=False;scene.display.shading.background_type='WORLD'
    scene.world=bpy.data.worlds.new('IC_validation_world');scene.world.color=(.38,.43,.45)
    camdata=bpy.data.cameras.new('IC_validation_camera');camera=bpy.data.objects.new(camdata.name,camdata)
    scene.collection.objects.link(camera);scene.camera=camera;camdata.lens=45;camdata.clip_end=5000
    output.mkdir(parents=True);context=[];views=[]
    samples=[('b-north-ic','underpass',(5382.064327658226,14980,57.9),(38,80,7),(0,0,6)),
             ('c-production-ic','underpass',(14724.128655316452,-11220,13.25),(38,80,7),(0,0,6)),
             ('a-civic-ic','crossing',(1277,6500,22.5),(-35,12,3),(25,0,3)),
             ('a-port-ic','overview',(1320,-15920,11.55),(600,-600,430),(0,70,0))]
    if river_only:
        samples=[('a-river-ic','bridge-approach',(300,-20,8),(-330,-420,310),(0,0,0)),
                 ('a-river-ic','bridge-eye',(200,-80,8.2),(-5,75,1.65),(0,-240,1)),
                 ('a-river-ic','street-join',(475,70,9),(-75,-35,32),(0,0,0))]
    for owner,label,(cx,cy,h),eye,aim in samples:
        for obj in scene.objects:
            if 'motorway_id' in obj:obj.hide_render=obj['motorway_id']!=owner or not obj.get('drawing',True)
        for obj in context:bpy.data.objects.remove(obj,do_unlink=True)
        context=[]
        layers={'base':source['base'],**{k:v['fixed'] for k,v in source.items() if isinstance(v,dict) and 'fixed' in v}}
        palette=dict(source['palette'])
        if river_only:
            study=json.loads((ROOT/'src/worlds/generated/worldLandscapes.json').read_text())['izma']
            layers['study']={'vertices':study['vertices'],'meshes':{'study-'+k:v for k,v in study['lods'][0].items()}}
            palette.update({'study-'+k:v for k,v in study['palette'].items()})
            for tile in source['tiles']:
                a,b,c,d=tile['bounds']
                if a<=cx+650 and c>=cx-650 and b<=cy+850 and d>=cy-850:
                    layers['tile-'+tile['id']]=json.loads((ROOT/'public'/tile['url'].lstrip('/')).read_text())
        for layer,packed in layers.items():
            for material,ids in packed['meshes'].items():
                points=[];retired=set(edit['drawingRemove'].get(material,[])) if layer=='base' else set()
                for offset in range(0,len(ids),3):
                    if offset//3 in retired:continue
                    tri=[packed['vertices'][i*3:i*3+3] for i in ids[offset:offset+3]]
                    if max(p[0] for p in tri)<cx-650 or min(p[0] for p in tri)>cx+650 or max(p[1] for p in tri)<cy-850 or min(p[1] for p in tri)>cy+850:continue
                    points.extend((y,-x,z) for x,y,z in tri)
                if not points:continue
                mesh=bpy.data.meshes.new(layer+'_'+material);mesh.from_pydata(points,[],[tuple(range(i,i+3)) for i in range(0,len(points),3)]);mesh.update()
                obj=bpy.data.objects.new(mesh.name,mesh);scene.collection.objects.link(obj);mat=bpy.data.materials.new(mesh.name)
                color=palette[material];mat.diffuse_color=tuple(int(color[j:j+2],16)/255 for j in [1,3,5])+(1,)
                mesh.materials.append(mat);context.append(obj)
        centre=Vector((cy,-cx,h));camera.location=centre+Vector(eye)
        camera.rotation_euler=(centre+Vector(aim)-camera.location).to_track_quat('-Z','Y').to_euler()
        scene.view_layers[0].update();scene.render.filepath=str(output/(owner+'-'+label+'.png'))
        bpy.ops.render.render(write_still=True);views.append({'id':owner,'view':label,'file':scene.render.filepath})
    (output/'report.json').write_text(json.dumps({'origin':'ai','created':'2026-09-20','nativeSha256':edit['nativeSha256'],
        'sourceSha256':edit['sourceSha256'],'scope':'Native patch plus retained fixed source drawing; no runtime claim','views':views},indent=2)+'\n')


if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--integration-root',type=Path,required=True)
    parser.add_argument('--output-root',type=Path,required=True)
    parser.add_argument('--river-only',action='store_true')
    args=parser.parse_args(sys.argv[sys.argv.index('--')+1:]);render(args.integration_root,args.output_root,args.river_only)
