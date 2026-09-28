"""Choose initial ground-level inspection routes beside real N02 stations."""
import argparse
import json
import math
import sqlite3
from pathlib import Path
from shapely import union_all
from shapely.affinity import translate
from shapely.geometry import box
from audit_metro_coverage import dictionaries
from metro_geometry import Grid
from plan_tokyo_metro import write
from prepare_metro_overview import source_buildings,source_ground
from prepare_walk import choose_route
from geo import Frame


def main():
    parser=argparse.ArgumentParser();parser.add_argument('--root',type=Path,required=True);args=parser.parse_args()
    root=args.root.resolve();plan=json.loads((root/'tokyo-metro-plan.json').read_text())
    rail=json.loads((root/'metro-transport-source.json').read_text())
    buildings=sqlite3.connect(f'file:{root}/metro-source.sqlite?mode=ro',uri=True)
    surfaces=sqlite3.connect(f'file:{root}/metro-surfaces.sqlite?mode=ro',uri=True)
    codes=dictionaries(root);arrivals={}
    if plan.get('layout')=='inland-b':
        destinations=[('east','east','竹橋',None),('central','central','池袋',None),
                      ('west','west','渋谷','shibuya'),('omiya','west','大宮',None),
                      ('saitama-shintoshin','west','さいたま新都心',None)]
    else:destinations=[(b['id'],b['id'],name,None) for b,name in zip(plan['bands'],['四ツ谷','池袋','王子'])]
    for key,region,name,pin in destinations:
        band=next(b for b in plan['bands'] if b['id']==region)
        stations=[s for b in rail['bands'] if b['id']==band['id'] for s in b['stations'] if s['name']==name]
        station=next((s for s in stations if s['operator']=='東日本旅客鉄道'),stations[0])
        x,y=Frame(**band['frame']).place(*plan['sourcePins'][pin]['position']) if pin else station['center']
        bounds=box(x-200,y-200,x+200,y+200).intersection(box(*band['bounds'])).bounds
        ground=source_ground(surfaces,codes,band,bounds)
        roads=union_all([shape for _,_,shape,label in ground if label=='道路用地'])
        water=union_all([shape for _,_,shape,label in ground if label=='水面'])
        obstacles=union_all([b['shape'] for b in source_buildings(buildings,band,bounds)])
        route=choose_route(translate(roads,-x,-y),translate(obstacles,-x,-y),translate(water,-x,-y))
        route['spawn']=[route['spawn'][0]+x,route['spawn'][1]+y]
        route['route']=[[a+x,b+y] for a,b in route['route']]
        route['ground']=Grid(root,band['id']).height(*route['spawn'])
        route.update(label=plan['sourcePins'][pin]['name'] if pin else name+'駅付近',region=region,
                     requestedCenter=[x,y],distanceFromRequestedCenterM=math.dist(route['spawn'],[x,y]),
                     stationSourceId=station['id'],stationCenter=station['center'],
                     status='Source-clear initial ground route; station/public transport adaptation remains')
        arrivals[key]=route
    write(root/'derived'/'metro-arrivals.json',arrivals);print(json.dumps(arrivals,ensure_ascii=False),flush=True)
    buildings.close();surfaces.close()


if __name__=='__main__':main()
