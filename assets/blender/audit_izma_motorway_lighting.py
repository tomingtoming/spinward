"""Check exported lights against their saved fixtures and actual supporting decks."""
import argparse
import hashlib
import json
import math
from pathlib import Path
import sys
import bpy
from mathutils.bvhtree import BVHTree

ASSETS=Path(__file__).resolve().parent
sys.path.insert(0,str(ASSETS))
from colony_manifest_io import encoded,read_manifest


def audit(source_root,integration):
    source=read_manifest(source_root/'src/worlds/generated/izmaColony.json')
    native=integration/'izma-motorway-integration.blend'
    report=json.loads(native.with_suffix('.json').read_text())
    assert source['motorway']['nativeSha256']==hashlib.sha256(native.read_bytes()).hexdigest()
    radius=source['radius'];vertices=[];emitter_vertices=[]
    def curved(p):
        x,y,h=p;a=x/radius
        return math.cos(a)*(radius-h),y,math.sin(a)*(radius-h)
    for packed in [source['base'],source['motorway']['fixed']]:
        for material,ids in packed['meshes'].items():
            if material not in ['arterial','expressway','walk','motorway-road','motorway-walk','motorway-lamp']:continue
            target=emitter_vertices if material=='motorway-lamp' else vertices
            target.extend(curved(packed['vertices'][i*3:i*3+3]) for i in ids)
    def tree(points):return BVHTree.FromPolygons(points,[tuple(range(i,i+3)) for i in range(0,len(points),3)],all_triangles=True)
    decks=tree(vertices);emitters=tree(emitter_vertices)
    bpy.ops.wm.open_mainfile(filepath=str(native));scene=bpy.data.scenes['SW_izma_motorway_integration'];scene.view_layers[0].update()
    lights=[o for o in scene.objects if o.type=='LIGHT'];exported=source['motorway']['lights']
    assert len(lights)==len(exported)==len(report['lights'])>1000
    assert len({r['ic'] for r in report['lights']})==18
    failures=[];maximum_foot_error=0.;maximum_source_error=0.
    for light,export in zip(lights,exported):
        p=light.matrix_world.translation;position=(-p.y,p.x,p.z)
        error=math.dist(position,export['position']);maximum_source_error=max(maximum_source_error,error)
        if error>1e-5:failures.append({'id':light.name,'kind':'source-transform','error':error})
        x,y,h=light['fixture_foot'];a=x/radius
        hit=decks.ray_cast(curved((x,y,h+.15)),(math.cos(a),0,math.sin(a)),.35)[0]
        if hit is None:failures.append({'id':light.name,'kind':'unsupported-fixture','foot':[x,y,h]})
        else:
            error=abs(h-(radius-math.hypot(hit.x,hit.z)));maximum_foot_error=max(maximum_foot_error,error)
            if error>.06:failures.append({'id':light.name,'kind':'fixture-floor-height','error':error})
        x,y,h=position;a=x/radius
        # The actual small emitting face must be just above the exported point light.
        hit=emitters.ray_cast(curved(position),(-math.cos(a),0,-math.sin(a)),.12)[0]
        if hit is None:failures.append({'id':light.name,'kind':'light-detached-from-housing','position':position})
        assert 0<export['intensity']<=360 and export['distance']<=44
    result={'origin':'ai','created':'2026-09-20','sourceSha256':hashlib.sha256(encoded(source)).hexdigest(),
            'nativeSha256':report['nativeSha256'],'lights':len(lights),'maximumFootHeightError':maximum_foot_error,
            'maximumSourceTransformError':maximum_source_error,'failures':failures,'failureCount':len(failures)}
    (source_root/'motorway-lighting-audit.json').write_text(json.dumps(result,indent=2)+'\n')
    print(json.dumps({k:v for k,v in result.items() if k!='failures'}),flush=True)
    if failures:raise ValueError('Motorway lights need native correction')


if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--source-root',type=Path,required=True)
    parser.add_argument('--integration-root',type=Path,required=True)
    args=parser.parse_args(sys.argv[sys.argv.index('--')+1:]);audit(args.source_root,args.integration_root)
