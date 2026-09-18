"""Author complete replacement blocks before changing the running colony.

The plan lists every displaced parcel explicitly. Runtime integration must
retire those exact saved meshes, paths and lots before adding these buildings.
"""
import hashlib,json,math
from pathlib import Path
from izma_block_parcels import block_boundary,partition,intersection_area
from izma_ground_patches import GroundPatches,area
from izma_street_frontages import clean
from plan_izma_urban import rectangle,project
from colony_manifest_io import read_manifest

ROOT=Path(__file__).resolve().parents[2];ASSETS=ROOT/'assets/blender'


def author():
    names=['izma-block-layouts.json','izma-neighbourhood-parcels.json','izma-parcels.json']
    sources={n:json.loads((ASSETS/n).read_text()) for n in names}
    source=sources['izma-neighbourhood-parcels.json'];streets={p['id']:p for p in source['streets']}
    ground=GroundPatches(read_manifest(ROOT/'src/worlds/generated/izmaColony.json')['base'])
    blocks=[]
    for spec in sources['izma-block-layouts.json']['blocks']:
        outer,parent=[streets[spec[k]] for k in ['outerStreet','returnStreet']]
        polygon,widths=block_boundary(outer,parent);layout=partition(polygon,widths,spec)
        retired=[]
        for p in source['parcels']+sources['izma-parcels.json']['parcels']:
            if p['district']!=spec['district']:continue
            footprint=rectangle(*p['position'],p['yaw'],p['size'][0],p['size'][1])
            overlap=sum(intersection_area(sector,footprint) for sector in layout['sectors'])
            if overlap>.01:
                assert p['id'].startswith('neighbourhood-'),('Primary reservation in replacement block',p['id'])
                assert overlap>p['size'][0]*p['size'][1]*.995,('Partial building retirement',p['id'],overlap)
                retired.append(p['id'])
        profiles=[outer,parent]
        def street_height(q):
            candidates=[]
            for r in profiles:
                for a,b in zip(r['profile'],r['profile'][1:]):
                    x,y,t=project(*q,a,b);candidates.append((math.dist(q,(x,y)),a[2]+(b[2]-a[2])*t))
            return min(candidates)[1]
        for i,p in enumerate(layout['plots']):
            if p['family']=='house':p['floors']=min(p['floors'],3)
            heights=[v[2] for piece in ground.split(p['outline']) for v in piece]
            assert heights and max(heights)-min(heights)<1.5,('Block requires terrain redesign',spec['id'],i)
            road=street_height(p['approach'])+.04;floor=max(max(heights)+.14,road)
            p.update({'id':f'block-{spec["id"]}-{i:03d}','district':spec['district'],'band':spec['band'],
                'floor':floor,'foundationBottom':min(heights)-.2,'height':p['floors']*3.2,
                'entrance':{'start':[*p.pop('approach'),road],'end':[*p.pop('entry'),floor],'width':1.5}})
            assert floor-road<.65,('Block entry needs a different floor',p['id'],floor-road)
        blocks.append({**spec,**layout,'boundary':polygon,'roadWidths':widths,'retiredParcels':retired,
            'siteArea':sum(abs(area(p)) for p in layout['sectors']),
            'buildingArea':sum(p['area'] for p in layout['plots'])})
    result={'origin':'ai','created':'2026-09-18','version':1,'status':'native replacement design; not yet installed in runtime',
        'terrainHash':source['terrainHash'],'dependencies':{n:hashlib.sha256((ASSETS/n).read_bytes()).hexdigest() for n in names},'blocks':blocks}
    (ASSETS/'izma-block-parcels.json').write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n')
    print(json.dumps([{'id':b['id'],'parcels':len(b['plots']),'retired':len(b['retiredParcels']),
        'siteArea':b['siteArea'],'buildingArea':b['buildingArea'],'occupancy':b['buildingArea']/b['siteArea']} for b in blocks],indent=2))
    return result


if __name__=='__main__':author()
