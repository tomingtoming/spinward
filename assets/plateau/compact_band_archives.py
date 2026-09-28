"""Losslessly compact only this increment's new, unshared b3dm source archives.

Restore and verify each original source hash before unlinking its plain copy.
Existing P1/P2/P3 hard links are deliberately excluded. Safe to resume.
"""
import argparse,gzip,hashlib,json
from pathlib import Path


def main(root):
    file=root/'imports.json';imports=json.loads(file.read_text());changed={};before=after=0
    for sample in imports['samples']:
        for record in sample['buildings']:
            source=root/record['path']
            if source.suffix!='.b3dm' or source.stat().st_nlink!=1:continue
            raw=source.read_bytes();assert hashlib.sha256(raw).hexdigest()==record['sha256']
            packed=gzip.compress(raw,compresslevel=6,mtime=0);dest=source.with_suffix('.b3dm.gz')
            temp=dest.with_suffix('.gz.next');temp.write_bytes(packed);temp.replace(dest)
            # Perform a real decompression of the on-disk archive, not of the in-memory buffer.
            restored=gzip.open(dest,'rb').read();assert len(restored)==record['bytes'] and hashlib.sha256(restored).hexdigest()==record['sha256']
            change=dict(path=str(dest.relative_to(root)),compression='gzip',storedBytes=len(packed),storedSha256=hashlib.sha256(packed).hexdigest())
            changed[record['url']]=change;record.update(change);before+=len(raw);after+=len(packed)
            dest.with_suffix('.gz.receipt.json').write_text(json.dumps(record))
    # Persist both references first. A crash before cleanup merely leaves an extra copy.
    file.write_text(json.dumps(imports,ensure_ascii=False,indent=2))
    lockpath=root/'source-lock.json';lock=json.loads(lockpath.read_text());lock['imports']=imports;lockpath.write_text(json.dumps(lock,ensure_ascii=False,indent=2))
    for change in changed.values():
        plain=(root/change['path']).with_suffix('')
        assert plain.stat().st_nlink==1
        plain.unlink()
    result=dict(origin='ai',created='2026-09-23',files=len(changed),originalBytes=before,storedBytes=after,restoration='all bytes decompressed from disk and SHA256 matched before deleting only unshared new originals')
    (root/'archive-compaction.json').write_text(json.dumps(result,indent=2));print(json.dumps(result))


if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--root',type=Path,required=True);main(p.parse_args().root)
