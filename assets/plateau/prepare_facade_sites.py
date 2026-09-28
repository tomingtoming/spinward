"""Analyse source walls; produce compact facade recipes without running Blender."""
import argparse,json,math,hashlib,copy
from pathlib import Path
from shapely import union_all
from shapely.geometry import Polygon,LineString
from shapely.affinity import translate
from assemble import Terrain,Frame
from prepare_walk import read_mesh,choose_route
from plan_frontage import plan_buildings

def rooms(rows):
    rows=copy.deepcopy(rows)
    for row in rows:
        office=row['usage'] in ['業務施設','官公庁施設','文教厚生施設']
        for wi,w in enumerate(row['walls']):
            floors=max(1,round((w['top']-w['base'])/(3.5 if office else 3.0)));w['floors']=floors
            bay=2.1+row['seed']%3*.23 if office else 2.9+row['seed']%3*.35
            bays=max(1,math.floor((w['length']-.8)/bay))
            w['rooms']={f'{f}:{j}':int(hashlib.sha256(f"{row['id']}:{wi}:{f}:{j}".encode()).hexdigest()[:8],16)%5 for f in range(floors) for j in range(bays)}
    return rows

def main(root):
    study=json.loads((root/'derived/study.json').read_text());s=study['samples'][0]
    imp=json.loads((root/'imports.json').read_text())['samples'][0];f=imp['frame'];t=Terrain(root,imp,Frame(f['epsg'],f['origin'],f['angle']))
    w=json.loads((root/'derived'/s['walk']).read_text());features={f['id']:f for f in json.loads((root/'derived'/s['features']).read_text())}
    p,idx=read_mesh(root,s,'buildings');reference=json.loads((root/'frontage-plan.json').read_text())['buildings']
    shapes=union_all([Polygon(b['rings'][0],b['rings'][1:]) for b in w['buildings']])
    roads=union_all([Polygon(b['rings'][0],b['rings'][1:]) for b in w['roads']]);water=Polygon()
    ox,oy=185,30
    arrival=choose_route(translate(roads,-ox,-oy),translate(shapes,-ox,-oy),water)
    arrival['spawn']=[arrival['spawn'][0]+ox,arrival['spawn'][1]+oy]
    arrival['route']=[[x+ox,y+oy] for x,y in arrival['route']]
    extension=plan_buildings(w,features,p,idx,t,LineString(arrival['route']))
    known={b['id'] for b in reference};extension=[b for b in extension if b['id'] not in known]
    assert len(extension)>=12,'Need a genuinely new source block'
    sites=[dict(id='station',label='駅前の街区',arrival=w['arrival'],buildings=rooms(reference)),
           dict(id='east',label='東の街区',arrival=arrival,buildings=rooms(extension))]
    manifest=dict(version=1,origin='ai',created='2026-09-22',kit='facade-kit.json',sites=[])
    for site in sites:
        path=f"tokyo/facade-site-{site['id']}.json";blob=json.dumps(site,ensure_ascii=False,separators=(',',':'))
        (root/'derived'/path).write_text(blob)
        bounds=[min(v for b in site['buildings'] for wall in b['walls'] for v in [wall['a'][k],wall['b'][k]]) for k in [0,1]]
        bounds += [max(v for b in site['buildings'] for wall in b['walls'] for v in [wall['a'][k],wall['b'][k]]) for k in [0,1]]
        height_range=[min(w['base'] for b in site['buildings'] for w in b['walls']),max(w['top'] for b in site['buildings'] for w in b['walls'])]
        manifest['sites'].append(dict(id=site['id'],label=site['label'],path=path,bounds=bounds,heightRange=height_range,arrival=site['arrival'],buildings=len({b['id'] for b in site['buildings']}),bytes=len(blob.encode())))
    # Far-body colours remain available even while the detailed facade recipe is evicted.
    palette=['#cfc6b4','#b3b8b5','#ab9181','#e1d9c9','#8c9c9c']
    manifest['bodyColours']={b['id']:palette[b['seed']%5] for site in sites for b in site['buildings']}
    (root/'derived/facade-sites.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2))
    s['facadeSites']='facade-sites.json';(root/'derived/study.json').write_text(json.dumps(study,ensure_ascii=False,indent=2))
    print(json.dumps(manifest,ensure_ascii=False,indent=2))

if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--root',type=Path,required=True);main(p.parse_args().root)
