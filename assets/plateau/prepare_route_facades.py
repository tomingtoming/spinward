"""Reuse the authored facade kit across the source-backed exploration corridor."""
import argparse,json,math,collections
from pathlib import Path
from shapely.geometry import LineString,Polygon
from assemble import Terrain,Frame
from prepare_walk import read_mesh
from plan_frontage import plan_buildings
from prepare_facade_sites import rooms
from prepare_walk_tiles import ground

def main(root,reference):
    d=root/'derived';read=lambda p:json.loads(p.read_text())
    study=read(d/'study.json');s=study['samples'][0];w=read(d/s['walk']);route=read(d/'exploration.json')
    imp=read(root/'imports.json')['samples'][0];f=imp['frame'];t=Terrain(root,imp,Frame(f['epsg'],f['origin'],f['angle']))
    features={v['id']:v for v in read(d/s['features'])};p,idx=read_mesh(root,s,'buildings')
    rows=rooms(plan_buildings(w,features,p,idx,t,LineString(route['points'])))
    old=read(reference/'derived/facade-sites.json');sites=[read(reference/'derived'/v['path']) for v in old['sites']]
    known={b['id'] for site in sites for b in site['buildings']};buckets=collections.defaultdict(list)
    for b in rows:
        if b['id'] in known:continue
        xs=[v for wall in b['walls'] for v in [wall['a'][0],wall['b'][0]]];ys=[v for wall in b['walls'] for v in [wall['a'][1],wall['b'][1]]]
        # Multipart source buildings always share one recipe owner.
        feature=features[b['id']];key=(math.floor((min(xs)+max(xs))/2/200),math.floor((min(ys)+max(ys))/2/200))
        b['style']=b['seed']%4;buckets[key].append(b)
    owners={}
    for key,bs in buckets.items():
        for b in bs:owners.setdefault(b['id'],key)
    rebucket=collections.defaultdict(list)
    for bs in buckets.values():
        for b in bs:rebucket[owners[b['id']]].append(b)
    for (x,y),bs in sorted(rebucket.items()):sites.append(dict(id=f'route-{x}-{y}',label='沿道',buildings=bs))
    manifest=dict(version=2,origin='ai',created='2026-09-23',kit='facade-kit.json',sites=[],bodyColours={},loadDistance=420,evictDistance=500,maxResident=28)
    palette=['#cfc6b4','#b3b8b5','#ab9181','#e1d9c9','#8c9c9c']
    for site in sites:
        if 'arrival' in site:site['arrival']['ground']=ground(w,*site['arrival']['spawn'])
        path=f"tokyo/facade-site-{site['id']}.json";blob=json.dumps(site,ensure_ascii=False,separators=(',',':'));(d/path).write_text(blob)
        walls=[wall for b in site['buildings'] for wall in b['walls']]
        bounds=[min(wall[a][k] for wall in walls for a in ['a','b']) for k in [0,1]]+[max(wall[a][k] for wall in walls for a in ['a','b']) for k in [0,1]]
        meta=dict(id=site['id'],label=site['label'],path=path,bounds=bounds,heightRange=[min(v['base'] for v in walls),max(v['top'] for v in walls)],buildings=len({b['id'] for b in site['buildings']}),bytes=len(blob.encode()))
        if 'arrival' in site:meta['arrival']=site['arrival']
        manifest['sites'].append(meta)
        for b in site['buildings']:manifest['bodyColours'][b['id']]=palette[b['seed']%5]
    for stop in route['stops']:stop['ground']=ground(w,*stop['point'])
    (d/'exploration.json').write_text(json.dumps(route,ensure_ascii=False));(d/'facade-sites.json').write_text(json.dumps(manifest,ensure_ascii=False))
    s['facadeSites']='facade-sites.json';(d/'study.json').write_text(json.dumps(study,ensure_ascii=False))
    audit=dict(buildings=len(manifest['bodyColours']),sites=len(sites),walls=sum(len(b['walls']) for site in sites for b in site['buildings']),preserved=len(known),uses=dict(collections.Counter(b['usage'] for site in sites for b in site['buildings'])),rule='within 29m; height >= 4.5m; footprint >= 18m2; known non-storage use; exposed source walls >= 2.4m')
    (root/'route-facades-audit.json').write_text(json.dumps(audit,ensure_ascii=False,indent=2));print(json.dumps(audit,ensure_ascii=False))
if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--root',type=Path,required=True);p.add_argument('--reference',type=Path,required=True);a=p.parse_args();main(a.root,a.reference)
