# /// script
# requires-python = ">=3.10"
# dependencies = ["shapely==2.1.2"]
# ///
"""Find IC crossings with retained transport routes before changing the base.

Uses finite road widths and saved profile heights. Native decks and supports
need a second check after the source replacement; this is an early design gate.
"""
import argparse
import bisect
import json
import math
from pathlib import Path
import sys
from shapely import LineString, Point
from shapely.strtree import STRtree

ASSETS=Path(__file__).resolve().parent;ROOT=ASSETS.parents[1]
sys.path.insert(0,str(ASSETS))
from colony_manifest_io import read_manifest


def audit(candidate):
    plan=json.loads((candidate/'assets/blender/izma-motorway-plan.json').read_text())
    master=json.loads((ASSETS/'izma-colony-plan.json').read_text())
    transport=json.loads((ASSETS/'izma-transport.json').read_text())
    source=read_manifest(ROOT/'src/worlds/generated/izmaColony.json')
    widths={r['id']:r['width'] for r in master['routes']};spacing=math.tau*plan['radius']/3
    routes=[]
    for profile in transport['profiles']:
        routes.append({**profile,'points':[[p[0]+profile['band']*spacing,*p[1:]] for p in profile['points']],
                       'width':widths[profile['id']]})
    for street in source['neighbourhoods']['streets']:
        if street['id'] in widths:continue
        routes.append({'id':street['id'],'kind':'local','points':street['profile'],'width':street['width']})
    for r in routes:
        r['line']=LineString([p[:2] for p in r['points']]);r['footprint']=r['line'].buffer(r['width']/2)
        r['along']=[0.]
        for a,b in zip(r['points'],r['points'][1:]):r['along'].append(r['along'][-1]+math.dist(a[:2],b[:2]))
    tree=STRtree([r['footprint'] for r in routes]);crossings=[];failures=[]

    def height(route,point):
        distance=route['line'].project(point);along=route['along']
        i=min(len(along)-2,max(0,bisect.bisect_right(along,distance)-1))
        while i<len(along)-2 and along[i+1]-along[i]<1e-7:i+=1
        a,b=route['points'][i:i+2];t=(distance-along[i])/max(1e-7,along[i+1]-along[i])
        return a[2]+(b[2]-a[2])*t

    for ic in plan['interchanges']:
        for road in ic['roads']:
            line=LineString([p[:2] for p in road['points']]);footprint=line.buffer(road['width']/2)
            along=[0.]
            for a,b in zip(road['points'],road['points'][1:]):along.append(along[-1]+math.dist(a[:2],b[:2]))
            new={**road,'line':line,'along':along}
            retired=ic['id'].removesuffix('-ic')+'-access'
            for index in tree.query(footprint,predicate='intersects'):
                old=routes[index]
                if old['id'] in [retired,f"band-{ic['band']}-expressway"]:continue
                overlap=footprint.intersection(old['footprint'])
                if overlap.area<.05:continue
                parts=list(overlap.geoms) if hasattr(overlap,'geoms') else [overlap]
                samples=[]
                for part in parts:
                    if part.geom_type!='Polygon':continue
                    samples.extend([part.representative_point(),part.centroid])
                    samples.extend(Point(x,y) for x,y in part.exterior.coords)
                clearance=[]
                for point in samples:
                    a,b=height(new,point),height(old,point)
                    upper_thickness=2.4 if a<b and old['kind']=='expressway' else .9
                    clearance.append(abs(a-b)-upper_thickness)
                item={'ic':ic['id'],'newRoad':road['id'],'existingRoad':old['id'],
                      'overlapArea':overlap.area,'minimumProfileClearance':min(clearance),
                      'point':list(overlap.representative_point().coords)[0]}
                crossings.append(item)
                if min(clearance)<6.2:failures.append(item)
    result={'origin':'ai','created':'2026-09-20','scope':'Plan-width crossings against retained transport and neighbourhood streets; native source replacement and supports not certified.',
            'crossings':crossings,'failures':failures}
    (candidate/'assets/blender/izma-motorway-crossings.json').write_text(json.dumps(result,indent=2)+'\n')
    print(json.dumps(result),flush=True)
    if failures:raise ValueError('IC layout conflicts with retained roads')


if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--candidate-root',type=Path,required=True)
    audit(parser.parse_args().candidate_root)
