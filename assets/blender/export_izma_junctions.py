"""Export a hash-bound native JCT replacement into an isolated full source."""
import argparse
from collections import defaultdict
import hashlib
import json
from pathlib import Path
import sys
import math
import bpy

ASSETS=Path(__file__).resolve().parent;ROOT=ASSETS.parents[1]
sys.path.insert(0,str(ASSETS))
from colony_manifest_io import read_manifest,write_manifest,encoded
from colony_collision_partition import refine_city_ground
from izma_collision_mesh import finalize_packed_collision
from izma_motorway_replacement import face_area
from plan_izma_junction_routes import combine_profiles


def export(integration,candidate,output):
    assert all(p.is_absolute() for p in [integration,candidate,output]) and not output.exists() and output!=ROOT
    native=integration/'izma-junctions-integration.blend';edit=json.loads(native.with_suffix('.json').read_text())
    assert hashlib.sha256(native.read_bytes()).hexdigest()==edit['nativeSha256']
    plan_path=candidate/'assets/blender/izma-junction-plan.json';plan=json.loads(plan_path.read_text())
    assert hashlib.sha256(plan_path.read_bytes()).hexdigest()==edit['planSha256']
    document=ROOT/'src/worlds/generated/izmaColony.json'
    assert json.loads(document.read_text())['sourceSha256']==edit['sourceSha256']
    source=read_manifest(document)
    bpy.ops.wm.open_mainfile(filepath=str(native));scene=bpy.data.scenes['SW_izma_junctions_integration']
    assert scene['owner']==edit['owner'] and scene['sourceSha256']==edit['sourceSha256']
    scene.view_layers[0].update();drawing=defaultdict(list);physical=defaultdict(list);dropped=0;guides={}
    for obj in scene.objects:
        assert obj['owner']==edit['owner'] and obj.type=='MESH'
        vertices=[]
        for v in obj.data.vertices:
            p=obj.matrix_world@v.co;vertices.append(tuple(round(value,5) for value in [-p.y,p.x,p.z]))
        if obj.get('role')=='centreline':guides[obj['junction_id']]=vertices;continue
        mesh=obj.data;mesh.calc_loop_triangles();flags=mesh.attributes['physical'].data;floors=mesh.attributes['ground_surface'].data
        for tri in mesh.loop_triangles:
            points=[vertices[i] for i in tri.vertices]
            if face_area(points)<1e-8:dropped+=1;continue
            material=mesh.materials[tri.material_index]['spinward_material']
            if obj['drawing']:drawing[material].extend(points)
            if flags[tri.polygon_index].value:
                x,y=[sum(p[k] for p in points)/3 for k in [0,1]]
                physical[(math.floor(x/32),math.floor(y/32),bool(floors[tri.polygon_index].value))].extend(points)
    maximum_guide_error=0.
    for road in [*plan['rings'],*[r for s in plan['sites'] for r in s['movements']]]:
        assert len(guides[road['id']])==len(road['points'])
        maximum_guide_error=max(maximum_guide_error,max(math.dist(a,b) for a,b in zip(guides[road['id']],road['points'])))
    assert maximum_guide_error<.003,maximum_guide_error
    pool=[];lookup={}
    def indices(points):
        result=[]
        for p in points:
            if p not in lookup:lookup[p]=len(pool)//3;pool.extend(p)
            result.append(lookup[p])
        return result
    meshes={name:indices(points) for name,points in drawing.items()};surfaces=[]
    for key,points in physical.items():
        surfaces.append({'indices':indices(points),'groundSurface':key[-1],
                         'bounds':[min(p[0] for p in points),min(p[1] for p in points),max(p[0] for p in points),max(p[1] for p in points)]})
    print(json.dumps({'phase':'native-read','vertices':len(pool)//3,'surfaces':len(surfaces),'guideError':maximum_guide_error}),flush=True)
    patch,audit=finalize_packed_collision(refine_city_ground({'vertices':pool,'meshes':meshes,'surfaces':surfaces}))
    print(json.dumps({'phase':'collision-finalized','audit':audit}),flush=True)
    def retire(ids,offsets):
        selected=set(offsets)
        assert len(selected)==len(offsets) and all(0<=i<len(ids)//3 for i in selected)
        return [v for i in range(0,len(ids),3) if i//3 not in selected for v in ids[i:i+3]]
    for layer,packed in [('base',source['base']),('motorway',source['motorway']['fixed'])]:
        for material,offsets in edit['drawingRemove'][layer].items():packed['meshes'][material]=retire(packed['meshes'][material],offsets)
        kept=[]
        for i,surface in enumerate(packed['surfaces']):
            if str(i) in edit['collisionRemove'][layer]:
                ids=retire(surface['indices'],edit['collisionRemove'][layer][str(i)])
                if not ids:continue
                xs=[packed['vertices'][j*3] for j in ids];ys=[packed['vertices'][j*3+1] for j in ids]
                surface={**surface,'indices':ids,'bounds':[min(xs),min(ys),max(xs),max(ys)]}
            kept.append(surface)
        packed['surfaces']=kept
        previous=packed.pop('collisionFinalization',None)
        packed['junctionRetention']={'sourceBefore':edit['sourceSha256'],'previousFinalization':previous,
                                     'removedTriangles':sum(map(len,edit['collisionRemove'][layer].values()))}
    retired={r['index'] for r in edit['retiredStructures']}
    for r in edit['retiredStructures']:assert source['structures'][r['index']]==r['before']
    source['structures']=[b for i,b in enumerate(source['structures']) if i not in retired]
    packed=source['motorway']['fixed'];shift=len(packed['vertices'])//3
    packed['vertices'].extend(patch['vertices'])
    for material,ids in patch['meshes'].items():packed['meshes'].setdefault(material,[]).extend(i+shift for i in ids)
    packed['surfaces'].extend({**s,'indices':[i+shift for i in s['indices']]} for s in patch['surfaces'])
    packed['junctionPatchFinalization']=audit
    removed_lights=set(edit['retiredMotorwayLights'])
    source['motorway']['lights']=[v for i,v in enumerate(source['motorway']['lights']) if i not in removed_lights]
    source['palette'].update(edit['palette'])
    source['motorway']['junctions']={'plan':plan,'sourceBefore':edit['sourceSha256'],
                                   'nativeSha256':edit['nativeSha256'],'candidateSha256':edit['candidateSha256'],
                                   'retiredStructures':edit['retiredStructures'],'retiredMotorwayLights':edit['retiredMotorwayLights']}
    source['motorway']['counts'].update({'junctions':9,'junctionRamps':48,'motorwayRings':3,
                                       'fixedTriangles':sum(len(v)//3 for v in packed['meshes'].values()),
                                       'collisionTriangles':sum(len(s['indices'])//3 for s in packed['surfaces']),
                                       'surfaceGroups':len(packed['surfaces']),'lights':len(source['motorway']['lights'])})
    for site in plan['sites']:
        ramp=site['movements'][0]['points'];p=ramp[len(ramp)//2];shift=site['band']*math.tau*plan['radius']/3
        source['visits'][site['id']]={'band':site['band'],'position':[p[0]-shift,p[1]],
                                     'lookAt':[site['x']-shift,site['y']],'heightHint':p[2]}
    for tile in source['tiles']:
        original=ROOT/'public'/tile['url'].lstrip('/');target=output/'public'/tile['url'].lstrip('/')
        target.parent.mkdir(parents=True,exist_ok=True);target.hardlink_to(original)
    header=output/'src/worlds/generated/izmaColony.json';header.parent.mkdir(parents=True,exist_ok=True)
    saved=write_manifest(header,source)
    compiled=combine_profiles(candidate,saved['sourceSha256'])
    route_path=output/'assets/blender/izma-motorway-routes.json';route_path.parent.mkdir(parents=True,exist_ok=True)
    route_path.write_bytes(encoded(compiled))
    result={'origin':'ai','created':'2026-09-21','sourceBefore':edit['sourceSha256'],**saved,
            'nativeSha256':edit['nativeSha256'],'collisionAudit':audit,'guideMaximumError':maximum_guide_error,
            'collapsedNativeFaces':dropped,'counts':source['motorway']['counts'],
            'status':'Isolated full-source candidate; complete mesh/transport/lighting/LOD/XR acceptance pending. Canonical source unchanged.'}
    (output/'junction-export.json').write_text(json.dumps(result,indent=2)+'\n')
    return result


if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--integration-root',type=Path,required=True);p.add_argument('--candidate-root',type=Path,required=True)
    p.add_argument('--output-root',type=Path,required=True)
    a=p.parse_args(sys.argv[sys.argv.index('--')+1:]);print(json.dumps(export(a.integration_root,a.candidate_root,a.output_root)),flush=True)
