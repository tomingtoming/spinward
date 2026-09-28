"""Reject incomplete or mixed geographic datasets before changing the preview."""
import argparse
import gzip
import hashlib
import json
import sqlite3
import struct
from pathlib import Path

from PIL import Image
from plan_tokyo_metro import write
from prepare_metro_overview import tile_specs, validate_output_contract


def audit(root):
    read=lambda name:json.loads((root/name).read_text())
    plan=read('tokyo-metro-plan.json');out=root/'derived'
    assert read('source-integrity-audit.json')['passed']
    assert read('terrain-grid-audit.json')['complete']
    assert read('landmark-audit.json')['passed']
    validate_output_contract(out,plan)
    queue=read('acquisition-queue.json')['items'];compiled={}
    for file,table,kinds in [('metro-source.sqlite','tiles',{'building'}),('metro-surfaces.sqlite','files',{'tran','luse','wtr'})]:
        db=sqlite3.connect(f'file:{root/file}?mode=ro&immutable=1',uri=True)
        urls={r[0] for r in db.execute(f'SELECT url FROM {table}')};db.close()
        expected={q['url'] for q in queue if q['kind'] in kinds}
        assert urls==expected,(file,'missing compiled source URLs',len(expected-urls))
        compiled[table]=len(urls)
    overview=read('derived/metro-overview.json');assert overview['ready']
    assert overview['defaultRegion']==plan['defaultRegion']
    checked=set();textures=set();stored=0;decoded=0;bands=[]
    def check(descriptor):
        nonlocal stored,decoded
        path=descriptor['path']
        if path in checked:return
        file=out/path
        assert file.resolve().is_relative_to(out.resolve()),path
        compressed=file.read_bytes();raw=gzip.decompress(compressed)
        assert len(raw)==descriptor['decodedBytes'],path
        assert hashlib.sha256(raw).hexdigest()==descriptor['sha256'],path
        checked.add(path);stored+=len(compressed);decoded+=len(raw)
        if path.endswith('.bin.gz'):
            size=struct.unpack_from('<I',raw)[0];header=json.loads(raw[4:4+size])
            for mesh in header['meshes']:
                if mesh.get('texture'):textures.add(mesh['texture'])
        else:json.loads(raw)
    for band,sample in zip(plan['bands'],overview['samples'],strict=True):
        assert (band['id'],band['band'],band['frame'])==(sample['id'],sample['band'],sample['frame'])
        assert len(sample['overview'])==10
        for row in sample['overview']:check(row)
        expected={s['id'] for s in tile_specs(band)};count=0
        for suffix,entries in [('base','tiles'),('base','farTiles'),('walk','tiles'),('facades','sites')]:
            manifest=read(f'derived/{band["id"]}/{suffix}.json')
            actual=[r['id'] for r in manifest[entries]]
            assert len(actual)==len(expected) and set(actual)==expected,(band['id'],suffix,entries)
            for row in manifest[entries]:check(row)
        for id_ in expected:
            record=read(f'derived/{band["id"]}/tiles/{id_}.json');count+=record['buildings']
        bands.append(dict(id=band['id'],tiles=len(expected),renderedBuildingParts=count))
        print('verified',band['id'],len(expected),'tiles',flush=True)
    for texture in textures:
        with Image.open(out/texture) as image:image.verify()
    report=dict(passed=True,bands=bands,compiledSourceURLs=compiled,compressedFiles=len(checked),textures=len(textures),
                storedBytes=stored,decodedBytes=decoded,scope='All generated tiles, textures, source URL completion and geographic consistency; browser acceptance is separate')
    write(root/'release-data-audit.json',report);return report


if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--root',type=Path,required=True)
    print(json.dumps(audit(parser.parse_args().root.resolve()),ensure_ascii=False,indent=2))
