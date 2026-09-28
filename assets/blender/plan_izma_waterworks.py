"""Site six water-cycle plants against the saved colony ground and end roads.

Run in an isolated Blender. This adds no terrain cuts and writes to an explicit
candidate root; the application remains on its independently verified package.
"""
import argparse
import hashlib
import json
import math
from pathlib import Path
import sys

ASSETS = Path(__file__).resolve().parent
ROOT = ASSETS.parents[1]
sys.path.insert(0, str(ASSETS))
from colony_manifest_io import read_manifest, encoded


def site_waterworks(output_root):
    from mathutils.bvhtree import BVHTree
    if not output_root.is_absolute() or output_root.resolve() == ROOT:
        raise ValueError('Use a separate absolute candidate root')
    plan = json.loads((ASSETS / 'izma-colony-plan.json').read_text())
    transport = json.loads((ASSETS / 'izma-transport.json').read_text())
    source = read_manifest(ROOT / 'src/worlds/generated/izmaColony.json')
    radius = plan['radius']
    spacing = math.tau * radius / 3
    base = source['base']

    def tree(materials):
        vertices = []
        for name in materials:
            for i in base['meshes'].get(name, []):
                x, y, h = base['vertices'][i * 3:i * 3 + 3]
                vertices.append((math.cos(x / radius) * (radius - h), y,
                                 math.sin(x / radius) * (radius - h)))
        return BVHTree.FromPolygons(vertices, [tuple(range(i, i + 3))
                                   for i in range(0, len(vertices), 3)], all_triangles=True)

    earth = tree(['earth'])
    road = tree(['local', 'arterial', 'walk'])
    river = tree(['water'])

    def height(mesh, band, x, y):
        angle = (x + band * spacing) / radius
        hit = mesh.ray_cast((0, y, 0), (math.cos(angle), 0, math.sin(angle)))[0]
        if hit is None:
            raise ValueError(('No saved supporting surface', band, x, y))
        return radius - math.hypot(hit.x, hit.z)

    facilities = []
    loops = []
    buried_routes = []

    def buried_height(band, x, y):
        # Reserve the entire pipe diameter, including the downhill edge.
        soil = min(height(earth, band, x + dx, y) for dx in [-.75, 0, .75])
        if soil < 4:
            raise ValueError(('Insufficient cover over the structural shell', band, x, y, soil))
        return soil - 3
    for water in plan['water']:
        band = water['band']
        for role, end, direction in [('recovery', 0, -1), ('supply', -1, 1)]:
            wx, wy, wh = water['reach'][end]
            # These are the existing plant reservations, outside the river bank.
            cx, cy = wx + 200, wy
            width, depth = 160, 220
            samples = [[cx + x, cy + y, height(earth, band, cx + x, cy + y)]
                       for x in range(-80, 81, 8) for y in range(-110, 111, 10)]
            floor = max(p[2] for p in samples) + .18
            bottom = min(p[2] for p in samples) - .3
            route_id = f'band-{band}-transfer-access-{0 if end == 0 else 2}'
            route = next(r for r in transport['profiles'] if r['id'] == route_id)
            # A separate service approach meets the existing end cross-road.
            gate = [cx + 65, cy + direction * depth / 2, floor]
            candidates = []
            for a, b in zip(route['points'], route['points'][1:]):
                if abs(b[0] - a[0]) < 1e-8:
                    continue
                t = (gate[0] - a[0]) / (b[0] - a[0])
                if 0 <= t <= 1:
                    candidates.append([gate[0], a[1] + (b[1] - a[1]) * t])
            if not candidates:
                raise ValueError(('No end-road connection', route_id, gate))
            start = min(candidates, key=lambda p: math.dist(p, gate[:2]))
            start.append(height(road, band, *start))
            count = math.ceil(math.dist(start[:2], gate[:2]) / 8)
            profile = []
            for i in range(count + 1):
                t = i / count
                x, y = [start[k] + (gate[k] - start[k]) * t for k in range(2)]
                h = max(max(height(earth, band, x + offset, y) for offset in [-3, 0, 3]) + .05,
                        start[2] + (floor - start[2]) * t)
                if i == 0:
                    h = start[2]
                elif i == count:
                    h = floor
                profile.append([x, y, h])
            maximum_grade = max(abs(b[2] - a[2]) / math.dist(a[:2], b[:2])
                                for a, b in zip(profile, profile[1:]))
            if maximum_grade > .075:
                raise ValueError(('Service road needs a graded alignment', band, role, maximum_grade))
            ident = f'{chr(97 + band)}-{role}'
            # Place the open pipe end inside the actual drawn water, rather
            # than ending outside the bank on the diagram's nominal level.
            port_x, port_y = wx + water['width'] / 2 - 2, wy - direction * 8
            river_port = [port_x, port_y, height(river, band, port_x, port_y) + .15]
            pipe_start = [cx - 72, cy - 102, floor + 1.1]
            pipe_supports = []
            pipe_length = math.dist(pipe_start, river_port)
            for i in range(1, math.ceil(pipe_length / 10)):
                t = min(1, i * 10 / pipe_length)
                point = [pipe_start[k] + (river_port[k] - pipe_start[k]) * t for k in range(3)]
                soil = height(earth, band, *point[:2])
                if point[2] - .65 > soil + .1:
                    pipe_supports.append([point[0] + band * spacing, point[1], soil - .15, point[2] - .6])
            facilities.append({'id': ident, 'band': band, 'role': role,
                               'position': [cx + band * spacing, cy], 'localPosition': [cx, cy],
                               'floor': floor, 'foundationBottom': bottom, 'size': [width, depth],
                               'groundRange': [bottom + .3, floor - .18],
                               'riverPort': [river_port[0] + band * spacing, *river_port[1:]],
                               'pipeSupports': pipe_supports,
                               'serviceAccess': {'road': route_id, 'width': 6,
                                                 'profile': [[x + band * spacing, y, h] for x, y, h in profile],
                                                 'groundEdges': [[height(earth, band, x + side * 3, y)
                                                                  for side in [-1, 1]] for x, y, h in profile],
                                                 'maximumGrade': maximum_grade},
                               'waterLevel': floor + 2.6,
                               'uses': ['river-water circulation', 'maintenance access'],
                               'separateNetworks': ['potable distribution', 'domestic wastewater']})
            pump = [cx + 43, cy]
            connector = [[pump[0], pump[1], floor + 1.1],
                         [pump[0], pump[1], buried_height(band, *pump)]]
            count = math.ceil(abs(1430 - pump[0]) / 16)
            for i in range(1, count + 1):
                x = pump[0] + (1430 - pump[0]) * i / count
                connector.append([x, cy, buried_height(band, x, cy)])
            buried_routes.append({'id': ident + '-return-connector', 'band': band,
                                  'from': ident + '-pump', 'to': f'band-{band}-return-main',
                                  'radius': .65, 'facility': ident, 'riserSegments': 1,
                                  'profile': [[x + band * spacing, y, h] for x, y, h in connector]})
        buried = []
        for y in range(-18200, 18201, 20):
            x = 1430
            buried.append([x + band * spacing, y, buried_height(band, x, y)])
        buried_routes.append({'id': f'band-{band}-return-main', 'band': band,
                              'from': f'{chr(97 + band)}-recovery-return-connector',
                              'to': f'{chr(97 + band)}-supply-return-connector',
                              'radius': .65, 'riserSegments': 0, 'profile': buried})
        loops.append({'band': band, 'name': water['name'],
                      'flow': [f'{chr(97 + band)}-supply', 'river-head', 'river-tail',
                               f'{chr(97 + band)}-recovery', 'pressurized-return', f'{chr(97 + band)}-supply'],
                      'riverDirection': 'positive axial end to negative axial end',
                      'returnMain': {'radius': .65, 'centreDepth': 3, 'profile': buried},
                      'hydraulicCapacity': 'not simulated'})
    cover_samples, minimum_cover = 0, math.inf
    for route in buried_routes:
        band = route['band']
        for segment, (a, b) in enumerate(zip(route['profile'], route['profile'][1:])):
            if segment < route['riserSegments']:
                continue  # The vertical riser terminates inside the pump house.
            count = max(1, math.ceil(math.dist(a, b) / 4))
            for i in range(count + 1):
                p = [a[k] + (b[k] - a[k]) * i / count for k in range(3)]
                for dx in [-.75, 0, .75]:
                    cover = height(earth, band, p[0] - band * spacing + dx, p[1]) - p[2] - route['radius']
                    cover_samples += 1
                    minimum_cover = min(minimum_cover, cover)
                    if cover < 2 or p[2] - route['radius'] < .15:
                        raise ValueError(('Buried main cover/shell clearance', route['id'], p, cover))
    # Check occupied sites, not just the diagram's old reservation boxes.
    obstacles = []
    for name in ['izma-parcels.json', 'izma-city-neighbourhoods.json']:
        for p in json.loads((ASSETS / name).read_text())['parcels']:
            c, s = abs(math.cos(p['yaw'])), abs(math.sin(p['yaw']))
            hx = (c * (p['size'][0] + .5) + s * (p['size'][1] + .5)) / 2
            hy = (s * (p['size'][0] + .5) + c * (p['size'][1] + .5)) / 2
            x, y = p['position']
            obstacles.append((p['id'], [x - hx, y - hy, x + hx, y + hy]))
    for zone in json.loads((ASSETS / 'izma-city-land-use.json').read_text())['zones']:
        for piece in zone['pieces']:
            obstacles.append((zone['id'], [min(p[0] for p in piece), min(p[1] for p in piece),
                                          max(p[0] for p in piece), max(p[1] for p in piece)]))
    for f in facilities:
        x, y = f['position']; w, d = f['size']
        path = f['serviceAccess']['profile']
        bounds = [[x - w / 2, y - d / 2, x + w / 2, y + d / 2],
                  [min(p[0] for p in path) - 3, min(p[1] for p in path),
                   max(p[0] for p in path) + 3, max(p[1] for p in path)]]
        for a in bounds:
            for ident, b in obstacles:
                if a[0] < b[2] and b[0] < a[2] and a[1] < b[3] and b[1] < a[3]:
                    raise ValueError(('Waterworks overlaps an occupied reservation', f['id'], ident))
    dependencies = {name: hashlib.sha256((ASSETS / name).read_bytes()).hexdigest()
                    for name in ['izma-colony-plan.json', 'izma-transport.json',
                                 'izma-city-neighbourhoods.json', 'izma-parcels.json',
                                 'izma-city-land-use.json']}
    # Hash actual drawing coordinates, independent of appended collision vertices.
    earth_points = [base['vertices'][i * 3:i * 3 + 3] for i in base['meshes']['earth']]
    result = {'origin': 'ai', 'created': '2026-09-20', 'version': 1,
              'status': 'candidate sites; occupied reservations and centreline service grades checked',
              'dependencies': dependencies, 'earthSha256': hashlib.sha256(encoded(earth_points)).hexdigest(),
              'facilities': facilities, 'loops': loops, 'buriedRoutes': buried_routes,
              'burialAudit': {'samples': cover_samples, 'minimumCover': minimum_cover,
                              'riserScope': 'above-ground portion inside pump-house envelope'}}
    target = output_root / 'assets/blender/izma-waterworks-plan.json'
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(json.dumps(result, indent=2) + '\n')
    print(json.dumps({'plan': str(target), 'facilities': [{k: f[k] for k in
                      ['id', 'floor', 'groundRange']} for f in facilities]}), flush=True)


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--output-root', type=Path, required=True)
    args = parser.parse_args(sys.argv[sys.argv.index('--') + 1:])
    site_waterworks(args.output_root)
