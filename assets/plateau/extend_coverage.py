"""Resolve neighboring municipalities before treating an empty area as empty land."""
import argparse
import concurrent.futures
import json
import math
from pathlib import Path
from urllib.parse import urljoin
from fetch_study import fetch


def main(root):
    report=json.loads((root/'imports.json').read_text());catalog=json.loads((root/'catalog.json').read_text())
    for s in report['samples']:
        cities=json.loads((root/s['metadata']['path']).read_text())['cities'];bbox=list(map(math.radians,s['bbox']))
        s['neighborDatasets']=[];s['neighborCoverageChecks']=[]
        for city in cities:
            code=city['cityCode']
            if code==s['cityCode']:continue
            # latest_datasets contains mutable aliases with year='latest'; pin a concrete asset/year.
            options=[d for d in catalog['datasets'] if d['city_code']==code and d['type_en']=='bldg' and d['format']=='3D Tiles' and d['lod']=='1']
            assert options,('Missing neighbor dataset',code)
            d=sorted(options,key=lambda d:(-int(d['year']),bool(d.get('texture')),d['url']))[0]
            meta=fetch(root,d['url']);tiles=json.loads((root/meta['path']).read_text());selected=[]
            def walk(n):
                assert 'transform' not in n
                b=n['boundingVolume']['region']
                if b[2]<bbox[0] or b[0]>bbox[2] or b[3]<bbox[1] or b[1]>bbox[3]:return
                if n.get('children'):
                    assert n.get('refine','REPLACE')=='REPLACE'
                    for c in n['children']:walk(c)
                elif n.get('content'):
                    assert n['geometricError']==0
                    selected.append(dict(url=urljoin(d['url'],n['content']['uri']),region=b,cityCode=code))
            walk(tiles['root']);assert len(selected)<=64
            s['neighborCoverageChecks'].append(dict(cityCode=code,leafTiles=len(selected),tileset=meta))
            if not selected:continue
            with concurrent.futures.ThreadPoolExecutor(max_workers=3) as pool:got=list(pool.map(lambda t:fetch(root,t['url']),selected))
            for t,g in zip(selected,got):t.update(g)
            previous={t['url'] for t in s['buildings']};s['buildings'].extend(t for t in selected if t['url'] not in previous)
            s['neighborDatasets'].append(d)
            print(s['id'],city['cityName'],'neighbor tiles',len(selected),flush=True)
        (root/'imports.json').write_text(json.dumps(report,ensure_ascii=False,indent=2))

if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--root',required=True,type=Path);main(p.parse_args().root)
