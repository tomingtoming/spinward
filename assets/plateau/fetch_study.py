"""Fetch bounded, reproducible public-data samples; no runtime network dependency."""
import argparse
import concurrent.futures
import hashlib
import json
import math
import time
import urllib.parse
import urllib.request
from pathlib import Path
from geo import Frame

SAMPLES = [('tokyo','13115','東高円寺'),('tama','13224','京王多摩センター'),('azumino','20220','柏矢町')]
HALF = 700.0


def fetch(root, url, limit=80_000_000):
    key=hashlib.sha256(url.encode()).hexdigest()[:24]
    file=root/'raw'/(key+Path(urllib.parse.urlparse(url).path).suffix)
    file.parent.mkdir(parents=True,exist_ok=True)
    if not file.exists():
        for attempt in range(2):
            try:
                with urllib.request.urlopen(url,timeout=45) as response:
                    data=response.read(limit+1)
                if len(data)>limit: raise ValueError('Download exceeds bound: '+url)
                temp=file.with_suffix(file.suffix+'.next');temp.write_bytes(data);temp.replace(file)
                break
            except Exception:
                if attempt==1: raise
                time.sleep(1)
    data=file.read_bytes()
    return dict(url=url,path=str(file.relative_to(root)),bytes=len(data),sha256=hashlib.sha256(data).hexdigest())


def tile_xy(lon,lat,z):
    n=2**z
    return (lon+180)/360*n, (1-math.asinh(math.tan(math.radians(lat)))/math.pi)/2*n


def main(root):
    survey=json.loads((root/'survey.json').read_text())
    datasets=json.loads((root/'building-datasets.json').read_text())
    report=[]
    for id_,code,station in SAMPLES:
        plan=next(c for c in survey['candidates'] if c['id']==id_)
        frame=Frame(plan['frame']['epsg'],plan['frame']['origin'],plan['frame']['angle'])
        anchor=next(s for s in plan['stations'] if s['name']==station)
        cx,cy=anchor['local']
        corners=[frame.geographic(cx+x,cy+y) for x,y in [(-HALF,-HALF),(HALF,-HALF),(HALF,HALF),(-HALF,HALF)]]
        bbox=[min(p[0] for p in corners),min(p[1] for p in corners),max(p[0] for p in corners),max(p[1] for p in corners)]
        radians=list(map(math.radians,bbox))
        ds=next(d for d in datasets if d['city_code']==code)
        tileset=json.loads((root/(code+'-tileset.json')).read_text())
        selected=[]
        def walk(n):
            assert 'transform' not in n, 'Tile transforms require explicit handling'
            b=n['boundingVolume']['region']
            if b[2]<radians[0] or b[0]>radians[2] or b[3]<radians[1] or b[1]>radians[3]:return
            if n.get('children'):
                assert n.get('refine','REPLACE')=='REPLACE'
                for c in n['children']:walk(c)
            elif n.get('content'):
                assert n['geometricError']==0
                selected.append(dict(url=urllib.parse.urljoin(ds['url'],n['content']['uri']),region=b))
        walk(tileset['root'])
        assert 0<len(selected)<=64, (id_,len(selected))
        with concurrent.futures.ThreadPoolExecutor(max_workers=3) as pool:
            got=list(pool.map(lambda t:fetch(root,t['url']),selected))
        for t,g in zip(selected,got):t.update(g)
        query='https://api.plateauview.mlit.go.jp/datacatalog/citygml/r:'+','.join(map(str,bbox))+'?types=tran,luse,wtr'
        metadata=fetch(root,query)
        cities=json.loads((root/metadata['path']).read_text())['cities']
        city=next(c for c in cities if c['cityCode']==code)
        roads=[dict(f,**fetch(root,f['url'])) for f in city['files'].get('tran',[])]
        # Land use / water are optional visual context. Large municipality files are recorded, not guessed.
        land=[]
        for kind in ('luse','wtr'):
            for f in city['files'].get(kind,[]):
                if 0<f.get('fileSize',0)<80_000_000:
                    land.append({'kind':kind,**f,**fetch(root,f['url'])})
        dem=[]
        for layer,z in [('dem5a',14),('dem',14)]:
            a,b=tile_xy(bbox[0],bbox[3],z),tile_xy(bbox[2],bbox[1],z)
            for x in range(math.floor(a[0]),math.floor(b[0])+1):
                for y in range(math.floor(a[1]),math.floor(b[1])+1):
                    u=f'https://cyberjapandata.gsi.go.jp/xyz/{layer}/{z}/{x}/{y}.txt'
                    try:dem.append(dict(layer=layer,z=z,x=x,y=y,**fetch(root,u,2_000_000)))
                    except urllib.error.HTTPError as e:
                        if e.code!=404:raise
        row=dict(id=id_,cityCode=code,name=plan['name'],station=station,frame=plan['frame'],anchor=anchor,
                 half=HALF,bbox=bbox,corners=corners,dataset=ds,buildings=selected,roads=roads,land=land,dem=dem,
                 metadata=metadata,codelists=[fetch(root,u,10_000_000) for u in city['metadataZipUrls'] if u.endswith('_codelists.zip')],
                 skippedContext=[f for fs in city['files'].values() for f in fs if f.get('fileSize',0)>=80_000_000])
        report.append(row)
        (root/'imports.json').write_text(json.dumps(dict(origin='ai',created='2026-09-22',samples=report),ensure_ascii=False,indent=2))
        print(json.dumps(dict(id=id_,tiles=len(selected),roads=len(roads),land=len(land),dem=len(dem),downloadBytes=sum(g['bytes'] for g in got)),ensure_ascii=False),flush=True)


if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--root',type=Path,required=True)
    main(p.parse_args().root)
