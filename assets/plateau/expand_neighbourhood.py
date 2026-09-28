"""Acquire a bounded Tokyo expansion while keeping the reviewed three-city study.

Immutable raw files may be hard-linked; mutable derived files are always copied.
Only concrete 2025 PLATEAU datasets are selected, and hashes are recorded.
"""
import argparse,concurrent.futures,copy,json,math,os,shutil,urllib.error
from pathlib import Path
from urllib.parse import urljoin
from fetch_study import fetch,tile_xy
from geo import Frame,WIDTH

def main(source,root,half=1400):
    root.mkdir(parents=True,exist_ok=True)
    for name in ['imports.json','survey.json','catalog.json','frontage-plan.json','walking-adaptation.json']:
        if not (root/name).exists():shutil.copy2(source/name,root/name)
    if not (root/'derived').exists():shutil.copytree(source/'derived',root/'derived')
    (root/'raw').mkdir(exist_ok=True)
    for f in (source/'raw').iterdir():
        if f.is_file() and not (root/'raw'/f.name).exists():os.link(f,root/'raw'/f.name)
    imports=json.loads((root/'imports.json').read_text());sample=copy.deepcopy(imports['samples'][0])
    fr=sample['frame'];frame=Frame(fr['epsg'],fr['origin'],fr['angle']);cx,cy=sample['anchor']['local']
    assert abs(cx)+half+100<WIDTH/2,'Leave space to join the colony band'
    corners=[frame.geographic(cx+x,cy+y) for x,y in [(-half,-half),(half,-half),(half,half),(-half,half)]]
    bbox=[min(x for x,y in corners),min(y for x,y in corners),max(x for x,y in corners),max(y for x,y in corners)]
    sample.update(half=half,corners=corners,bbox=bbox)
    query='https://api.plateauview.mlit.go.jp/datacatalog/citygml/r:'+','.join(map(str,bbox))+'?types=tran,luse,wtr'
    metadata=fetch(root,query);cities=json.loads((root/metadata['path']).read_text())['cities']
    catalog=json.loads((root/'catalog.json').read_text())['datasets'];bounds=list(map(math.radians,bbox))
    sample.update(metadata=metadata,buildings=[],roads=[],land=[],codelists=[],dem=[],neighborDatasets=[],neighborCoverageChecks=[],skippedContext=[])
    seen=set()
    def unique_fetch(url,**extra):
        if url in seen:return None
        seen.add(url);return dict(extra,**fetch(root,url))
    for city in cities:
        code=city['cityCode'];options=[d for d in catalog if d['city_code']==code and d['type_en']=='bldg' and d['format']=='3D Tiles' and d['lod']=='1' and str(d['year'])=='2025']
        if not options:raise ValueError('No pinned 2025 building coverage for '+code)
        dataset=sorted(options,key=lambda d:(bool(d.get('texture')),d['url']))[0];meta=fetch(root,dataset['url']);tree=json.loads((root/meta['path']).read_text());leaves=[]
        def walk(n):
            assert 'transform' not in n
            b=n['boundingVolume']['region']
            if b[2]<bounds[0] or b[0]>bounds[2] or b[3]<bounds[1] or b[1]>bounds[3]:return
            if n.get('children'):
                assert n.get('refine','REPLACE')=='REPLACE'
                for c in n['children']:walk(c)
            elif n.get('content'):
                assert n['geometricError']==0
                leaves.append(dict(url=urljoin(dataset['url'],n['content']['uri']),region=b,cityCode=code))
        walk(tree['root']);assert len(leaves)<=180
        with concurrent.futures.ThreadPoolExecutor(max_workers=3) as pool:got=list(pool.map(lambda t:fetch(root,t['url']),leaves))
        sample['buildings'].extend(dict(t,**g) for t,g in zip(leaves,got))
        sample['neighborCoverageChecks'].append(dict(cityCode=code,leafTiles=len(leaves),tileset=meta))
        if code==sample['cityCode']:sample['dataset']=dataset
        else:sample['neighborDatasets'].append(dataset)
        for kind in ['tran','luse','wtr']:
            for f in city['files'].get(kind,[]):
                if f.get('fileSize',0)>=80_000_000:
                    if kind=='tran':raise ValueError('Required road surface exceeds bounded importer: '+f['url'])
                    sample['skippedContext'].append(dict(f,kind=kind));continue
                g=unique_fetch(f['url'])
                if g:sample['roads' if kind=='tran' else 'land'].append(dict(f,**g,**({} if kind=='tran' else {'kind':kind})))
        for url in city['metadataZipUrls']:
            if url.endswith('_codelists.zip'):
                g=unique_fetch(url)
                if g:sample['codelists'].append(g)
        print('coverage',code,'building tiles',len(leaves),'roads',len(sample['roads']),flush=True)
    for layer,z in [('dem5a',14),('dem',14)]:
        a,b=tile_xy(bbox[0],bbox[3],z),tile_xy(bbox[2],bbox[1],z)
        for x in range(math.floor(a[0]),math.floor(b[0])+1):
            for y in range(math.floor(a[1]),math.floor(b[1])+1):
                url=f'https://cyberjapandata.gsi.go.jp/xyz/{layer}/{z}/{x}/{y}.txt'
                try:sample['dem'].append(dict(layer=layer,z=z,x=x,y=y,**fetch(root,url,2_000_000)))
                except urllib.error.HTTPError as e:
                    if e.code!=404:raise
    imports['samples'][0]=sample;imports.update(created='2026-09-23',scope='Tokyo 2.8 km square; Tama and Azumino unchanged')
    (root/'imports.json').write_text(json.dumps(imports,ensure_ascii=False,indent=2))
    lock=dict(origin='ai',created='2026-09-23',purpose='Continuous Tokyo exploration milestone',imports=imports,survey=json.loads((root/'survey.json').read_text()))
    (root/'source-lock.json').write_text(json.dumps(lock,ensure_ascii=False,indent=2))
    print('Tokyo expansion',len(sample['buildings']),'tiles',len(sample['roads']),'road files',bbox,flush=True)

if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--source',required=True,type=Path);p.add_argument('--root',required=True,type=Path);p.add_argument('--half',type=float,default=1400)
    a=p.parse_args();main(a.source,a.root,a.half)
