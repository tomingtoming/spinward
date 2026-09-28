"""Verify compressed cache bytes AND the original public-source SHA-256."""
import argparse
import concurrent.futures
import hashlib
import json
import zlib
from pathlib import Path
from plan_tokyo_metro import write, receipt_paths


def verify(root,receipt):
    stored=hashlib.sha256();original=hashlib.sha256();stored_size=0;original_size=0
    decoder=zlib.decompressobj(16+zlib.MAX_WBITS) if receipt.get('compression')=='gzip' else None
    with (root/receipt['path']).open('rb') as stream:
        while chunk:=stream.read(1024*1024):
            stored.update(chunk);stored_size+=len(chunk)
            data=decoder.decompress(chunk) if decoder else chunk
            original.update(data);original_size+=len(data)
    if decoder:
        data=decoder.flush();original.update(data);original_size+=len(data)
        assert decoder.eof and not decoder.unused_data,'Invalid gzip stream'
    assert stored_size==receipt.get('storedBytes',receipt['bytes'])
    assert stored.hexdigest()==receipt.get('storedSha256',receipt['sha256']),receipt['path']
    assert original_size==receipt['bytes'] and original.hexdigest()==receipt['sha256'],receipt['url']
    return original_size,stored_size


def main():
    parser=argparse.ArgumentParser();parser.add_argument('--root',type=Path,required=True)
    args=parser.parse_args();root=args.root.resolve();files={};urls={};errors=[]
    queue=json.loads((root/'acquisition-queue.json').read_text())['items']
    for path in receipt_paths(root):
        receipt=json.loads(path.read_text());urls[receipt['url']]=receipt
        if receipt['status']!='acquired':continue
        prior=files.setdefault(receipt['path'],receipt)
        assert prior['sha256']==receipt['sha256'] and prior.get('storedSha256')==receipt.get('storedSha256')
    sizes=[]
    with concurrent.futures.ThreadPoolExecutor(max_workers=3) as pool:
        futures={pool.submit(verify,root,r):r for r in files.values()}
        for future in concurrent.futures.as_completed(futures):
            try:sizes.append(future.result())
            except Exception as error:errors.append(dict(path=futures[future]['path'],error=str(error)))
    missing=[item['url'] for item in queue if item['url'] not in urls or urls[item['url']]['status']!='acquired']
    report=dict(passed=not errors and not missing,requestedURLs=len(queue),receipts=len(urls),uniqueFiles=len(files),
        verifiedOriginalBytes=sum(s[0] for s in sizes),verifiedStoredBytes=sum(s[1] for s in sizes),missing=missing,errors=errors,
        interpretation='Source byte integrity only, separate from geometry, land coverage and runtime acceptance')
    write(root/'source-integrity-audit.json',report);print(json.dumps(report,ensure_ascii=False),flush=True)
    if not report['passed']:raise RuntimeError('Source integrity audit failed')


if __name__=='__main__':main()
