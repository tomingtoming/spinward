"""Refit saved native entrances and their minimal threshold raises in new parts."""
import argparse,hashlib,json,math,sys
from pathlib import Path
import bpy
from mathutils.bvhtree import BVHTree

ASSETS=Path(__file__).resolve().parent
sys.path.insert(0,str(ASSETS))
from colony_manifest_io import read_manifest
from izma_building_forms import building_form
from izma_building_meshes import render_building
from izma_city_contract import parcel_contract
from izma_city_access import append_entry
from izma_city_entry_sides import append_entry_sides
from izma_mesh_builder import BuildingMeshBuilder
from izma_native_signs import NativeSigns
from izma_facades import seed


def digest(path):return hashlib.sha256(path.read_bytes()).hexdigest()


def refit(source,output,plan_path,manifest_path):
    assert all(p.is_absolute()for p in [source,output,plan_path,manifest_path])
    assert not output.exists() and output!=source
    contract_path=source/'izma-city-neighbourhoods.json';contract=json.loads(contract_path.read_text())
    index_path=source/'izma-city-neighbourhoods-native.json';index=json.loads(index_path.read_text())
    assert index['contractSha256']==digest(contract_path)
    plan=json.loads(plan_path.read_text());revisions={p['id']:p for p in plan['parcels']}
    original={p['id']:p for p in contract['parcels']}
    profiles={s['id']:s['profile']for s in contract['streets']}
    for road in json.loads((ASSETS/'izma-transport.json').read_text())['profiles']:
        shift=road['band']*math.tau*3200/3
        profiles[road['id']]=[[p[0]+shift,p[1],p[2]]for p in road['points']]
    for ident,p in revisions.items():
        old=original[ident]
        assert not old.get('entryConnection'), 'A revised alley connector needs a separate connection profile'
        for key in ['position','outline','yaw','foundationBottom','family','floors','size','volumes','wall','roof']:
            assert p[key]==old[key],('Allocation or identity changed',ident,key)
        assert p['floor']>=old['floor'] and p['accessClearance']['originalFloor']==old['floor']
        p=parcel_contract(p,profiles)
        p['access']['landingLength']=p['entrance']['landingLength']
        revisions[ident]=p
    contract['parcels']=[revisions.get(p['id'],p)for p in contract['parcels']]
    code={name:digest(ASSETS/name)for name in ['refit_izma_city_access.py','izma_city_access.py','izma_city_entry_sides.py','izma_city_contract.py','izma_building_meshes.py','izma_building_identity.py','izma_facades.py','izma_mesh_builder.py']}
    revision={'version':1,'sourceContractSha256':digest(contract_path),'sourceIndexSha256':digest(index_path),
              'planSha256':digest(plan_path),'code':code,'entrances':len(revisions)}
    contract['accessClearanceRevision']=revision
    manifest=read_manifest(manifest_path);packed=manifest['base'];pool=packed['vertices'];ids=packed['meshes']['earth']
    points=[((3200-h)*math.cos(x/3200),y,(3200-h)*math.sin(x/3200))for x,y,h in [pool[i:i+3]for i in range(0,len(pool),3)]]
    earth=BVHTree.FromPolygons(points,[ids[i:i+3]for i in range(0,len(ids),3)],all_triangles=True)
    heights={}
    def ground(p):
        key=tuple(p)
        if key not in heights:
            c,s=math.cos(p[0]/3200),math.sin(p[0]/3200)
            hit=earth.ray_cast((c*3000,p[1],s*3000),(c,0,s),400)[0]
            assert hit is not None
            heights[key]=3200-math.hypot(hit.x,hit.z)
        return heights[key]
    output.mkdir(parents=True)
    target_contract=output/contract_path.name
    target_contract.write_text(json.dumps(contract,separators=(',',':'))+'\n')
    report={'origin':'ai','created':'2026-09-20',**revision,'parts':[],'changed':[]}
    for part in index['parts']:
        source_part=source/part['file'];assert digest(source_part)==part['sha256']
        selected=[p for p in revisions.values()if p['district']==part['district']]
        target=output/part['file']
        if not selected:
            target.hardlink_to(source_part)
            report['parts'].append(dict(part));continue
        bpy.ops.wm.read_factory_settings(use_empty=True)
        with bpy.data.libraries.load(str(source_part),link=False)as(_,loaded):loaded.scenes=[part['scene']]
        scene=loaded.scenes[0];bpy.context.window.scene=scene
        objects={o.name:o for o in scene.objects};materials={}
        for obj in scene.objects:
            if obj.type!='MESH':continue
            for mat in obj.data.materials:materials[mat.get('spinward_material',mat.name.removeprefix('SWD_').removeprefix('SWCF_'))]=mat
        signs=NativeSigns(scene)
        for p in selected:
            old=original[p['id']];raise_by=p['floor']-old['floor']
            render_building(lambda:BuildingMeshBuilder(scene,materials,objects),p,seed(p['id']),
                            {'variedMassing':True,'buildingIdentity':True,'signWriter':signs})
            for lod in [0,1]:objects[p['id']+f'_lod{lod}']['access_clearance_revision']=1
            if p['id']+'_lod2' in objects:
                # Keep the editable far mesh coherent with the exported proxy parts.
                builder=BuildingMeshBuilder(scene,materials,objects)
                w,d,_=p['size'];bottom=p['foundationBottom']-p['floor']
                builder.box(0,0,bottom,w+.5,d+.5,-bottom,'foundation',cap=False)
                floor_h=3.4 if p['family']=='office'else 5.2 if p['family']=='warehouse'else 3.2
                _,volumes,roofs=building_form(p['family'],w,d,p['floors'],floor_h,seed(p['id']),True)
                for u,v,z,pw,pd,ph in volumes:builder.box(u,v,z,pw,pd,ph,p['wall'],cap=False)
                for u,v,z,pw,pd,ph,shape in roofs:
                    if shape=='gable':builder.gable(u,v,z,pw,pd,ph,p['roof'])
                    else:builder.box(u,v,z,pw,pd,ph,p['roof'])
                far=builder.finish(p['id']+'_lod2',p,2);far.hide_render=True;far['access_clearance_revision']=1
            builder=BuildingMeshBuilder(scene,materials,objects);append_entry(builder,p);append_entry_sides(builder,p,ground)
            entry=builder.finish(p['id']+'_entry',p,-1);entry['entry_sides_revision']=1;entry['access_clearance_revision']=1
            for obj in scene.objects:
                if obj.get('parcel_id')==p['id'] and (obj.type=='LIGHT' or obj.name in [p['id']+'_entry_light0',p['id']+'_entry_light1']):obj.location.z+=raise_by
            report['changed'].append({'id':p['id'],'district':p['district'],**p['accessClearance']})
        scene['access_clearance_revision']=1;scene.view_layers[0].update()
        assert len(scene.objects)==len(objects)
        assert all(o.library is None and(o.type!='MESH'or o.data.library is None)for o in scene.objects)
        bpy.data.libraries.write(str(target),{scene},fake_user=True,compress=True)
        part.update(sha256=digest(target),bytes=target.stat().st_size,objects=len(scene.objects))
        report['parts'].append(dict(part));print(json.dumps({'district':part['district'],'entrances':len(selected)}),flush=True)
    assert len(report['changed'])==len(revisions)
    assert code=={name:digest(ASSETS/name)for name in code}
    index['contractSha256']=digest(target_contract);index['accessClearanceRevision']=revision
    (output/index_path.name).write_text(json.dumps(index,indent=2)+'\n')
    (output/'access-clearance-report.json').write_text(json.dumps(report,indent=2)+'\n')
    print(json.dumps({'entrances':len(revisions),'raisedBuildings':sum(p['floor']>original[p['id']]['floor'] for p in revisions.values()),'parts':len(index['parts'])}),flush=True)


if __name__=='__main__':
    parser=argparse.ArgumentParser()
    for name in ['source-root','output-root','plan','manifest']:parser.add_argument('--'+name,type=Path,required=True)
    args=parser.parse_args(sys.argv[sys.argv.index('--')+1:]);refit(args.source_root,args.output_root,args.plan,args.manifest)
