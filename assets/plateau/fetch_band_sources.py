"""Bounded acquisition for rectangular PLATEAU city cores.

Large CityGML is streamed to gzip and hashed as original bytes. No unpacked
municipality-sized temporary file is needed. Every source URL/version stays in
the lock; both the original and stored representation have hashes.
"""
import argparse, concurrent.futures, gzip, hashlib, json, math, shutil, time
import urllib.error, urllib.parse, urllib.request
from pathlib import Path
from shapely.geometry import Polygon, box
from fetch_study import fetch, tile_xy
from geo import Frame

RESERVE=2_000_000_000


def mesh_bounds(code):
    code=str(code)
    if len(code) not in (6,8):raise ValueError('Unhandled geographic mesh '+code)
    lat=int(code[:2])*2/3+int(code[4])/12
    lon=100+int(code[2:4])+int(code[5])/8
    dy,dx=1/12,1/8
    if len(code)==8:
        lat+=int(code[6])/120;lon+=int(code[7])/80;dy=1/120;dx=1/80
    return lon,lat,lon+dx,lat+dy


def packed_fetch(root,url,limit=700_000_000):
    key=hashlib.sha256(url.encode()).hexdigest()[:24]
    suffix=Path(urllib.parse.urlparse(url).path).suffix
    original=root/'raw'/(key+suffix)
    if original.exists():return fetch(root,url,limit)
    dest=original.with_suffix(suffix+'.gz');receipt=dest.with_suffix(dest.suffix+'.receipt.json')
    if dest.exists() and receipt.exists():return json.loads(receipt.read_text())
    if shutil.disk_usage(root).free<RESERVE+100_000_000:raise RuntimeError('Source acquisition disk reserve reached')
    for attempt in range(3):
        temp=dest.with_suffix(dest.suffix+'.next');count=0;digest=hashlib.sha256()
        try:
            with urllib.request.urlopen(url,timeout=90) as response, temp.open('wb') as file, gzip.GzipFile(fileobj=file,mode='wb',mtime=0,compresslevel=3) as out:
                while block:=response.read(1024*1024):
                    count+=len(block)
                    if count>limit:raise ValueError('Source exceeds explicit byte limit: '+url)
                    if count%(8*1024*1024)==0 and shutil.disk_usage(root).free<RESERVE:raise RuntimeError('Source acquisition disk reserve reached')
                    digest.update(block);out.write(block)
            temp.replace(dest)
            row=dict(url=url,path=str(dest.relative_to(root)),bytes=count,sha256=digest.hexdigest(),compression='gzip',storedBytes=dest.stat().st_size,storedSha256=hashlib.sha256(dest.read_bytes()).hexdigest())
            receipt.write_text(json.dumps(row));return row
        except Exception:
            temp.unlink(missing_ok=True)
            if attempt==2:raise
            time.sleep(attempt+1)


def main(root,region=None):
    plan=json.loads((root/'band-source-plan.json').read_text())
    previous=json.loads((root/'imports.json').read_text()) if (root/'imports.json').exists() else {'samples':[]}
    samples={s['id']:s for s in previous['samples']}
    for band in plan['bands']:
        if region and region!=band['id']:continue
        fr=band['frame'];frame=Frame(fr['epsg'],fr['origin'],fr['angle']);cx,cy=band['anchor']['local'];b=band['bounds']
        # Align the extended grid with the accepted nucleus to preserve its DEM triangles.
        bounds=[math.ceil((b[0]-cx)/20)*20,math.ceil((b[1]-cy)/20)*20,math.floor((b[2]-cx)/20)*20,math.floor((b[3]-cy)/20)*20]
        corridor=box(bounds[0]+cx,bounds[1]+cy,bounds[2]+cx,bounds[3]+cy)
        sample={k:band[k] for k in ['id','name','station','frame','anchor','bbox','corners','metadata']}
        sample.update(half=1400 if band['id']=='tokyo' else 700,bounds=bounds,buildings=[],roads=[],land=[],codelists=[],dem=[],neighborDatasets=[],skippedContext=[])
        seen=set()
        for city in band['cities']:
            if not city['buildings']:continue
            if 'dataset' not in sample:sample['dataset']=city['dataset'];sample['cityCode']=city['cityCode']
            else:sample['neighborDatasets'].append(city['dataset'])
            leaves=city['buildings']
            with concurrent.futures.ThreadPoolExecutor(max_workers=3) as pool:
                for leaf,got in zip(leaves,pool.map(lambda t:packed_fetch(root,t['url'],80_000_000),leaves)):
                    sample['buildings'].append(dict(leaf,**got,cityCode=city['cityCode']))
            files=[]
            for kind,values in city['files'].items():
                for f in values:
                    if f['url'] in seen:continue
                    lo,la,hi,ha=mesh_bounds(f['code'])
                    polygon=Polygon([frame.place(x,y) for x,y in [(lo,la),(hi,la),(hi,ha),(lo,ha)]])
                    if not polygon.intersects(corridor):continue
                    seen.add(f['url']);files.append((kind,f))
            with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
                for (kind,f),got in zip(files,pool.map(lambda v:packed_fetch(root,v[1]['url']),files)):
                    sample['roads' if kind=='tran' else 'land'].append(dict(f,**got,kind=kind))
            for url in city['metadataZipUrls']:
                if url.endswith('_codelists.zip') and url not in seen:
                    seen.add(url);sample['codelists'].append(fetch(root,url,10_000_000))
            print(band['id'],city['cityCode'],'buildings',len(sample['buildings']),'surfaces',len(sample['roads'])+len(sample['land']),flush=True)
        a,z=tile_xy(band['bbox'][0],band['bbox'][3],14),tile_xy(band['bbox'][2],band['bbox'][1],14)
        for layer in ['dem5a','dem']:
            for x in range(math.floor(a[0])-1,math.floor(z[0])+2):
                for y in range(math.floor(a[1])-1,math.floor(z[1])+2):
                    url=f'https://cyberjapandata.gsi.go.jp/xyz/{layer}/14/{x}/{y}.txt'
                    try:sample['dem'].append(dict(layer=layer,z=14,x=x,y=y,**packed_fetch(root,url,2_000_000)))
                    except urllib.error.HTTPError as e:
                        if e.code!=404:raise
        samples[band['id']]=sample
        imports=dict(origin='ai',created='2026-09-23',scope='Three source city corridors, separate from designed 40 km colony bands',samples=[samples[s['id']] for s in plan['bands'] if s['id'] in samples])
        (root/'imports.json').write_text(json.dumps(imports,ensure_ascii=False,indent=2))
        (root/'source-lock.json').write_text(json.dumps(dict(origin='ai',created='2026-09-23',imports=imports,survey=json.loads((root/'survey.json').read_text()),plan=plan),ensure_ascii=False,indent=2))
        print('ACQUIRED',band['id'],bounds,'free GB',shutil.disk_usage(root).free/1e9,flush=True)


if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--root',type=Path,required=True);p.add_argument('--region')
    a=p.parse_args();main(a.root,a.region)
