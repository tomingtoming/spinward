# /// script
# requires-python = ">=3.10"
# dependencies = ["shapely==2.1.2"]
# ///
"""Derive connected street blocks before replotting whole district centres.

Run with `uv run assets/blender/plan_izma_city_fabric.py --output <absolute-path>`.
The first result is an authoring candidate, not a runtime scenery replacement.
"""
import argparse
import hashlib
import json
from pathlib import Path
from shapely import LineString, Point, Polygon
from shapely.ops import unary_union
from izma_street_blocks import colony_roads, district_boundary, outline, polygons, street_blocks, SPACING
from plan_izma_urban import rectangle

ROOT = Path(__file__).resolve().parents[2]
ASSETS = ROOT / 'assets/blender'


def author(with_plots=False):
    names = ['izma-colony-plan.json', 'izma-neighbourhood-parcels.json', 'izma-parcels.json',
             'izma-public-spaces.json', 'izma-rail.json', 'izma-block-parcels.json',
             'izma-corner-blocks.json', 'izma-land-use-layout.json', 'izma-transport.json']
    sources = {name: json.loads((ASSETS / name).read_text()) for name in names}
    master = sources[names[0]]
    neighbourhood = sources[names[1]]
    roads = colony_roads(master, neighbourhood)
    original = sources['izma-parcels.json']['parcels']
    reserved = []
    for p in original:
        reserved.append(Polygon(rectangle(*p['position'], p['yaw'], p['size'][0] + 1,
                                          p['size'][1] + 1)))
        reserved.append(LineString([p['access']['start'][:2], p['access']['end'][:2]]).buffer(1.5))
    for p in sources['izma-public-spaces.json']['places']:
        reserved.append(Polygon(rectangle(*p['position'], p['yaw'], p['size'][0] + 2,
                                          p['size'][1] + 2)))
        reserved.append(LineString([p['entry'][:2], p['threshold'][:2]]).buffer(2.5))
    for station in sources['izma-rail.json']['stations']:
        reserved.append(LineString([p[:2] for p in station['approach']]).buffer(2.5))
        reserved.append(Point(*station['position'][:2]).buffer(station['platformLength'] / 2 + 4))
    nodes = {n['id']: n for n in master['nodes']}
    for route in master['routes']:
        if route['kind'] not in ['rail', 'expressway']:
            continue
        points = [nodes[n] for n in route['nodes']]
        if len({p['band'] for p in points}) != 1:
            continue
        shift = points[0]['band'] * SPACING
        reserved.append(LineString([(p['xy'][0] + shift, p['xy'][1]) for p in points]).buffer(route['width'] / 2 + 3))
    for water in master['water']:
        reserved.append(LineString([(x + water['band'] * SPACING, y)
                                    for x, y, _ in water['reach']]).buffer(water['bankWidth'] + 4))
    reserved.append(Polygon(rectangle(0, 0, 0, 700, 860)))
    # Preserve finished replacement blocks and native corner structures.
    for block in sources['izma-block-parcels.json']['blocks']:
        reserved.append(Polygon(block['boundary']))
    for p in sources['izma-corner-blocks.json']['parcels']:
        reserved.append(Polygon(p['outline']).buffer(.5))
    for zone in sources['izma-land-use-layout.json']['zones']:
        if zone['use'] in ['allotments', 'orchard', 'woodland']:
            reserved.extend(Polygon(piece) for piece in zone['pieces'])
    protected = unary_union(reserved)
    districts = []
    for district in master['districts']:
        if district['use'] in ['park', 'farming', 'utility']:
            districts.append({'id': district['id'], 'band': district['band'], 'use': district['use'],
                              'policy': 'retain landscape settlement', 'blocks': []})
            continue
        boundary = district_boundary(district, master)
        candidates = street_blocks([r for r in roads if r['band'] == district['band']], boundary)
        blocks = []
        for block in candidates:
            available = block['site'].difference(protected)
            if available.area < 300:
                continue
            # Only these explicitly listed neighbourhood parcels may be replaced.
            retired = []
            partial = []
            for p in neighbourhood['parcels']:
                if p['district'] != district['id']:
                    continue
                footprint = Polygon(rectangle(*p['position'], p['yaw'], *p['size'][:2]))
                overlap = footprint.intersection(block['site']).area
                if overlap < .01:
                    continue
                if overlap > footprint.area * .995:
                    retired.append(p['id'])
                else:
                    partial.append(p['id'])
                    available = available.difference(footprint.buffer(.6))
                    available = available.difference(LineString([p['access']['start'][:2], p['access']['end'][:2]]).buffer(1.5))
            if available.area < 300:
                continue
            blocks.append({'id': district['id'] + '-' + block['id'], 'district': district['id'],
                           'band': district['band'], 'use': district['use'],
                           'boundary': outline(block['face']), 'site': outline(block['site']),
                           'available': [outline(p) for p in polygons(available)],
                           'edges': block['edges'], 'area': block['site'].area,
                           'availableArea': available.area, 'retiredParcels': sorted(retired),
                           'partialParcels': sorted(partial)})
        districts.append({'id': district['id'], 'band': district['band'], 'use': district['use'],
                          'policy': 'whole blocks with protected public and water reservations', 'blocks': blocks})
    retired_ids = [p for d in districts for b in d['blocks'] for p in b['retiredParcels']]
    assert len(retired_ids) == len(set(retired_ids)), 'A retired parcel must belong to one actual site'
    terrain_hash = None
    if with_plots:
        from izma_city_parcels import allocate
        from izma_city_ground import CityGround
        from colony_manifest_io import read_manifest
        manifest_path = ROOT / 'src/worlds/generated/izmaColony.json'
        base = read_manifest(manifest_path)['base']
        terrain_hash = hashlib.sha256(json.dumps([base['vertices'], base['meshes']['earth']],
                                                 separators=(',', ':')).encode()).hexdigest()
        ground = CityGround(base, neighbourhood, sources['izma-transport.json'])
        for district in districts:
            district['blocks'] = [allocate(b, ground) for b in district['blocks']]
    return {'origin': 'ai', 'created': '2026-09-19', 'version': 1,
            'status': 'street-block authoring candidate; no native/runtime replacement installed',
            'dependencies': {name: hashlib.sha256((ASSETS / name).read_bytes()).hexdigest() for name in names},
            'terrainHash': terrain_hash,
            'districts': districts}


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--plots', action='store_true')
    args = parser.parse_args()
    assert args.output.is_absolute(), 'Use an explicit absolute candidate output path'
    data = author(args.plots)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(data, ensure_ascii=False, indent=2) + '\n')
    print(json.dumps([{'id': d['id'], 'blocks': len(d['blocks']),
                      'area': round(sum(b['area'] for b in d['blocks'])),
                      'available': round(sum(b['availableArea'] for b in d['blocks'])),
                      'plots': sum(len(b.get('plots', [])) for b in d['blocks']),
                      'buildingArea': round(sum(b.get('buildingArea', 0) for b in d['blocks'])),
                      'partialParcels': sum(len(b['partialParcels']) for b in d['blocks'])}
                     for d in data['districts']], indent=2), flush=True)
