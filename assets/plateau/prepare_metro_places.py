"""Curated Places arrivals on source-clear roads; never alter the source tiles."""
import argparse
import json
import math
import sqlite3
from pathlib import Path
from shapely import union_all
from shapely.affinity import translate
from shapely.geometry import box, Point
from audit_metro_coverage import dictionaries
from metro_geometry import Grid
from prepare_metro_overview import source_buildings, source_ground
from prepare_walk import choose_route

# Order is shared by the desktop list and two wrist pages. Existing arrival
# routes are retained exactly, including the user's Shibuya spawn.
PLACES = [
    ('shibuya', '渋谷スクランブル交差点', 'west', '渋谷', 'west'),
    ('palace', '皇居・竹橋', 'east', '竹橋', 'east'),
    ('tokyo', '東京駅周辺', 'east', '東京', None),
    ('shinjuku', '新宿駅周辺', 'central', '新宿', None),
    ('ikebukuro', '池袋駅周辺', 'central', '池袋', 'central'),
    ('nakano', '中野駅周辺', 'west', '中野', None),
    ('suidobashi', '水道橋駅周辺', 'east', '水道橋', None),
    ('oji', '王子駅周辺', 'east', '王子', None),
    ('nerima', '練馬駅周辺', 'west', '練馬', None),
    ('kawaguchi', '川口駅周辺', 'east', '川口', None),
    ('minami-urawa', '南浦和駅周辺', 'central', '南浦和', None),
    ('urawa', '浦和駅周辺', 'west', '浦和', None),
    ('saitama-shintoshin', 'さいたま新都心駅周辺', 'west', 'さいたま新都心', 'saitama-shintoshin'),
    ('omiya', '大宮駅周辺', 'west', '大宮', 'omiya'),
    ('iwatsuki', '岩槻駅周辺', 'east', '岩槻', None),
    ('hasuda', '蓮田駅周辺', 'central', '蓮田', None),
]


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--root', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    root = args.root.resolve()
    plan = json.loads((root / 'tokyo-metro-plan.json').read_text())
    assert plan['layout'] == 'inland-b'
    study = json.loads((root / 'derived/metro-overview.json').read_text())
    arrivals = json.loads((root / 'derived/metro-arrivals.json').read_text())
    rail = json.loads((root / 'metro-transport-source.json').read_text())
    buildings = sqlite3.connect(f'file:{root}/metro-source.sqlite?mode=ro', uri=True)
    surfaces = sqlite3.connect(f'file:{root}/metro-surfaces.sqlite?mode=ro', uri=True)
    codes = dictionaries(root)
    places = []
    for key, label, region, name, existing in PLACES:
        band = next(b for b in plan['bands'] if b['id'] == region)
        if existing:
            arrival = dict(arrivals[existing])
        else:
            stations = [s for b in rail['bands'] if b['id'] == region
                        for s in b['stations'] if s['name'] == name]
            station = next((s for s in stations if s['operator'] == '東日本旅客鉄道'), stations[0])
            x, y = station['center']
            bounds = box(x-200, y-200, x+200, y+200).intersection(box(*band['bounds'])).bounds
            ground = source_ground(surfaces, codes, band, bounds)
            roads = union_all([shape for _, _, shape, kind in ground if kind == '道路用地'])
            water = union_all([shape for _, _, shape, kind in ground if kind == '水面'])
            obstacles = union_all([b['shape'] for b in source_buildings(buildings, band, bounds)])
            arrival = choose_route(translate(roads, -x, -y), translate(obstacles, -x, -y), translate(water, -x, -y))
            arrival['spawn'] = [arrival['spawn'][0]+x, arrival['spawn'][1]+y]
            arrival['route'] = [[a+x, b+y] for a, b in arrival['route']]
            arrival.update(ground=Grid(root, region).height(*arrival['spawn']), region=region,
                           requestedCenter=[x, y], distanceFromRequestedCenterM=math.dist(arrival['spawn'], [x, y]),
                           stationSourceId=station['id'], stationCenter=station['center'])
        assert arrival['distanceFromRequestedCenterM'] < 200
        assert arrival['length'] >= 65 and math.isfinite(arrival['ground'])
        assert box(*band['bounds']).buffer(-1).covers(Point(arrival['spawn']))
        places.append(dict(id=key, label=label, **{k: v for k, v in arrival.items() if k != 'label'}))
        print(key, region, round(arrival['distanceFromRequestedCenterM'], 1), 'm from reference', flush=True)
    result = dict(origin='ai', created='2026-09-25', layout=plan['layout'],
                  radius=study['radius'], span=study['span'],
                  frames=[[s['id'], s['band'], s['frame']] for s in study['samples']],
                  sources=['国土数値情報 N02-25 駅', 'PLATEAU 道路用地・建物', 'GSI terrain'],
                  method='Source road inset 0.75m, building clearance 0.6m, water clearance 0.5m; connected 65m route. Palace arrival is outside at Takebashi.',
                  places=places)
    args.output.write_text(json.dumps(result, ensure_ascii=False, indent=2)+'\n')


if __name__ == '__main__':
    main()
