"""Apply civilian building identities to all new city parcels in native parts.

Existing parcel contracts, entries, lights and far forms remain the same.
Read saved meshes, replace near/middle elevations, verify native support faces,
then save a new, self-contained part set with source and code hashes.
"""
import argparse, hashlib, json, sys
from collections import Counter
from pathlib import Path
import bpy

ASSETS=Path(__file__).resolve().parent
sys.path.insert(0,str(ASSETS))
from izma_building_identity import building_identity
from izma_building_meshes import render_building
from izma_mesh_builder import BuildingMeshBuilder
from izma_native_signs import NativeSigns
from izma_facades import seed


def digest(path):return hashlib.sha256(path.read_bytes()).hexdigest()


def physical(mesh):
    mesh.calc_loop_triangles();flags=mesh.attributes['ground_surface'];faces=Counter()
    for tri in mesh.loop_triangles:
        if not flags.data[tri.polygon_index].value:continue
        p=tuple(tuple(mesh.vertices[i].co)for i in tri.vertices)
        faces[min(p[i:]+p[:i]for i in range(3))]+=1
    return faces


def refit(source,output):
    assert source.is_absolute() and output.is_absolute() and not output.exists()
    contract_file=source/'izma-city-neighbourhoods.json';raw=contract_file.read_bytes();contract=json.loads(raw)
    index_file=source/'izma-city-neighbourhoods-native.json';index=json.loads(index_file.read_text())
    assert index['contractSha256']==digest(contract_file)
    code={name:digest(ASSETS/name)for name in ['izma_building_identity.py','izma_building_meshes.py','izma_facades.py','izma_native_signs.py','izma_mesh_builder.py','refit_izma_city_identity.py']}
    added=set(contract['cityFabric']['newParcelIds'])
    report={'origin':'ai','created':'2026-09-20','sourceIndexSha256':digest(index_file),
            'contractSha256':digest(contract_file),'code':code,'buildings':0,'nearTrianglesBefore':0,
            'nearTrianglesAfter':0,'midTrianglesAfter':0,'styles':{},'districts':{},'parts':[]}
    output.mkdir(parents=True);(output/contract_file.name).write_bytes(raw)
    for part in index['parts']:
        path=source/part['file'];assert digest(path)==part['sha256']
        bpy.ops.wm.read_factory_settings(use_empty=True)
        with bpy.data.libraries.load(str(path),link=False)as(_,loaded):loaded.scenes=[part['scene']]
        scene=loaded.scenes[0];bpy.context.window.scene=scene
        objects={obj.name:obj for obj in scene.objects};materials={}
        for obj in scene.objects:
            if obj.type!='MESH':continue
            for mat in obj.data.materials:
                key=mat.get('spinward_material',mat.name.removeprefix('SWD_').removeprefix('SWCF_'))
                materials[key]=mat
        for name,definition in contract['materials'].items():
            if name in materials:continue
            mat=bpy.data.materials.new('SWD_'+name);mat['spinward_material']=name
            mat.diffuse_color=tuple(int(definition['color'][k:k+2],16)/255 for k in [1,3,5])+(1,)
            materials[name]=mat
        signs=NativeSigns(scene);count=0;styles=Counter()
        for p in contract['parcels']:
            if p['id']not in added or p['district']!=part['district']:continue
            old=[objects[p['id']+f'_lod{lod}']for lod in [0,1]]
            before=[physical(obj.data)for obj in old]
            report['nearTrianglesBefore']+=len(old[0].data.loop_triangles)
            render_building(lambda:BuildingMeshBuilder(scene,materials,objects),p,seed(p['id']),
                            {'variedMassing':True,'buildingIdentity':True,'signWriter':signs})
            identity=building_identity(p)
            for lod in [0,1]:
                obj=objects[p['id']+f'_lod{lod}']
                assert physical(obj.data)==before[lod],('Physical building surface changed',p['id'],lod)
                obj['building_identity']=json.dumps(identity,sort_keys=True)
                obj['facade_revision']='civilian-premises-v1'
                report['nearTrianglesAfter'if lod==0 else'midTrianglesAfter']+=len(obj.data.loop_triangles)
            styles[identity['style']]+=1;count+=1
        scene['building_identity_revision']='civilian-premises-v1'
        scene.view_layers[0].update()
        assert len(scene.objects)==len(objects), 'Temporary sign objects survived conversion'
        assert all(obj.library is None and(obj.type!='MESH'or obj.data.library is None)for obj in scene.objects)
        target=output/part['file'];bpy.data.libraries.write(str(target),{scene},fake_user=True,compress=True)
        part.update({'sha256':digest(target),'bytes':target.stat().st_size,'objects':len(scene.objects)})
        report['parts'].append(dict(part));report['buildings']+=count
        report['districts'][part['district']]={'buildings':count,'styles':dict(styles)}
        for style,n in styles.items():report['styles'][style]=report['styles'].get(style,0)+n
        print(json.dumps({'district':part['district'],'buildings':count,'styles':dict(styles)}),flush=True)
        (output/'progress.json').write_text(json.dumps(report,indent=2)+'\n')
    assert report['buildings']==len(added)
    assert code=={name:digest(ASSETS/name)for name in code}, 'Authoring code changed during native refit'
    assert contract_file.read_bytes()==raw
    index['buildingIdentityRevision']={'version':1,'sourceIndexSha256':report['sourceIndexSha256'],
                                       'code':code,'buildings':report['buildings'],'physicalFacesUnchanged':True}
    (output/index_file.name).write_text(json.dumps(index,indent=2)+'\n')
    (output/'building-identity-report.json').write_text(json.dumps(report,indent=2)+'\n')
    print(json.dumps({k:v for k,v in report.items()if k not in ['parts','districts']}),flush=True)


if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--source-root',type=Path,required=True);parser.add_argument('--output-root',type=Path,required=True)
    args=parser.parse_args(sys.argv[sys.argv.index('--')+1:]);refit(args.source_root,args.output_root)
