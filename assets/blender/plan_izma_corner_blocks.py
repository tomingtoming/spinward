"""Author corner addresses throughout the thirteen existing urban districts."""
import hashlib
import json
import math
from collections import Counter
from pathlib import Path
from colony_manifest_io import read_manifest
from izma_corner_lots import corner_outline,frontage_edges,trim_corner,simplify
from izma_ground_patches import GroundPatches,area
from izma_street_frontages import clean
from plan_izma_urban import SPACING,ReservationIndex,corridor,rectangle,project

ROOT=Path(__file__).resolve().parents[2]
ASSETS=ROOT/'assets/blender'
DEPENDENCIES=['izma-parcels.json','izma-neighbourhood-parcels.json','izma-public-spaces.json',
              'izma-rail.json','izma-street-frontages.json','izma-land-use.json','izma-urban-plan.json','izma-colony-plan.json','izma-transport.json']


def author():
    source={name:json.loads((ASSETS/name).read_text()) for name in DEPENDENCIES}
    neighbours=source['izma-neighbourhood-parcels.json'];master=source['izma-colony-plan.json']
    specs=source['izma-urban-plan.json']['districts'];urban={k for k,v in specs.items() if v['character']!='groves'}
    manifest=read_manifest(ROOT/'src/worlds/generated/izmaColony.json')
    ground=GroundPatches(manifest['base']);reservations=[ReservationIndex() for _ in range(3)]
    def reserve(band,polygon):
        polygon=clean(polygon)
        if polygon:reservations[band].append(polygon)
    for p in source['izma-parcels.json']['parcels']+neighbours['parcels']:
        reserve(p['band'],p.get('lot',{}).get('polygon') or rectangle(*p['position'],p['yaw'],p['size'][0]+1,p['size'][1]+1))
        reserve(p['band'],corridor(p['access']['start'],p['access']['end'],p['access']['width']+1))
    for p in source['izma-public-spaces.json']['places']:
        reserve(p['band'],rectangle(*p['position'],p['yaw'],p['size'][0]+3,p['size'][1]+3))
        reserve(p['band'],corridor(p['entry'],p['threshold'],5))
    for station in source['izma-rail.json']['stations']:
        for a,b in zip(station['approach'],station['approach'][1:]):reserve(station['band'],corridor(a,b,5))
    reserve(0,rectangle(0,0,0,700,860))
    for zone in source['izma-land-use.json']['zones']:
        if zone['use']!='rear-gardens':
            for piece in zone['pieces']:reserve(zone['band'],piece)
        for route in [zone.get('access',{}).get('profile',[]) if zone.get('access') else [],*zone.get('walkProfiles',[])]:
            for a,b in zip(route,route[1:]):reserve(zone['band'],corridor(a,b,3.2))
    for fixture in source['izma-land-use.json']['fixtures']:
        x,y,_=fixture['position'];radius=fixture['clearance']+.6
        reserve(round(x/SPACING),rectangle(x,y,0,radius*2,radius*2))
    # Saved road triangles also reserve curved mitres and junction aprons.
    for packed,names in [(manifest['base'],['local','arterial','walk','water']),
                         (manifest['neighbourhoods']['fixed'],['arch-lane']),
                         (manifest['streetFrontages']['fixed'],['frontage-paving','frontage-rail'])]:
        pool=packed['vertices']
        for name in names:
            ids=packed['meshes'].get(name,[])
            for i in range(0,len(ids),3):
                polygon=[pool[k*3:k*3+2] for k in ids[i:i+3]]
                band=round(sum(p[0] for p in polygon)/3/SPACING)
                if 0<=band<3:reserve(band,polygon)
    routes={r['id']:r for r in master['routes']}
    streets=list(neighbours['streets'])
    for profile in source['izma-transport.json']['profiles']:
        route=routes[profile['id']]
        if route['kind'] not in ['local','arterial']:continue
        band=profile['band']
        streets.append({**route,'band':band,'profile':[[p[0]+band*SPACING,p[1],p[2]] for p in profile['points']],
                        'points':simplify([[p[0]+band*SPACING,p[1]] for p in profile['points']])})
    segments=[[] for _ in range(3)];nearby=[ReservationIndex() for _ in range(3)]
    for s in streets:
        for a,b in zip(s['points'],s['points'][1:]):
            if math.dist(a,b)<.01:continue
            band=s['band'];segments[band].append((a,b,s))
            nearby[band].append(corridor(a,b,1))
    plots=[];seen=set();rejected=Counter()
    for street in neighbours['streets']:
        district=street['district'];band=street['band']
        if district not in urban:continue
        for point in street['points']:
            key=(band,round(point[0],2),round(point[1],2))
            if key in seen:continue
            seen.add(key);rays=[]
            for i in nearby[band].cells.get((math.floor(point[0]/128),math.floor(point[1]/128)),[]):
                a,b,s=segments[band][i]
                if math.dist(project(*point,a,b)[:2],point)>.4:continue
                for q in [a,b]:
                    length=math.dist(q,point)
                    if length<.5:continue
                    direction=tuple((q[k]-point[k])/length for k in range(2))
                    if any(sum(direction[k]*r[1][k] for k in range(2))>.9999 for r in rays):continue
                    rays.append((math.atan2(direction[1],direction[0]),direction,s))
            rays.sort(key=lambda r:r[0])
            for ray_a,ray_b in zip(rays,rays[1:]+rays[:1]):
                polygon,fronts=corner_outline(ray_a[1],ray_b[1],ray_a[2]['width'],ray_b[2]['width'])
                if not polygon:continue
                world=[(p[0]+point[0],p[1]+point[1]) for p in polygon]
                obstacles={i for cell in reservations[band].keys(world) for i in reservations[band].cells.get(cell,[])}
                local_obstacles=[[(q[0]-point[0],q[1]-point[1]) for q in reservations[band].shapes[i][0]] for i in sorted(obstacles)]
                polygon=trim_corner(polygon,local_obstacles,fronts)
                if not polygon:rejected['reserved-or-small']+=1;continue
                world=[(p[0]+point[0],p[1]+point[1]) for p in polygon]
                patches=list(ground.split(world))
                covered=sum(abs(area([p[:2] for p in patch])) for patch in patches)
                if abs(covered-abs(area(world)))>.02:rejected['ground-hole']+=1;continue
                heights=[p[2] for patch in patches for p in patch]
                if max(heights)-min(heights)>1.5:rejected['terrain-grade']+=1;continue
                floor=max(heights)+.14;bottom=min(heights)-.15
                edges=frontage_edges(polygon,fronts)
                # The longer street front owns the entrance. Its path meets
                # the actual graded street profile, not the flat hull below.
                length,edge=max(edges);a,b=world[edge],world[(edge+1)%len(world)]
                mid=[(a[k]+b[k])/2 for k in range(2)];ray=ray_a if edges[0][1]==edge else ray_b
                normal=(b[1]-a[1],a[0]-b[0]);norm=math.hypot(*normal);normal=tuple(v/norm for v in normal)
                start=[mid[k]+normal[k]*2.1 for k in range(2)]
                profile=ray[2]['profile'];nearest=[]
                for p,q in zip(profile,profile[1:]):
                    px,py,t=project(*start,p,q);nearest.append((math.dist((px,py),start),p[2]+(q[2]-p[2])*t))
                road_h=min(nearest)[1]+.05
                if abs(floor-road_h)>.32:rejected['door-grade']+=1;continue
                ident=f'corner-{district}-{len([p for p in plots if p["district"]==district]):03d}'
                token=int.from_bytes(hashlib.sha256(ident.encode()).digest()[:4],'big')
                floors=2+token%3;family='shop-house'
                plot={'id':ident,'district':district,'band':band,'family':family,'outline':world,'floor':floor,
                      'foundationBottom':bottom,'floors':floors,'height':floors*3.2,'frontEdges':[i for _,i in edges],
                      'area':abs(area(polygon)),'junction':point,'routes':[ray_a[2]['id'],ray_b[2]['id']],
                      'entrance':{'start':[*start,road_h],'end':[*mid,floor],'width':1.5},'seed':token}
                plots.append(plot);reserve(band,world);reserve(band,corridor(start,mid,1.8))
    result={'origin':'ai','created':'2026-09-18','version':1,'parcels':plots,'rejected':dict(rejected),
            'dependencies':{name:hashlib.sha256((ASSETS/name).read_bytes()).hexdigest() for name in DEPENDENCIES},
            'terrainHash':neighbours['terrainHash']}
    (ASSETS/'izma-corner-blocks-plan.json').write_text(json.dumps(result,separators=(',',':'))+'\n')
    print(json.dumps({'plots':len(plots),'districts':dict(Counter(p['district'] for p in plots)),'rejected':dict(rejected)},indent=2),flush=True)
    return result


if __name__=='__main__':author()
