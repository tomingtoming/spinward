"""Bounded, source-connected walking corridors; OSM remains separately licensed.

Topology comes from shared OSM nodes, never geometric line intersections. The
PLATEAU building/water masks reject unsafe source edges. Bridge elevations are
an explicit colony adaptation, not measured OSM/PLATEAU heights.
"""
import argparse
import collections
import hashlib
import heapq
import json
import math
import sqlite3
from pathlib import Path

import numpy as np
from pyproj import Transformer
from shapely import union_all, prepare, segmentize
from shapely.geometry import LineString, Point, box, mapping
from shapely.ops import transform

from audit_metro_coverage import dictionaries
from metro_geometry import Frame, Grid, polygons, save_tile, merge
from metro_surface_details import SurfaceDraper
from prepare_metro_overview import source_buildings, source_ground

WALKWAYS = {'footway', 'pedestrian', 'path'}
STREETS = {'residential', 'unclassified', 'service', 'living_street',
           'primary', 'secondary', 'tertiary', 'primary_link', 'secondary_link', 'tertiary_link'}
PLACES = ['tokyo', 'palace', 'suidobashi']


def accessible(tags):
    if tags.get('highway') not in WALKWAYS | STREETS:
        return False
    if tags.get('foot') in {'no', 'private'} or tags.get('access') in {'no', 'private', 'customers', 'permit'}:
        return False
    if any(k in tags for k in ['opening_hours', 'access:conditional', 'foot:conditional']):
        return False
    if tags.get('area') == 'yes' or tags.get('indoor') == 'yes' or tags.get('tunnel', 'no') != 'no':
        return False
    if tags.get('level', '0') != '0':
        return False
    # Elevated station passages/overpasses need their own ramps/stairs. Only
    # level-1 water bridges are supported by this first corridor release.
    if tags.get('layer', '0') not in {'0', '1'}:
        return False
    return tags.get('layer', '0') == '0' or tags.get('bridge', 'no') != 'no'


def shortest(graph, start, goal):
    cost = {start: 0}; previous = {}; queue = [(0, start)]
    while queue:
        distance, a = heapq.heappop(queue)
        if distance != cost[a]:
            continue
        if a == goal:
            route = []
            while a != start:
                before, edge = previous[a]; route.append((before, a, edge)); a = before
            return route[::-1]
        for b, weight, edge in graph[a]:
            candidate = distance + weight
            if candidate < cost.get(b, math.inf):
                cost[b] = candidate; previous[b] = (a, edge); heapq.heappush(queue, (candidate, b))
    raise ValueError(f'No public source connection: {start} -> {goal}')


def normals(mesh):
    p = mesh['position']; ids = mesh['index'].reshape(-1, 3)
    n = np.cross(p[ids[:, 1]]-p[ids[:, 0]], p[ids[:, 2]]-p[ids[:, 0]])
    result = np.zeros_like(p)
    for i in range(3): np.add.at(result, ids[:, i], n)
    result /= np.maximum(1e-8, np.linalg.norm(result, axis=1))[:, None]
    mesh['normal'] = result.astype('<f4')
    return mesh


def bridge_surface(root, output_prefix, band, grid, route, bridge_way, nodes, edges, roads, obstacle):
    """A source-located road deck with explicitly designed grade/width/rails."""
    selected = next(i for i, (_, _, e) in enumerate(route) if edges[e]['way'] == bridge_way)
    a, b, _ = route[selected]
    source_bridge = LineString([nodes[a], nodes[b]])
    start = selected; end = selected; distance = 0
    while start > 0 and distance < 110:
        start -= 1; aa, bb, _ = route[start]; distance += math.dist(nodes[aa], nodes[bb])
    distance = 0
    while end < len(route)-1 and distance < 110:
        end += 1; aa, bb, _ = route[end]; distance += math.dist(nodes[aa], nodes[bb])
    approach = LineString([nodes[route[start][0]]]+[nodes[bb] for _, bb, _ in route[start:end+1]])
    # Real road footprints bound the adaptation. Do not widen into buildings.
    footprint = approach.buffer(12, cap_style=2, join_style=2).intersection(roads).difference(obstacle)
    centre = np.asarray(source_bridge.coords); direction = centre[-1]-centre[0]
    length = np.linalg.norm(direction); direction /= length
    side = np.array([-direction[1], direction[0]])
    bank_samples = [centre[0]-direction*50, centre[-1]+direction*50]
    deck = max(grid.height(*p) for p in bank_samples)+.20
    along = np.array([approach.project(Point(p)) for p in centre])
    lo, hi = min(along), max(along)
    def height(x, y):
        raw = grid.height(x, y)
        stations = np.array([approach.project(Point(a, b)) for a, b in zip(np.ravel(x), np.ravel(y))]).reshape(np.shape(x))
        envelope = deck-.055*np.maximum(0, np.maximum(lo-stations, stations-hi))
        return np.maximum(raw+.035, envelope)
    draper = SurfaceDraper(grid, footprint.bounds)
    surface = draper.paint(footprint, '#676b6a', lift=0)
    surface['position'][:, 2] = height(*surface['position'][:, :2].T)
    normals(surface)
    underside = {key: value.copy() for key, value in surface.items()}
    underside['position'][:, 2] -= .65
    underside['index'] = underside['index'].reshape(-1, 3)[:, ::-1].reshape(-1)
    normals(underside)
    sides = []
    for poly in polygons(footprint):
        for ring in [poly.exterior, *poly.interiors]:
            points = list(segmentize(ring, 2).coords)
            for p, q in zip(points, points[1:]):
                hp, hq = float(height(*p)), float(height(*q))
                sides.extend([[*p, hp], [*q, hq-.65], [*q, hq], [*p, hp], [*p, hp-.65], [*q, hq-.65]])
    side_positions = np.array(sides, dtype='<f4')
    fascia = normals(dict(position=side_positions, index=np.arange(len(sides), dtype='<u4'), color=np.tile(surface['color'][0]*.85, (len(sides), 1))))
    # Rails run along the water span, with open approach ends. Both rails and
    # deck use the exact same mesh in rendering and physics.
    rail_parts = []
    for sign in [-1, 1]:
        rail_line = LineString(centre+side*sign*11.3)
        rail_shape = rail_line.buffer(.16, cap_style=2).intersection(footprint)
        top = draper.paint(rail_shape, '#a2a89f', lift=0)
        if not top: continue
        top['position'][:, 2] = height(*top['position'][:, :2].T)+1.05
        normals(top); rail_parts.append(top)
        vertices = []
        for poly in polygons(rail_shape):
            ring = list(segmentize(poly.exterior, 2).coords)
            for p, q in zip(ring, ring[1:]):
                hp, hq = float(height(*p)), float(height(*q))
                vertices.extend([[*p, hp], [*q, hq], [*q, hq+1.05], [*p, hp], [*q, hq+1.05], [*p, hp+1.05]])
        if vertices:
            p = np.array(vertices, dtype='<f4'); rail_parts.append(normals(dict(position=p, index=np.arange(len(p), dtype='<u4'), color=np.tile(top['color'][0], (len(p), 1)))))
    meshes = [dict(name='bridge-decks', solid=True, colour='#676b6a', roughness=1, attributes=merge([surface, underside, fascia]))]
    if rail_parts: meshes.append(dict(name='bridge-rails', solid=True, colour='#a2a89f', roughness=1, attributes=merge(rail_parts)))
    descriptor = save_tile(root/'derived', f'{output_prefix}/bridge-{bridge_way}.bin.gz', meshes)
    return dict(id=bridge_way, name='雉子橋', band=band, deckHeightM=deck, widthM=24, approachGrade=.055,
                heightMethod='Designed deck from 50m bank DEM samples + 0.20m; 5.5% approach envelope above unchanged terrain. Not surveyed bridge elevation.',
                bounds=list(footprint.bounds), **descriptor), footprint, height, meshes


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--root', type=Path, required=True)
    parser.add_argument('--source', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args(); root = args.root.resolve()
    plan = json.loads((root/'tokyo-metro-plan.json').read_text())
    band = next(b for b in plan['bands'] if b['id'] == 'east'); frame = Frame(band)
    places = {p['id']: p for p in json.loads(Path('src/worlds/generated/metroPlaces.json').read_text())['places'] if p['id'] in PLACES}
    crop = box(-1300, 15100, 1000, 18700).intersection(box(*band['bounds']))
    surface = sqlite3.connect(f'file:{root}/metro-surfaces.sqlite?mode=ro&immutable=1', uri=True)
    buildings = sqlite3.connect(f'file:{root}/metro-source.sqlite?mode=ro&immutable=1', uri=True)
    ground = source_ground(surface, dictionaries(root), band, crop.bounds)
    roads = union_all([s for _, _, s, label in ground if label == '道路用地'])
    water = union_all([s for _, _, s, label in ground if label == '水面'])
    obstacle = union_all([b['shape'] for b in source_buildings(buildings, band, crop.bounds)]).buffer(.65)
    road_check = roads.buffer(1); connector_check = roads.buffer(.25); water_check = water.buffer(.4)
    for geometry in [obstacle, road_check, connector_check, water_check, water, crop]: prepare(geometry)
    elements = json.loads(args.source.read_text())['elements']
    geo = Transformer.from_crs(4326, 6677, always_xy=True)
    nodes = {e['id']: frame.points(geo.transform(e['lon'], e['lat'])).tolist() for e in elements if e['type'] == 'node'}
    node_tags = {e['id']: e.get('tags', {}) for e in elements if e['type'] == 'node'}
    ways = {}; graph = collections.defaultdict(list); edges = []; rejected = collections.Counter()
    for way in elements:
        tags = way.get('tags', {})
        if way['type'] != 'way' or not accessible(tags):
            continue
        bridge = tags.get('bridge', 'no') != 'no'
        points = [nodes[n] for n in way['nodes']]
        line = LineString(points)
        if not crop.covers(line):
            continue
        # An elevated footway over solid ground is not a water bridge.
        if bridge and not line.intersects(water):
            rejected['non-water bridge'] += 1; continue
        ways[way['id']] = dict(tags=tags, points=points, nodes=way['nodes'])
        for a, b in zip(way['nodes'], way['nodes'][1:]):
            line = LineString([nodes[a], nodes[b]])
            if line.length < .05:
                continue
            if any(node_tags[n].get('barrier') not in {None, 'bollard'} for n in [a, b]):
                rejected['barrier'] += 1; continue
            if line.intersects(obstacle):
                rejected['building'] += 1; continue
            if not bridge and line.intersects(water_check):
                rejected['water'] += 1; continue
            # Source footpaths are permitted on open land; motor streets need
            # PLATEAU road coverage as a second independent footprint check.
            if tags['highway'] not in WALKWAYS and not road_check.covers(line):
                rejected['outside road'] += 1; continue
            edge = len(edges); edges.append(dict(a=a, b=b, way=way['id'], bridge=bridge, crossing=tags.get('footway') == 'crossing'))
            weight = line.length * (1 if tags['highway'] in WALKWAYS else 1.65)
            graph[a].append((b, weight, edge)); graph[b].append((a, weight, edge))
    print('source graph', len(graph), len(edges), dict(rejected), flush=True)
    for pid, place in places.items():
        anchor = -1-PLACES.index(pid); nodes[anchor] = place['spawn']; point = Point(place['spawn'])
        options = sorted((point.distance(Point(nodes[n])), n) for n in graph if n >= 0)
        added = 0
        for distance, n in options:
            if distance > 90: break
            segment = LineString([place['spawn'], nodes[n]])
            if segment.intersects(obstacle) or segment.intersects(water_check) or not connector_check.covers(segment): continue
            edge = len(edges); edges.append(dict(a=anchor, b=n, way=None, bridge=False, crossing=False))
            graph[anchor].append((n, distance, edge)); graph[n].append((anchor, distance, edge)); added += 1
            if added == 12: break
        assert added, f'No clear road connector for {pid}'
        place['node'] = anchor
        print(pid, 'connectors', added, flush=True)
    routes = []
    for start, end in [('tokyo', 'palace'), ('palace', 'suidobashi')]:
        path = shortest(graph, places[start]['node'], places[end]['node'])
        used = [edges[e] for _, _, e in path]
        print(start, end, 'metres', round(sum(math.dist(nodes[a], nodes[b]) for a, b, _ in path)), 'bridge ways', sorted({e['way'] for e in used if e['bridge']}), flush=True)
        routes.append(dict(start=start, end=end, path=path))
    grid = Grid(root, 'east'); bridges = []; bridge_fields = []; bridge_meshes = []
    selected_edges = sorted({e for r in routes for _, _, e in r['path']})
    for wid in sorted({edges[e]['way'] for e in selected_edges if edges[e]['bridge']}):
        route = next(r['path'] for r in routes if any(edges[e]['way'] == wid for _, _, e in r['path']))
        descriptor, footprint, height, meshes = bridge_surface(root, args.output.resolve().parent.relative_to(root/'derived'), band['band'], grid, route, wid, nodes, edges, roads, obstacle)
        bridges.append(descriptor); bridge_fields.append((footprint, height)); bridge_meshes.extend(meshes)
    def point_height(p):
        for footprint, height in bridge_fields:
            if footprint.covers(Point(p)): return float(height(*p))
        return grid.height(*p)
    # Retain original shared-node identity at junctions; dense intermediate
    # vertices follow terrain so the guide never assumes a flat kilometre.
    output_nodes = []; lookup = {}; output_edges = []; source_features = []
    def vertex(key, point):
        if key not in lookup:
            lookup[key] = len(output_nodes); output_nodes.append([*point, point_height(point)])
        return lookup[key]
    route_lines = []
    for e in selected_edges:
        edge = edges[e]; a, b = edge['a'], edge['b']; line = LineString([nodes[a], nodes[b]])
        route_lines.append(line); count = max(1, math.ceil(line.length/6)); previous = vertex(a, nodes[a])
        for i in range(1, count+1):
            point = list(line.interpolate(i/count, normalized=True).coords)[0]
            current = vertex(b if i == count else f'{e}:{i}', point)
            output_edges.append([previous, current, int(edge['crossing']), int(edge['bridge'])]); previous = current
        source_features.append(dict(type='Feature', properties=dict(osmWay=edge['way'], bridge=edge['bridge']), geometry=mapping(line)))
    corridor = union_all(route_lines).buffer(8).intersection(union_all([roads, union_all(route_lines).buffer(1.2)]))
    corridor = corridor.difference(obstacle).difference(water_check.difference(union_all([p for p, _ in bridge_fields])))
    safe = [mapping(p)['coordinates'] for p in polygons(corridor)]
    study = json.loads((root/'derived/metro-overview.json').read_text())
    result = dict(version=1, region='east', band=band['band'], radius=study['radius'], span=study['span'],
                  frames=[[s['id'], s['band'], s['frame']] for s in study['samples']],
                  source=dict(license='OpenStreetMap ODbL 1.0', sha256=hashlib.sha256(args.source.read_bytes()).hexdigest()),
                  nodes=output_nodes, edges=output_edges, walkable=safe, bridges=bridges,
                  places=[dict(id=pid, label=p['label'], node=lookup[p['node']]) for pid, p in places.items()],
                  routes=[dict(start=r['start'], end=r['end'], lengthM=sum(math.dist(nodes[a], nodes[b]) for a, b, _ in r['path'])) for r in routes],
                  limits='Walking corridors only. No road traffic, tunnel routing, inter-band links or full highway reconstruction.')
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(result, ensure_ascii=False, separators=(',', ':'))+'\n')
    # This ODbL derivative is downloadable independently of the application.
    matrix = frame.matrix.T; geo_back = Transformer.from_crs(6677, 4326, always_xy=True)
    from shapely.affinity import affine_transform
    from shapely.geometry import shape
    for feature in source_features:
        projected = affine_transform(shape(feature['geometry']), [*matrix[0], *matrix[1], *frame.origin])
        feature['geometry'] = mapping(transform(geo_back.transform, projected))
    args.output.with_suffix('.geojson').write_text(json.dumps(dict(type='FeatureCollection', license='ODbL-1.0', features=source_features), ensure_ascii=False))
    print('export', len(output_nodes), 'nodes', len(output_edges), 'edges', len(bridges), 'bridges', args.output.stat().st_size, 'bytes', flush=True)


if __name__ == '__main__':
    main()
