"""Prove the IC patch retained unrelated colony data and exact old vertices."""
import argparse
import hashlib
import json
from pathlib import Path
import sys

ASSETS=Path(__file__).resolve().parent;ROOT=ASSETS.parents[1]
sys.path.insert(0,str(ASSETS))
from colony_manifest_io import encoded,read_manifest


def audit(source_root,integration):
    before=read_manifest(ROOT/'src/worlds/generated/izmaColony.json')
    after=read_manifest(source_root/'src/worlds/generated/izmaColony.json')
    edit=json.loads((integration/'izma-motorway-integration.json').read_text())
    assert hashlib.sha256(encoded(before)).hexdigest()==edit['sourceSha256']
    changed={'base','structures','palette','visits','motorway','materialDetails'};preserved=[]
    assert set(after)==set(before)|{'motorway'}
    for key in before:
        if key not in changed:
            assert before[key]==after[key],('Unrelated layer changed',key)
            preserved.append(key)
    assert before['base']['vertices']==after['base']['vertices']
    assert set(before['base']['meshes'])==set(after['base']['meshes'])
    kept_materials=[]
    for material,ids in before['base']['meshes'].items():
        removed=set(edit['drawingRemove'].get(material,[]))
        expected=[v for offset in range(0,len(ids),3) if offset//3 not in removed for v in ids[offset:offset+3]]
        assert after['base']['meshes'][material]==expected,material
        if not removed:kept_materials.append(material)
    after_index=0
    for index,surface in enumerate(before['base']['surfaces']):
        removed=set(edit['collisionRemove'].get(str(index),[]));ids=surface['indices']
        expected=[v for offset in range(0,len(ids),3) if offset//3 not in removed for v in ids[offset:offset+3]]
        if not expected:continue
        actual=after['base']['surfaces'][after_index];after_index+=1
        assert expected==actual['indices']
        assert actual.get('groundSurface',True)==surface.get('groundSurface',True)
        if not removed:assert surface==actual
    assert after_index==len(after['base']['surfaces'])
    relocated={p['index']:p for p in edit['relocatedStructures']}
    assert len(before['structures'])==len(after['structures'])
    for index,(old,new) in enumerate(zip(before['structures'],after['structures'])):
        assert new==(relocated[index]['after'] if index in relocated else old)
    for key,value in before['palette'].items():assert after['palette'][key]==value
    assert set(after['materialDetails'])==set(before['materialDetails'])|{'motorway-lamp'}
    for key,value in before['materialDetails'].items():assert after['materialDetails'][key]==value
    for key,value in before['visits'].items():assert after['visits'][key]==value
    result={'origin':'ai','created':'2026-09-20','sourceBefore':edit['sourceSha256'],
            'sourceSha256':hashlib.sha256(encoded(after)).hexdigest(),'preservedLayers':preserved,
            'preservedBaseMaterials':kept_materials,'exactBaseVertices':len(before['base']['vertices'])//3,
            'exactRetainedCollisionSurfaces':after_index,'relocatedBoxes':list(relocated),'passed':True}
    (source_root/'motorway-preservation-audit.json').write_text(json.dumps(result,indent=2)+'\n')
    print(json.dumps(result),flush=True)


if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--source-root',type=Path,required=True)
    parser.add_argument('--integration-root',type=Path,required=True)
    args=parser.parse_args();audit(args.source_root,args.integration_root)
