"""Resumable, deduplicated acquisition; source receipts are not coverage approval.

Existing P4 bytes are read-only hardlinks. New sources are gzip streams with
original/stored hashes. Per-file receipts survive interruption; no archive is
expanded. A reserved budget remains for derived geometry and the running app.
"""
import argparse
import concurrent.futures
import hashlib
import itertools
import json
import math
import os
import shutil
import threading
from pathlib import Path
from urllib.parse import urlparse

import fetch_band_sources
from fetch_study import tile_xy
from plan_tokyo_metro import write, reuse_file, receipt_paths
from compact_metro_sources import verify, shared_record, safe_unlink

RESERVE = 3_500_000_000


def acquisition_queue(plan):
    tasks = {}
    def add(url, kind, band, **metadata):
        entry = tasks.setdefault(url, dict(url=url,kind=kind,bands=[],**metadata))
        assert entry['kind'] == kind
        if band not in entry['bands']:entry['bands'].append(band)
    # Interleave the bands so bounded trial batches exercise every band.
    city_groups = [b['cities'] for b in plan['bands']]
    for rows in itertools.zip_longest(*city_groups):
        for band,city in zip(plan['bands'],rows):
            if city is None:continue
            for item in city['buildings']:
                add(item['url'],'building',band['id'],cityCode=city['cityCode'],contentFormat=item['contentFormat'])
            for kind,items in city['files'].items():
                for item in items:add(item['url'],kind,band['id'],cityCode=city.get('surfaceCityCode',city['cityCode']),declaredBytes=item.get('fileSize'))
            for url in city['metadataZipUrls']:
                if url.endswith('_codelists.zip'):add(url,'codelist',band['id'],cityCode=city.get('surfaceCityCode',city['cityCode']))
    for band in plan['bands']:
        b=band['bbox'];start=tile_xy(b[0],b[3],14);end=tile_xy(b[2],b[1],14)
        for layer in ['dem5a','dem']:
            for x in range(math.floor(start[0])-1,math.floor(end[0])+2):
                for y in range(math.floor(start[1])-1,math.floor(end[1])+2):
                    add(f'https://cyberjapandata.gsi.go.jp/xyz/{layer}/14/{x}/{y}.txt','dem',band['id'],layer=layer,z=14,x=x,y=y)
    return list(tasks.values())


def old_receipts(source):
    if (source/'receipts').is_dir():
        rows=[json.loads(p.read_text()) for p in receipt_paths(source)]
        return {r['url']:r for r in rows if r['status']=='acquired'}
    imports=json.loads((source/'imports.json').read_text())
    return {f['url']:f for s in imports['samples'] for k in ['buildings','roads','land','dem','codelists'] for f in s[k]}


def link_existing(root, source, receipt):
    old=source/receipt['path'];target=root/receipt['path']
    expected=receipt.get('storedBytes',receipt['bytes'])
    assert old.stat().st_size==expected, 'Changed previous source '+str(old)
    target.parent.mkdir(parents=True,exist_ok=True)
    if not target.exists():reuse_file(old,target)
    if not os.path.samefile(old,target):
        digest=hashlib.sha256()
        with target.open('rb') as stream:
            while block:=stream.read(1024*1024):digest.update(block)
        assert target.stat().st_size==expected and digest.hexdigest()==receipt.get('storedSha256',receipt['sha256']), 'Conflicting source path '+str(target)
    fields=['url','path','bytes','sha256','compression','storedBytes','storedSha256']
    return {**{k:receipt[k] for k in fields if k in receipt},'reusedFrom':str(old.resolve())}


class BlobCache:
    def __init__(self,root):
        self.root=root;self.by_hash={};self.verified=set();self.lock=threading.Lock()
        for path in receipt_paths(root):
            row=json.loads(path.read_text())
            if row['status']=='acquired':self.by_hash.setdefault(row['sha256'],row)

    def save(self,receipt_path,result):
        with self.lock:
            original=result.get('path');canonical=self.by_hash.get(result.get('sha256'))
            if canonical and original!=canonical['path']:
                if canonical['path'] not in self.verified:
                    verify(self.root,canonical);self.verified.add(canonical['path'])
                result=shared_record(result,canonical)
            elif result['status']=='acquired':self.by_hash[result['sha256']]=result
            write(receipt_path,result)
            if original and result['path']!=original:safe_unlink(self.root,original)
        return result


def fetch_one(root,source,item,previous,cache):
    url=item['url'];key=hashlib.sha256(url.encode()).hexdigest()[:24]
    receipt_path=root/'receipts'/(key+'.json')
    if receipt_path.exists():
        receipt=json.loads(receipt_path.read_text());assert receipt['url']==url
        if receipt.get('status')=='unavailable':return receipt
        file=root/receipt['path']
        assert file.stat().st_size==receipt.get('storedBytes',receipt['bytes'])
        return receipt
    if url in previous:receipt=link_existing(root,source,previous[url])
    else:
        fetch_band_sources.RESERVE=RESERVE
        try:receipt=fetch_band_sources.packed_fetch(root,url,700_000_000 if item['kind'] in ['tran','luse','wtr'] else 80_000_000)
        except __import__('urllib.error',fromlist=['HTTPError']).HTTPError as error:
            # Missing higher-resolution DEM is not fabricated as flat land.
            if item['kind']!='dem' or error.code!=404:raise
            receipt=dict(url=url,status='unavailable',httpStatus=404)
    result={**item,**receipt,'status':receipt.get('status','acquired')}
    return cache.save(receipt_path,result)


def main():
    parser=argparse.ArgumentParser();parser.add_argument('--root',type=Path,required=True)
    parser.add_argument('--source',type=Path,required=True);parser.add_argument('--kind',action='append')
    parser.add_argument('--max-new',type=int);parser.add_argument('--workers',type=int,default=3)
    args=parser.parse_args();root=args.root.resolve();source=args.source.resolve()
    (root/'raw').mkdir(exist_ok=True);(root/'receipts').mkdir(exist_ok=True)
    plan=json.loads((root/'tokyo-metro-plan.json').read_text());queue=acquisition_queue(plan)
    write(root/'acquisition-queue.json',dict(version=1,items=queue,diskReserveBytes=RESERVE))
    previous=old_receipts(source);cache=BlobCache(root)
    selected=[item for item in queue if not args.kind or item['kind'] in args.kind]
    pending=[item for item in selected if not (root/'receipts'/(hashlib.sha256(item['url'].encode()).hexdigest()[:24]+'.json')).exists()]
    if args.max_new is not None:pending=pending[:args.max_new]
    print('planned',len(queue),'selected',len(selected),'pending in this run',len(pending),'freeGB',round(shutil.disk_usage(root).free/1e9,2),flush=True)
    errors=[];acquired=0
    # Bounded waves avoid an executor queuing all remaining work after disk exhaustion.
    for start in range(0,len(pending),args.workers):
        with concurrent.futures.ThreadPoolExecutor(max_workers=args.workers) as pool:
            futures={pool.submit(fetch_one,root,source,item,previous,cache):item for item in pending[start:start+args.workers]}
            for future in concurrent.futures.as_completed(futures):
                item=futures[future]
                try:result=future.result();acquired+=result['status']=='acquired'
                except Exception as error:errors.append(dict(url=item['url'],error=str(error)))
        if (start+args.workers)%30<args.workers or errors:
            print('processed',min(start+args.workers,len(pending)),'acquired',acquired,'errors',len(errors),'freeGB',round(shutil.disk_usage(root).free/1e9,2),flush=True)
        if errors or shutil.disk_usage(root).free<RESERVE+100_000_000:break
    receipts=[json.loads(path.read_text()) for path in receipt_paths(root)]
    stored={r['path']:r for r in receipts if r['status']=='acquired'}
    unique={r['sha256']:r for r in stored.values()}
    report=dict(version=1,queued=len(queue),acquired=sum(r['status']=='acquired' for r in receipts),
        unavailable=[r for r in receipts if r['status']=='unavailable'],errors=errors,
        originalReferencedBytes=sum(r.get('bytes',0) for r in receipts),uniqueOriginalBytes=sum(r['bytes'] for r in unique.values()),
        storedBytes=sum(r.get('storedBytes',r['bytes']) for r in stored.values()),
        newlyStoredBytes=sum(r.get('storedBytes',r['bytes']) for r in stored.values() if not r.get('reusedFrom')),
        freeBytes=shutil.disk_usage(root).free,coverageComplete=False,
        interpretation='File receipts only. Feature/DEM auditing and runtime verification remain required.',
        stoppedForDiskReserve=shutil.disk_usage(root).free<RESERVE+100_000_000,selectedKinds=args.kind)
    write(root/'acquisition-status.json',report)
    write(root/('acquisition-'+ '-'.join(sorted(args.kind or ['all']))+'.json'),report)
    if errors:raise RuntimeError(json.dumps(errors,ensure_ascii=False))


if __name__=='__main__':main()
