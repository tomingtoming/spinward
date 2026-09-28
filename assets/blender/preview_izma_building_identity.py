"""Matched native elevations from real saved parcels before a citywide refit."""
import argparse, copy, hashlib, json, math, sys
from pathlib import Path
from collections import Counter
import bpy
from mathutils import Vector

sys.path.insert(0,str(Path(__file__).resolve().parent))
from izma_building_identity import building_identity
from izma_building_meshes import render_building
from izma_mesh_builder import BuildingMeshBuilder
from izma_native_signs import NativeSigns
from izma_facades import seed


def physical(mesh):
    mesh.calc_loop_triangles();flags=mesh.attributes['ground_surface'];result=Counter()
    for tri in mesh.loop_triangles:
        if not flags.data[tri.polygon_index].value:continue
        p=tuple(tuple(mesh.vertices[i].co)for i in tri.vertices)
        result[min(p[i:]+p[:i]for i in range(3))]+=1
    return result


def preview(source,output):
    assert source.is_absolute() and output.is_absolute() and not output.exists()
    raw=(source/'izma-city-neighbourhoods.json').read_bytes();contract=json.loads(raw)
    index=json.loads((source/'izma-city-neighbourhoods-native.json').read_text())
    assert hashlib.sha256(raw).hexdigest()==index['contractSha256']
    parts={p['district']:p for p in index['parts']};added=set(contract['cityFabric']['newParcelIds'])
    output.mkdir(parents=True);report={'origin':'ai','created':'2026-09-20','sourceIndexSha256':hashlib.sha256((source/'izma-city-neighbourhoods-native.json').read_bytes()).hexdigest(),'families':[]}
    for family,district,target_width,target_floors in [('house','a-old-town',9,2),('shop-house','c-market',10,3),('apartment','b-housing',20,4),('office','a-civic',22,5)]:
        chosen=[];styles=set()
        for p in sorted((p for p in contract['parcels']if p['id']in added and p['family']==family),key=lambda p:(p['district']!=district,abs(p['floors']-target_floors),abs(p['size'][0]-target_width),p['id'])):
            style=building_identity(p)['style']
            if style in styles:continue
            chosen.append(p);styles.add(style)
            if len(chosen)==3:break
        assert len(chosen)==3,family
        bpy.ops.wm.read_factory_settings(use_empty=True)
        scene=bpy.context.scene;scene.name='SW_identity_'+family
        scene['owner']='spinward-identity-comparison-v1'
        originals={};materials={}
        for p in chosen:
            part=parts[p['district']];path=source/part['file']
            assert hashlib.sha256(path.read_bytes()).hexdigest()==part['sha256']
            with bpy.data.libraries.load(str(path),link=False)as(_,loaded):loaded.objects=[p['id']+'_lod0']
            obj=loaded.objects[0];assert obj is not None
            scene.collection.objects.link(obj);originals[p['id']]=obj
            for mat in obj.data.materials:
                key=mat.get('spinward_material',mat.name.removeprefix('SWD_').removeprefix('SWCF_'))
                materials[key]=mat
        for name,definition in contract['materials'].items():
            if name in materials:continue
            mat=bpy.data.materials.new('SWD_'+name);mat['spinward_material']=name
            mat.diffuse_color=tuple(int(definition['color'][k:k+2],16)/255 for k in [1,3,5])+(1,)
            materials[name]=mat
        width=max(p['size'][0]for p in chosen);spacing=width+6;span=spacing*2+width
        parcels=[];supports={}
        for i,p in enumerate(chosen):
            q=copy.deepcopy(p);offset=q['floor']-.25;q['floor']-=offset;q['foundationBottom']-=offset
            q['position']=[0,(i-1)*spacing];q['yaw']=math.pi/2;parcels.append(q)
            obj=originals[p['id']];obj.location=(q['position'][1],0,q['floor']);obj.rotation_euler.z=0
            obj.hide_render=False;supports[p['id']]=physical(obj.data)
        ground=bpy.data.meshes.new('comparison-ground');ground.from_pydata([(-span,-40,0),(span,-40,0),(span,40,0),(-span,40,0)],[],[(0,1,2,3)])
        ground.materials.append(materials['paving']);obj=bpy.data.objects.new(ground.name,ground);scene.collection.objects.link(obj)
        scene.render.engine='BLENDER_WORKBENCH';sh=scene.display.shading
        sh.light='STUDIO';sh.color_type='MATERIAL';sh.show_shadows=False;sh.show_cavity=True;sh.cavity_type='BOTH';sh.show_specular_highlight=False
        sh.background_type='WORLD';scene.world=bpy.data.worlds.new('comparison-world');scene.world.color=(.16,.18,.21)
        scene.render.resolution_x=1800;scene.render.resolution_y=1000;scene.render.resolution_percentage=100
        scene.render.image_settings.file_format='PNG';scene.view_settings.view_transform='Standard'
        data=bpy.data.cameras.new('comparison-camera');camera=bpy.data.objects.new(data.name,data);scene.collection.objects.link(camera);scene.camera=camera
        data.type='ORTHO';data.ortho_scale=span*1.10;data.clip_end=1000
        high=max(p['size'][2]for p in chosen);target=Vector((0,0,high*.34))
        camera.location=(span*.07,-span*.9,high*.34+span*.28);camera.rotation_euler=(target-camera.location).to_track_quat('-Z','Y').to_euler()
        scene.render.filepath=str(output/(family+'-before.png'));bpy.ops.render.render(write_still=True)
        objects={obj.name:obj for obj in scene.objects};signs=NativeSigns(scene)
        counts=[]
        for p in parcels:
            before=len(originals[p['id']].data.loop_triangles)
            render_building(lambda:BuildingMeshBuilder(scene,materials,objects),p,seed(p['id']),{'variedMassing':True,'buildingIdentity':True,'signWriter':signs})
            obj=originals[p['id']];assert physical(obj.data)==supports[p['id']],('Native support changed',p['id'])
            counts.append({'id':p['id'],'identity':building_identity(p),'beforeTriangles':before,'afterTriangles':len(obj.data.loop_triangles)})
        scene.render.filepath=str(output/(family+'-after.png'));bpy.ops.render.render(write_still=True)
        bpy.data.libraries.write(str(output/(family+'.blend')),{scene},fake_user=True,compress=True)
        report['families'].append({'family':family,'buildings':counts,'physicalFacesUnchanged':True})
        print(json.dumps(report['families'][-1]),flush=True)
    (output/'report.json').write_text(json.dumps(report,indent=2)+'\n')


if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--source-root',type=Path,required=True);parser.add_argument('--output-root',type=Path,required=True)
    args=parser.parse_args(sys.argv[sys.argv.index('--')+1:]);preview(args.source_root,args.output_root)
