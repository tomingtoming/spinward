"""The authored block plan owns replacements; source scenes remain reusable."""
import hashlib,json
from pathlib import Path


def read_composition(assets=None):
    assets=Path(assets) if assets else Path(__file__).resolve().parent
    plan=json.loads((assets/'izma-block-parcels.json').read_text())
    for name,digest in plan['dependencies'].items():
        assert hashlib.sha256((assets/name).read_bytes()).hexdigest()==digest,('Replan complete blocks before exporting dependent layers',name)
    retired=[pid for b in plan['blocks'] for pid in b['retiredParcels']]
    assert len(retired)==len(set(retired)), 'A parcel cannot be retired by two blocks'
    plan['retiredParcelIds']=retired
    plan['planHash']=hashlib.sha256((assets/'izma-block-parcels.json').read_bytes()).hexdigest()
    return plan


def invalidate_blocks(manifest):
    manifest.pop('cityBlocks',None)
    manifest['tiles']=[t for t in manifest['tiles'] if not t.get('completeBlock')]
    manifest['visits']={k:v for k,v in manifest['visits'].items() if not k.startswith('block-')}
