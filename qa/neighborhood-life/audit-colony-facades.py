"""Compare a facade revision with its retained complete pre-export source."""
import json, sys
from pathlib import Path
from collections import Counter

ROOT=Path(__file__).resolve().parents[2]
sys.path.insert(0,str(ROOT/'assets/blender'))
from colony_manifest_io import read_manifest

before_path=Path(sys.argv[1])
before=json.loads(before_path.read_text())
after=read_manifest(ROOT/'src/worlds/generated/izmaColony.json')
for key in before.keys() | after.keys():
    if key in ['tiles','architecture','neighbourhoods']:continue
    assert before[key]==after[key],('Unrelated colony data changed',key)
counts={}
for layer in ['architecture','neighbourhoods']:
    a,b=before[layer],after[layer]
    for key in a.keys() | b.keys():
        if key in ['counts','lights']:continue
        assert a[key]==b[key],('Site, ground or collision changed',layer,key)
    for key in a['counts']:
        if key not in ['nearTriangles','midTriangles']:assert a['counts'][key]==b['counts'][key],(layer,key)
    counts[layer]={'before':a['counts'],'after':b['counts']}
    if 'lights'in a:
        assert len(a['lights'])==len(b['lights'])
        for old,new in zip(a['lights'],b['lights']):
            assert old['position']==new['position'] and old['color']==new['color']
            assert new['intensity']==140 and new['distance']==28
for key in ['boxes','proxyParts']:
    assert Counter(tuple(p)for t in before['tiles']for p in t[key])==Counter(tuple(p)for t in after['tiles']for p in t[key]),('Distant geometry changed',key)
retained=0
for t in before['tiles']:
    if any(t.get(k)for k in ['publicRealm','railway','landUse']):
        assert t==next(q for q in after['tiles']if q['id']==t['id']),('Unrelated tile changed',t['id'])
        retained+=1
result={'counts':counts,'retainedOtherTiles':retained,'sitesGroundPhysicsFarProxiesUnchanged':True}
(before_path.parent/'geometry-preservation.json').write_text(json.dumps(result,indent=2)+'\n')
print(json.dumps(result))
