"""Share independently verified duplicate bytes inside this task's source cache.

Only new evidence/raw paths are unlinked, after all receipts point at an
identical SHA-verified representation. Old P4 source paths are never changed.
"""
import argparse
import hashlib
import json
from pathlib import Path
from plan_tokyo_metro import write, receipt_paths

STORAGE_FIELDS=['path','compression','storedBytes','storedSha256','reusedFrom']


def verify(root,record):
    path=root/record['path'];digest=hashlib.sha256()
    with path.open('rb') as stream:
        while block:=stream.read(1024*1024):digest.update(block)
    assert digest.hexdigest()==record.get('storedSha256',record['sha256']),str(path)


def shared_record(record,canonical):
    assert record['sha256']==canonical['sha256'] and record['bytes']==canonical['bytes']
    return {**{k:v for k,v in record.items() if k not in STORAGE_FIELDS},
            **{k:canonical[k] for k in STORAGE_FIELDS if k in canonical},'sharesVerifiedBytesWith':canonical['url']}


def safe_unlink(root,relative):
    path=root/relative
    assert path.parent.resolve()==(root/'raw').resolve(),'Outside this task source cache'
    path.unlink(missing_ok=True)
    # This is the fetcher's obsolete cached receipt, not the authoritative URL receipt.
    path.with_suffix(path.suffix+'.receipt.json').unlink(missing_ok=True)


def compact(root):
    groups={};rewritten=0;unlinked=set();before=0
    for path in receipt_paths(root):
        row=json.loads(path.read_text())
        if row['status']=='acquired':groups.setdefault(row['sha256'],[]).append((path,row))
    for rows in groups.values():
        if len({r['path'] for _,r in rows})<2:continue
        # Prefer a hardlink to retained P4 data, then the smallest cached encoding.
        _,canonical=min(rows,key=lambda item:(not bool(item[1].get('reusedFrom')),item[1].get('storedBytes',item[1]['bytes'])))
        verified=set()
        for _,row in rows:
            if row['path'] not in verified:verify(root,row);verified.add(row['path'])
        obsolete=set()
        for path,row in rows:
            if row['path']==canonical['path']:continue
            write(path,shared_record(row,canonical));rewritten+=1;obsolete.add(row['path'])
        # Only unlink after every reference has moved to the verified survivor.
        for relative in obsolete:
            file=root/relative
            if file.stat().st_nlink==1:before+=file.stat().st_size
            safe_unlink(root,relative);unlinked.add(relative)
    report=dict(rewrittenReceipts=rewritten,unlinkedCachePaths=len(unlinked),uniqueBytesReleased=before,
                strategy='Original SHA-256 and stored hashes verified; old source hardlinks untouched')
    write(root/'source-compaction-audit.json',report);return report


if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--root',type=Path,required=True)
    print(json.dumps(compact(parser.parse_args().root.resolve()),indent=2))
