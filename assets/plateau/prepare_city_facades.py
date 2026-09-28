"""Apply the reusable facade kit to every eligible source building in the sample."""
import argparse,collections,gzip,json,math
from pathlib import Path
from assemble import Terrain,Frame
from prepare_walk import read_mesh
from plan_frontage import plan_buildings
from prepare_facade_sites import rooms

def main(root,reference,region='tokyo',defer_study=False):
    d=root/'derived';read=lambda p:json.loads(p.read_text());study=read(d/'study.json');s=next(s for s in study['samples'] if s['id']==region);w=read(d/s['walk']);imp=next(s for s in read(root/'imports.json')['samples'] if s['id']==region);f=imp['frame'];t=Terrain(root,imp,Frame(f['epsg'],f['origin'],f['angle']))
    features={v['id']:v for v in read(d/s['features'])};p,idx=read_mesh(root,s,'buildings');audit=[]
    rows=plan_buildings(w,features,p,idx,t,audit=audit);print('analysed',len(audit),'parts;',len(rows),'facade recipes',flush=True)
    prior=next(s for s in read(reference/'derived/study.json')['samples'] if s['id']==region)
    old=read(reference/'derived'/prior['facadeSites']) if prior.get('facadeSites') else {'sites':[]}
    sites=[read(reference/'derived'/v['path']) for v in old['sites']];known={b['id'] for site in sites for b in site['buildings']};owner={};buckets=collections.defaultdict(list)
    for b in rooms([b for b in rows if b['id'] not in known]):
        points=[p for wall in b['walls'] for p in [wall['a'],wall['b']]];x=(min(p[0] for p in points)+max(p[0] for p in points))/2;y=(min(p[1] for p in points)+max(p[1] for p in points))/2
        key=owner.setdefault(b['id'],(math.floor(x/200),math.floor(y/200)));b['style']=b['seed']%4
        # The same SHA-generated colours, with one character per room instead of
        # a repeated JSON dictionary key. Existing approved recipes stay intact.
        for wall in b['walls']:
            bands=[]
            for floor in range(wall['floors']):
                values=[];j=0
                while f'{floor}:{j}' in wall['rooms']:values.append(str(wall['rooms'][f'{floor}:{j}']));j+=1
                bands.append(''.join(values))
            wall['roomBands']=bands;del wall['rooms']
        buckets[key].append(b)
    for (x,y),bs in sorted(buckets.items()):sites.append(dict(id=f'extension-{x}-{y}',label='街区',buildings=bs))
    manifest=dict(version=3,origin='ai',created='2026-09-23',kit='facade-kit.json',sites=[],bodyColours={},loadDistance=220,evictDistance=300,maxResident=24,maxBytes=6*1024*1024)
    palette=['#cfc6b4','#b3b8b5','#ab9181','#e1d9c9','#8c9c9c']
    for site in sites:
        name=f"{region}/facade-site-{site['id']}.json";blob=json.dumps(site,ensure_ascii=False,separators=(',',':'));(d/name).write_text(blob)
        walls=[wall for b in site['buildings'] for wall in b['walls']];bounds=[min(wall[a][k] for wall in walls for a in ['a','b']) for k in [0,1]]+[max(wall[a][k] for wall in walls for a in ['a','b']) for k in [0,1]]
        meta=dict(id=site['id'],label=site['label'],path=name,bounds=bounds,heightRange=[min(v['base'] for v in walls),max(v['top'] for v in walls)],buildings=len({b['id'] for b in site['buildings']}),bytes=len(blob.encode()))
        if 'arrival' in site:meta['arrival']=site['arrival']
        manifest['sites'].append(meta)
        for b in site['buildings']:manifest['bodyColours'][b['id']]=palette[b['seed']%5]
    filename='facade-sites.json' if region=='tokyo' else f'{region}/facade-sites.json'
    (d/filename).write_text(json.dumps(manifest,ensure_ascii=False));s['facadeSites']=filename
    if defer_study:(root/f'{region}-facade-update.json').write_text(json.dumps(dict(id=region,facadeSites=filename)))
    else:(d/'study.json').write_text(json.dumps(study,ensure_ascii=False))
    applied=set(manifest['bodyColours']);reasons={}
    for b in audit:
        if b['id'] in applied:continue
        reasons.setdefault(b['id'],set()).add(b['reason'])
    assert applied|set(reasons)==set(features)
    excluded=[dict(id=id,usage=features[id]['usage'],reasons=sorted(v)) for id,v in sorted(reasons.items())]
    report=dict(origin='ai',created='2026-09-23',sourceBuildings=len(features),appliedBuildings=len(applied),preservedBuildings=len(known),coverage=len(applied)/len(features),sites=len(sites),walls=sum(len(b['walls']) for site in sites for b in site['buildings']),recipeBytes=sum(s['bytes'] for s in manifest['sites']),maxRecipeBytes=max(s['bytes'] for s in manifest['sites']),excludedReasons=dict(collections.Counter(reason for v in excluded for reason in v['reasons'])),excluded=excluded)
    (root/('city-facades-audit.json' if region=='tokyo' else f'{region}-facades-audit.json')).write_text(json.dumps(report,ensure_ascii=False,indent=2));print(json.dumps({k:v for k,v in report.items() if k!='excluded'},ensure_ascii=False,indent=2),flush=True)
if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--root',type=Path,required=True);p.add_argument('--reference',type=Path,required=True);p.add_argument('--region',default='tokyo');p.add_argument('--defer-study',action='store_true');a=p.parse_args();main(a.root,a.reference,a.region,a.defer_study)
