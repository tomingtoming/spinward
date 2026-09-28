"""Pin the three source corridors before importing any bulk geometry.

The 40 km colony band and the actual Earth-data core are separate extents.
Metadata uses geographic bounding boxes; leaf selection uses the rotated
metre-space corridor so a long narrow strip does not download its entire bbox.
"""
import argparse, hashlib, json, math, os, shutil
from pathlib import Path
from urllib.parse import urljoin
from shapely.geometry import Polygon, box
from fetch_study import fetch
from geo import Frame, WIDTH, SPAN


def main(source, root):
    root.mkdir(parents=True, exist_ok=True)
    (root/'raw').mkdir(exist_ok=True)
    for f in (source/'raw').iterdir():
        if f.is_file() and not (root/'raw'/f.name).exists():
            os.link(f, root/'raw'/f.name)
    for name in ['survey.json', 'catalog.json']:
        if not (root/name).exists():
            shutil.copy2(source/name, root/name)
    survey=json.loads((root/'survey.json').read_text())
    catalog=json.loads((root/'catalog.json').read_text())['datasets']
    prior=json.loads((source/'imports.json').read_text())
    result=dict(version=1, origin='ai', created='2026-09-23', radius=3200,
                width=WIDTH, span=SPAN, policy='source city cores with designed colony outer landscapes',
                source=str(source), bands=[])
    for old in prior['samples']:
        s=next(c for c in survey['candidates'] if c['id']==old['id'])
        f=s['frame'];frame=Frame(f['epsg'], f['origin'], f['angle'])
        # Keep a 75 m utility/landscape margin on either side of the land strip.
        y0=math.floor((min(v['local'][1] for v in s['stations'])-800)/200)*200
        y1=math.ceil((max(v['local'][1] for v in s['stations'])+800)/200)*200
        bounds=[-1600,y0,1600,y1]
        corners=[frame.geographic(x,y) for x,y in [(bounds[0],y0),(bounds[2],y0),(bounds[2],y1),(bounds[0],y1)]]
        bbox=[min(p[0] for p in corners),min(p[1] for p in corners),max(p[0] for p in corners),max(p[1] for p in corners)]
        query='https://api.plateauview.mlit.go.jp/datacatalog/citygml/r:'+','.join(map(str,bbox))+'?types=tran,luse,wtr'
        metadata=fetch(root,query);cities=json.loads((root/metadata['path']).read_text())['cities']
        row=dict(id=s['id'], name=s['name'], frame=f, anchor=old['anchor'], station=old['station'],
                 bounds=bounds, corners=corners, bbox=bbox, stations=s['stations'], metadata=metadata, cities=[], missing=[])
        corridor=box(*bounds)
        for city in cities:
            code=city['cityCode'];options=[d for d in catalog if d['city_code']==code and d['type_en']=='bldg' and d['format']=='3D Tiles' and d['lod']=='1']
            if not options:
                row['missing'].append(dict(cityCode=code, reason='No LOD1 building tiles in pinned catalog'))
                continue
            year=max(int(d['year']) for d in options)
            dataset=sorted([d for d in options if int(d['year'])==year],key=lambda d:(bool(d.get('texture')),d['url']))[0]
            meta=fetch(root,dataset['url']);tree=json.loads((root/meta['path']).read_text());leaves=[]
            def walk(n):
                assert 'transform' not in n, 'Unsupported tile transform'
                b=n['boundingVolume']['region']
                poly=Polygon([frame.place(math.degrees(x),math.degrees(y)) for x,y in [(b[0],b[1]),(b[2],b[1]),(b[2],b[3]),(b[0],b[3])]])
                if not poly.intersects(corridor):return
                if n.get('children'):
                    assert n.get('refine','REPLACE')=='REPLACE'
                    for c in n['children']:walk(c)
                elif n.get('content'):
                    assert n['geometricError']==0
                    leaves.append(dict(url=urljoin(dataset['url'],n['content']['uri']),region=b))
            walk(tree['root'])
            row['cities'].append(dict(cityCode=code, cityName=city.get('cityName',code), year=year,
                                      dataset=dataset, tileset=meta, buildings=leaves, files=city['files'],
                                      metadataZipUrls=city['metadataZipUrls']))
        row['areaKm2']=(bounds[2]-bounds[0])*(y1-y0)/1e6
        row['buildingTiles']=sum(len(c['buildings']) for c in row['cities'])
        row['uncompressedSurfaceBytes']=sum(f.get('fileSize',0) for c in row['cities'] for fs in c['files'].values() for f in fs)
        result['bands'].append(row)
        (root/'band-source-plan.json').write_text(json.dumps(result,ensure_ascii=False,indent=2))
        print(json.dumps({k:row[k] for k in ['id','bounds','areaKm2','buildingTiles','uncompressedSurfaceBytes','missing']},ensure_ascii=False),flush=True)
        print([(c['cityCode'],c['year'],len(c['buildings']),{k:len(v) for k,v in c['files'].items()}) for c in row['cities']],flush=True)
    result['metadataSha256']=hashlib.sha256((root/'catalog.json').read_bytes()).hexdigest()
    (root/'band-source-plan.json').write_text(json.dumps(result,ensure_ascii=False,indent=2))


if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--source',type=Path,required=True);p.add_argument('--root',type=Path,required=True)
    a=p.parse_args();main(a.source,a.root)
