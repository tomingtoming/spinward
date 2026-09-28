"""Reuse the same Blender kit on the small, explicitly authored service buildings."""
import argparse,json,hashlib,math
from pathlib import Path
from prepare_facade_sites import rooms


def main(root):
    d=root/'derived';study=json.loads((d/'study.json').read_text());report=[]
    for s in study['samples']:
        landscape=json.loads((d/s['bandLandscape']).read_text());manifest=json.loads((d/s['facadeSites']).read_text());rows=[]
        for b in landscape['buildingRecipes']:
            if b['usage'] not in ['商業施設','業務施設']:continue
            x0,y0,x1,y1=b['bounds'];points=[[x0,y0],[x1,y0],[x1,y1],[x0,y1],[x0,y0]];walls=[]
            for wi,(a,z) in enumerate(zip(points,points[1:])):
                length=math.dist(a,z);normal=[(z[1]-a[1])/length,-(z[0]-a[0])/length]
                walls.append(dict(a=a,b=z,normal=normal,length=length,base=b['base'],top=b['top'],ground=[b['base']-.1]*3,entryGround=b['base'],roadDistance=1 if wi==b.get('entryWall',0) else 100))
            seed=int(hashlib.sha256(b['id'].encode()).hexdigest()[:8],16)
            rows.append(dict(id=b['id'],seed=seed,style=seed%4,usage=b['usage'],walls=walls))
        rows=rooms(rows);manifest['sites']=[site for site in manifest['sites'] if not site['id'].startswith('band-service-')]
        for i,b in enumerate(rows):
            walls=b['walls'];bounds=[min(wall[a][k] for wall in walls for a in ['a','b']) for k in [0,1]]+[max(wall[a][k] for wall in walls for a in ['a','b']) for k in [0,1]]
            site=dict(id=f'band-service-{i}',label='コロニーのサービス施設',provenance='Spinward設計',buildings=[b]);name=f'{s["id"]}/facade-site-{site["id"]}.json';blob=json.dumps(site,ensure_ascii=False,separators=(',',':'));(d/name).write_text(blob)
            manifest['sites'].append(dict(id=site['id'],label=site['label'],path=name,bounds=bounds,heightRange=[b['walls'][0]['base'],b['walls'][0]['top']],buildings=1,bytes=len(blob.encode()),provenance='Spinward設計'))
        (d/s['facadeSites']).write_text(json.dumps(manifest,ensure_ascii=False));report.append(dict(id=s['id'],designedServiceFacades=len(rows),sameKit=manifest['kit']))
    (root/'band-service-facades-audit.json').write_text(json.dumps(report,ensure_ascii=False,indent=2))


if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--root',type=Path,required=True);main(p.parse_args().root)
