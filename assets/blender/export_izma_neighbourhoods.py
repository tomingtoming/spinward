"""Export the saved infill scene; preserve original buildings and public spaces."""
import json, hashlib, math, sys
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parent))
from izma_block_composition import read_composition
from izma_collision_mesh import simplify_collision_candidates
ROOT=Path(__file__).resolve().parents[2]
contract=json.loads((ROOT/'assets/blender/izma-neighbourhood-parcels.json').read_text())
composition=read_composition()
for name,digest in contract['dependencies'].items():
    assert hashlib.sha256((ROOT/'assets/blender'/name).read_bytes()).hexdigest()==digest,('Rebuild infill after changed reservation',name)
source=ROOT/'assets/blender/export_izma_districts.py'
library={'__file__':str(source),'_DISTRICTS_LIBRARY':True}
exec(compile(source.read_text(),str(source),'exec'),library)
# The original 256 m ground compounds become expensive beneath dense blocks.
# Repartition only costly surfaces; keep their actual triangles and drawing.
partition_source=ROOT/'assets/blender/colony_collision_partition.py'
partition={}
exec(compile(partition_source.read_text(),str(partition_source),'exec'),partition)
def compose_surfaces(surfaces):
    result=partition['merge_adjacent_frontages'](surfaces,contract['parcels'])
    bounds=[[min(p[0] for p in b['boundary'])-32,min(p[1] for p in b['boundary'])-32,
             max(p[0] for p in b['boundary'])+32,max(p[1] for p in b['boundary'])+32] for b in composition['blocks']]
    removed=0;maximum_error=0
    for key,points in list(result.items()):
        box=[min(p[0] for p in points),min(p[1] for p in points),max(p[0] for p in points),max(p[1] for p in points)]
        if not any(box[0]<b[2] and box[2]>b[0] and box[1]<b[3] and box[3]>b[1] for b in bounds):continue
        reduced,error=simplify_collision_candidates(points)
        removed+=(len(points)-len(reduced))//3;maximum_error=max(maximum_error,error);result[key]=reduced
    print(json.dumps({'blockNeighbourCollisionTrianglesRemoved':removed,'maximumSampledError':maximum_error}),flush=True)
    return result
visits={}
for n in contract['neighbourhoods']:
    p=next(p for p in contract['parcels']if p['id']==n['parcels'][0])
    a=p['access']['start'];b=p['access']['end'];offset=p['band']*math.tau*3200/3
    visits['neighbourhood-'+n['id']]={'band':p['band'],'position':[a[0]-offset,a[1]],
        'lookAt':[b[0]-offset,b[1]],'heightHint':a[2]+.3}
result=library['export']({'layer':'neighbourhoods','contract':'izma-neighbourhood-parcels.json',
    'omitParcelIds':composition['retiredParcelIds'],'compositionHash':composition['planHash'],
    'appearanceOnly':globals().get('_APPEARANCE_ONLY',False),
    'scene':'SW_izma_neighbourhoods','owner':'spinward-izma-neighbourhoods-v1',
    'evidence':'qa/webxr/evidence/colony-urban-20260918','visits':visits,
    'baseTransform':partition['refine_colony_base'],
    'surfaceTransform':compose_surfaces,
    'lightSources':True})
