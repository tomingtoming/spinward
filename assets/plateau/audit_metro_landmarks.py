"""Check adopted places against actual source geometry and generated arrivals."""
import argparse
import json
import math
import sqlite3
from pathlib import Path

from shapely import from_wkb, union_all
from shapely.geometry import Point, Polygon, shape

from audit_metro_coverage import query
from plan_tokyo_metro import write


def audit(root):
    plan=json.loads((root/'tokyo-metro-plan.json').read_text())
    assert plan['layout']=='inland-b'
    arrivals=json.loads((root/'derived/metro-arrivals.json').read_text())
    rail=json.loads((root/'metro-transport-source.json').read_text())
    buildings=sqlite3.connect(f'file:{root}/metro-source.sqlite?mode=ro',uri=True)
    surfaces=sqlite3.connect(f'file:{root}/metro-surfaces.sqlite?mode=ro',uri=True)
    results=[]
    for key,pin in plan['sourcePins'].items():
        band=next(b for b in plan['bands'] if b['id']==pin['band'])
        location=Point(pin['projected']);area=location.buffer(300)
        if key=='imperialPalace':area=shape(next(p for p in plan['protectedAreas'] if p['id']=='imperial-palace-envelope')['geometry'])
        assert Polygon(band['projectedCorners']).covers(area),key
        ground=[]
        for (blob,) in query(surfaces,'surfaces',area,'s.geometry'):
            geometry=from_wkb(blob)
            if geometry.intersects(area):ground.append(geometry.intersection(area))
        covered=union_all(ground).area/area.area
        count=sum(from_wkb(blob).intersects(area) for (blob,) in query(buildings,'buildings',area,'s.footprint'))
        assert covered>.99,(key,'missing ground',covered)
        assert count>0,(key,'missing source buildings')
        results.append(dict(id=key,band=pin['band'],groundCoverageFraction=covered,sourceBuildings=int(count),
                            portDistanceM=20000-pin['local'][1]))
    station_checks=[]
    for name in ['大宮','さいたま新都心']:
        stations=[s for b in rail['bands'] if b['id']=='west' for s in b['stations']
                  if s['name']==name and s['operator']=='東日本旅客鉄道']
        assert stations and not any(s['crossesBoundary'] for s in stations),name
        station_checks.append(dict(name=name,sourceFeatures=len(stations),fullyInside=True))
    spawn=arrivals['west'];pin=plan['sourcePins']['shibuya']
    assert spawn['region']=='west' and math.dist(spawn['spawn'],pin['local'])<30,'Arrival moved away from Shibuya crossing'
    by_id={p['id']:p for p in results}
    assert by_id['imperialPalace']['portDistanceM']<3000
    assert by_id['shibuya']['portDistanceM']<1000
    assert by_id['omiya']['portDistanceM']>28000
    assert not rail['windowConnections']['unmatchedInteriorCuts']
    buildings.close();surfaces.close()
    report=dict(passed=True,landmarks=results,stations=station_checks,shibuyaSpawnDistanceM=math.dist(spawn['spawn'],pin['local']),
                scope='Actual source geometry, station cuts and arrival placement; rendered appearance and walking need browser verification')
    write(root/'landmark-audit.json',report)
    return report


if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--root',type=Path,required=True)
    print(json.dumps(audit(parser.parse_args().root.resolve()),ensure_ascii=False,indent=2))
