"""Export saved end bridges into a staged full-colony package."""
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
from izma_street_frontages import triangle_altitude


def export(candidate,output):
    if any(not p.is_absolute() or p.resolve()==ROOT for p in [candidate,output]):
        raise ValueError('Use separate absolute candidate and output roots')
    native=candidate/'assets/blender/izma-interband.blend'
    report=json.loads(native.with_suffix('.json').read_text())
    plan_path=native.with_name('izma-interband-plan.json');plan=json.loads(plan_path.read_text())
    assert hashlib.sha256(native.read_bytes()).hexdigest()==report['nativeSha256']
    assert hashlib.sha256(plan_path.read_bytes()).hexdigest()==report['planSha256']
    bpy.ops.wm.open_mainfile(filepath=str(native));scene=bpy.data.scenes['SW_izma_interband']
    assert scene['planSha256']==report['planSha256'] and scene['owner']==report['owner']
    scene.view_layers[0].update()
    manifest=read_manifest(ROOT/'src/worlds/generated/izmaColony.json')
    source_before=hashlib.sha256(encoded(manifest)).hexdigest()
    assert source_before==plan['sourceSha256'], 'Replan against the current canonical colony'
    for name,h in plan['dependencies'].items():assert hashlib.sha256((ASSETS/name).read_bytes()).hexdigest()==h
    groups,physical=defaultdict(list),defaultdict(list);lights=[]
    for obj in scene.objects:
        assert obj['owner']==report['owner'] and obj.library is None
        if obj.type=='LIGHT':
            p=obj.matrix_world.translation
            lights.append({'position':[-p.y,p.x,p.z],'color':obj['color'],
                           'intensity':obj['intensity'],'distance':obj['distance']})
            continue
        assert obj.type=='MESH' and obj.data.library is None
        mesh=obj.data;mesh.calc_loop_triangles();vertices=[]
        for vertex in mesh.vertices:
            p=obj.matrix_world @ vertex.co;vertices.append(tuple(round(v,5) for v in [-p.y,p.x,p.z]))
        flags=mesh.attributes['physical'];floor=mesh.attributes['ground_surface']
        for tri in mesh.loop_triangles:
            points=[vertices[i] for i in tri.vertices]
            if triangle_altitude(points)<=1e-6:raise ValueError(('Degenerate bridge triangle',obj.name,tri.index))
            material=mesh.materials[tri.material_index]['spinward_material'];groups[material].extend(points)
            if flags.data[tri.polygon_index].value:
                x,y=[sum(p[k] for p in points)/3 for k in [0,1]]
                key=(math.floor(x/32),math.floor(y/32),bool(floor.data[tri.polygon_index].value))
                physical[key].extend(points)
    pool=[];lookup={}
    def indices(points):
        result=[]
        for p in points:
            if p not in lookup:lookup[p]=len(pool)//3;pool.extend(p)
            result.append(lookup[p])
        return result
    meshes={name:indices(points) for name,points in groups.items()}
    surfaces=[]
    for key,points in physical.items():
        surfaces.append({'indices':indices(points),'groundSurface':key[-1],
                         'bounds':[min(p[0] for p in points),min(p[1] for p in points),
                                   max(p[0] for p in points),max(p[1] for p in points)]})
    packed,audit=finalize_packed_collision(refine_city_ground({'vertices':pool,'meshes':meshes,'surfaces':surfaces}))
    counts={'rings':len(plan['rings']),'approaches':len(plan['approaches']),
            'fixedTriangles':sum(len(v)//3 for v in meshes.values()),
            'collisionTriangles':sum(len(s['indices'])//3 for s in packed['surfaces']),
            'supports':report['supports'],'lights':len(lights),'surfaceGroups':len(packed['surfaces'])}
    for name,color in report['materials'].items():manifest['palette']['interband-'+name]=color
    manifest.setdefault('materialDetails',{})['interband-lamp']={'emission':{'color':'#ffe5b9','intensity':.22}}
    manifest['interband']={'version':1,'fixed':packed,'lights':lights,'counts':counts,
                          'nativeSha256':report['nativeSha256'],'planSha256':report['planSha256'],
                          'rings':plan['rings'],'approaches':plan['approaches']}
    for gate in plan['approaches']:
        x,y,h=gate['profile'][3];band=gate['band'];localx=x-band*math.tau*plan['radius']/3
        manifest['visits'][gate['id']]={'band':band,'position':[localx,y],
                                      'lookAt':[localx,gate['profile'][-1][1]],'heightHint':h}
    for tile in manifest['tiles']:
        origin=ROOT/'public'/tile['url'].lstrip('/');target=output/'public'/tile['url'].lstrip('/')
        target.parent.mkdir(parents=True,exist_ok=True)
        if target.exists():assert target.read_bytes()==origin.read_bytes()
        else:target.hardlink_to(origin)
    header=output/'src/worlds/generated/izmaColony.json';header.parent.mkdir(parents=True,exist_ok=True)
    result=write_manifest(header,manifest)
    evidence={'origin':'ai','created':'2026-09-20','sourceBefore':source_before,**result,
              'counts':counts,'collisionAudit':audit,'status':'staged end bridges; geometry/regional/live traversal checks pending'}
    (output/'interband-export.json').write_text(json.dumps(evidence,indent=2)+'\n');print(json.dumps(evidence),flush=True)


if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--candidate-root',type=Path,required=True)
    parser.add_argument('--output-root',type=Path,required=True)
    args=parser.parse_args(sys.argv[sys.argv.index('--')+1:]);export(args.candidate_root,args.output_root)
