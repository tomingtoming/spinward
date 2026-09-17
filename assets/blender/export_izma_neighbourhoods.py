"""Export the saved infill scene; preserve original buildings and public spaces."""
import json, hashlib, math
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2]
contract=json.loads((ROOT/'assets/blender/izma-neighbourhood-parcels.json').read_text())
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
visits={}
for n in contract['neighbourhoods']:
    p=next(p for p in contract['parcels']if p['id']==n['parcels'][0])
    a=p['access']['start'];b=p['access']['end'];offset=p['band']*math.tau*3200/3
    visits['neighbourhood-'+n['id']]={'band':p['band'],'position':[a[0]-offset,a[1]],
        'lookAt':[b[0]-offset,b[1]],'heightHint':a[2]+.3}
result=library['export']({'layer':'neighbourhoods','contract':'izma-neighbourhood-parcels.json',
    'scene':'SW_izma_neighbourhoods','owner':'spinward-izma-neighbourhoods-v1',
    'evidence':'qa/webxr/evidence/colony-neighbourhoods-20260918','visits':visits,
    'baseTransform':partition['refine_colony_base'],'lightSources':True})
