"""Export a saved IC replacement patch into an isolated full-colony source."""
import argparse
from collections import defaultdict
import hashlib
import json
import math
from pathlib import Path
import sys
import bpy

ASSETS=Path(__file__).resolve().parent;ROOT=ASSETS.parents[1]
sys.path.insert(0,str(ASSETS))
from colony_manifest_io import encoded,read_manifest,write_manifest
from colony_collision_partition import refine_city_ground
from izma_collision_mesh import finalize_packed_collision
from izma_motorway_replacement import face_area
from plan_izma_motorway_routes import resolve


def export(integration,candidate,output,source_header=None):
    if any(not p.is_absolute() for p in [integration,candidate,output]) or output.resolve()==ROOT or output.exists():
        raise ValueError('Use absolute inputs and a fresh isolated export directory')
    native=integration/'izma-motorway-integration.blend';edit=json.loads(native.with_suffix('.json').read_text())
    assert hashlib.sha256(native.read_bytes()).hexdigest()==edit['nativeSha256']
    plan_path=candidate/'assets/blender/izma-motorway-plan.json';plan=json.loads(plan_path.read_text())
    assert hashlib.sha256(plan_path.read_bytes()).hexdigest()==edit['planSha256']
    # Explicitly allow the preserved pre-replacement source after installation.
    # Reapplying retirement offsets to an already modified base is invalid.
    source_header=source_header or ROOT/'src/worlds/generated/izmaColony.json'
    assert source_header.is_absolute()
    source=read_manifest(source_header)
    assert hashlib.sha256(encoded(source)).hexdigest()==edit['sourceSha256']
    bpy.ops.wm.open_mainfile(filepath=str(native));scene=bpy.data.scenes['SW_izma_motorway_integration']
    assert scene['owner']==edit['owner'] and scene['sourceSha256']==edit['sourceSha256']
    scene.view_layers[0].update();groups=defaultdict(list);physical=defaultdict(list);lights=[]
    dropped={'faces':0,'area':0.}
    for obj in scene.objects:
        assert obj['owner']==edit['owner']
        if obj.type=='LIGHT':
            p=obj.matrix_world.translation
            lights.append({'position':[-p.y,p.x,p.z],'color':obj['color'],
                           'intensity':obj['intensity'],'distance':obj['distance']})
            continue
        assert obj.type=='MESH'
        mesh=obj.data;mesh.calc_loop_triangles();vertices=[]
        for vertex in mesh.vertices:
            p=obj.matrix_world@vertex.co;vertices.append(tuple(round(v,5) for v in [-p.y,p.x,p.z]))
        flags=mesh.attributes['physical'].data;floor=mesh.attributes['ground_surface'].data
        for triangle in mesh.loop_triangles:
            points=[vertices[i] for i in triangle.vertices]
            if face_area(points)<1e-8:
                dropped['faces']+=1;dropped['area']+=face_area(points);continue
            material=mesh.materials[triangle.material_index]['spinward_material']
            if obj['drawing']:groups[material].extend(points)
            if flags[triangle.polygon_index].value:
                x,y=[sum(p[k] for p in points)/3 for k in [0,1]]
                physical[(math.floor(x/32),math.floor(y/32),bool(floor[triangle.polygon_index].value))].extend(points)
    pool=[];lookup={}
    def indices(points):
        result=[]
        for p in points:
            if p not in lookup:lookup[p]=len(pool)//3;pool.extend(p)
            result.append(lookup[p])
        return result
    meshes={name:indices(points) for name,points in groups.items()};surfaces=[]
    for key,points in physical.items():
        surfaces.append({'indices':indices(points),'groundSurface':key[-1],
                         'bounds':[min(p[0] for p in points),min(p[1] for p in points),max(p[0] for p in points),max(p[1] for p in points)]})
    packed,audit=finalize_packed_collision(refine_city_ground({'vertices':pool,'meshes':meshes,'surfaces':surfaces}))
    print(json.dumps({'phase':'native collision exported','audit':audit,'surfaces':len(packed['surfaces'])}),flush=True)
    def retire(ids,offsets):
        selected=set(offsets)
        assert len(selected)==len(offsets) and all(0<=i<len(ids)//3 for i in selected)
        return [v for i in range(0,len(ids),3) if i//3 not in selected for v in ids[i:i+3]]
    base=source['base']
    for material,offsets in edit['drawingRemove'].items():
        base['meshes'][material]=retire(base['meshes'][material],offsets)
    retained=[]
    for index,surface in enumerate(base['surfaces']):
        if str(index) in edit['collisionRemove']:
            ids=retire(surface['indices'],edit['collisionRemove'][str(index)])
            if not ids:continue
            xs=[base['vertices'][i*3] for i in ids];ys=[base['vertices'][i*3+1] for i in ids]
            surface={**surface,'indices':ids,'bounds':[min(xs),min(ys),max(xs),max(ys)]}
        retained.append(surface)
    base['surfaces']=retained
    # Retained triangles keep their exact coordinates and are not simplified
    # again. Only the newly exported native patch passes the 5 mm finalizer.
    old_finalization=base.pop('collisionFinalization',None)
    base['collisionRetention']={'sourceSha256':edit['sourceSha256'],
                                'previousFinalization':old_finalization,
                                'removedTriangles':sum(map(len,edit['collisionRemove'].values()))}
    for item in edit['relocatedStructures']:
        assert source['structures'][item['index']]==item['before']
        source['structures'][item['index']]=item['after']
    source['palette'].update(edit['palette'])
    source.setdefault('materialDetails',{})['motorway-lamp']={'emission':{'color':'#ffe5b9','intensity':.22}}
    counts={'interchanges':len(plan['interchanges']),'ramps':sum(len(i['roads'])-1 for i in plan['interchanges']),
            'fixedTriangles':sum(len(v)//3 for v in meshes.values()),
            'collisionTriangles':sum(len(s['indices'])//3 for s in packed['surfaces']),
            'surfaceGroups':len(packed['surfaces']),'relocatedSupports':len(edit['relocatedStructures']),'lights':len(lights)}
    source['motorway']={'version':1,'fixed':packed,'lights':lights,'counts':counts,'nativeSha256':edit['nativeSha256'],
                        'sourceBefore':edit['sourceSha256'],'planSha256':edit['planSha256'],
                        'interchanges':plan['interchanges'],'relocatedStructures':edit['relocatedStructures'],
                        'convertedCrossings':edit.get('convertedCrossings',[])}
    if 'riverConnection' in edit:
        source['motorway']['riverConnection']=edit['riverConnection']
    for ic in plan['interchanges']:
        node=ic['node'];band=ic['band'];shift=band*math.tau*source['radius']/3
        point=min(ic['roads'][0]['points'],key=lambda p:abs(math.dist(p[:2],node)-80))
        source['visits'][ic['id']]={'band':band,'position':[point[0]-shift,point[1]],
                                   'lookAt':[node[0]-shift,node[1]],'heightHint':point[2]}
    for tile in source['tiles']:
        original=source_header.parents[3]/'public'/tile['url'].lstrip('/');target=output/'public'/tile['url'].lstrip('/')
        target.parent.mkdir(parents=True,exist_ok=True);target.hardlink_to(original)
    header=output/'src/worlds/generated/izmaColony.json';header.parent.mkdir(parents=True,exist_ok=True)
    saved=write_manifest(header,source)
    # Keep the compiled route graph beside its exact source. It is authoring
    # data until traffic integration; the runtime package does not download it.
    routes=resolve(plan,json.loads((ASSETS/'izma-transport.json').read_text()),
                   json.loads((ASSETS/'izma-colony-plan.json').read_text()),edit.get('riverConnection'))
    routes['sourceSha256']=saved['sourceSha256']
    routes['dependencies']={p.name:hashlib.sha256(p.read_bytes()).hexdigest()
                            for p in [plan_path,ASSETS/'izma-transport.json',ASSETS/'izma-colony-plan.json']}
    route_path=output/'assets/blender/izma-motorway-routes.json'
    route_path.parent.mkdir(parents=True,exist_ok=True);route_path.write_bytes(encoded(routes))
    evidence={'origin':'ai','created':'2026-09-20','sourceBefore':edit['sourceSha256'],**saved,
              'counts':counts,'collisionAudit':audit,'collapsedExportFaces':dropped,
              'retiredDrawingTriangles':sum(map(len,edit['drawingRemove'].values())),
              'retiredCollisionTriangles':sum(map(len,edit['collisionRemove'].values())),
              'status':'Staged full source only; combined geometry, routes, regional and XR acceptance pending'}
    (output/'motorway-export.json').write_text(json.dumps(evidence,indent=2)+'\n');print(json.dumps(evidence),flush=True)


if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--integration-root',type=Path,required=True)
    parser.add_argument('--candidate-root',type=Path,required=True);parser.add_argument('--output-root',type=Path,required=True)
    parser.add_argument('--source-header',type=Path,help='Preserved pre-replacement source header; offsets are hash-checked')
    args=parser.parse_args(sys.argv[sys.argv.index('--')+1:]);export(args.integration_root,args.candidate_root,args.output_root,args.source_header)
