"""Restore the reviewed sample from immutable asset URLs and verify every SHA256.

Does not query 'latest' or silently accept changed public data.
"""
import argparse
import hashlib
import gzip
import json
from pathlib import Path
from fetch_study import fetch
from fetch_band_sources import packed_fetch


def lock(root,target):
    imports=json.loads((root/'imports.json').read_text());survey=json.loads((root/'survey.json').read_text())
    record=dict(origin='ai',created='2026-09-22',purpose='Reviewed 3-city transfer study; no full-band coverage claim',
                versions=dict(pyproj='3.7.2',shapely='2.1.2',three='0.180.0',playwrightWebxr='0.3.0'),imports=imports,survey=survey)
    target.write_text(json.dumps(record,ensure_ascii=False,indent=2)+'\n')


def restore(root,source):
    record=json.loads(source.read_text());root.mkdir(parents=True,exist_ok=True);seen=set()
    for s in record['imports']['samples']:
        for f in [f for key in ['buildings','roads','land','dem','codelists'] for f in s[key]]:
            if f['url'] in seen:continue
            seen.add(f['url']);got=packed_fetch(root,f['url'],max(80_000_000,f['bytes']+1)) if f.get('compression')=='gzip' else fetch(root,f['url'],max(80_000_000,f['bytes']+1))
            assert got['sha256']==f['sha256'],f"Public asset changed: {f['url']}"
            assert got['bytes']==f['bytes']
            # Compression is a local storage choice. The original-byte checksum
            # is the source identity; record the restored representation too.
            f.update(got)
    (root/'imports.json').write_text(json.dumps(record['imports'],ensure_ascii=False,indent=2))
    (root/'survey.json').write_text(json.dumps(record['survey'],ensure_ascii=False,indent=2))
    print('Verified source assets:',len(seen))


def verify(root,source):
    record=json.loads(source.read_text());seen=set();total=0
    for sample in record['imports']['samples']:
        for f in [f for key in ['buildings','roads','land','dem','codelists'] for f in sample[key]]:
            if f['url'] in seen:continue
            seen.add(f['url']);path=root/f['path'];digest=hashlib.sha256();count=0
            with (gzip.open(path,'rb') if f.get('compression')=='gzip' else path.open('rb')) as stream:
                while block:=stream.read(1024*1024):digest.update(block);count+=len(block)
            assert count==f['bytes'] and digest.hexdigest()==f['sha256'],f['path']
            total+=count
    result=dict(passed=True,sourceFiles=len(seen),originalBytes=total,identity='Exact source SHA256 after decompression')
    (root/'source-verification.json').write_text(json.dumps(result,indent=2));print(json.dumps(result))


if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--root',required=True,type=Path)
    p.add_argument('--lock',type=Path,default=Path(__file__).with_name('study-lock.json'));p.add_argument('--write-lock',action='store_true')
    p.add_argument('--verify-only',action='store_true')
    a=p.parse_args();lock(a.root,a.lock) if a.write_lock else verify(a.root,a.lock) if a.verify_only else restore(a.root,a.lock)
