"""Allocate whole street blocks before detailing individual building facades."""
import hashlib
import heapq
import math
from shapely import LineString, Point, Polygon, constrained_delaunay_triangles
from shapely.ops import unary_union, nearest_points
from shapely.prepared import prep
from izma_street_blocks import polygons, read_outline, outline
from izma_city_doors import doorway


# District-specific premises, in metres. These are construction choices for
# Spinward, not dimensions recovered from the animation.
TYPES = {
    'a-port': ('workshop shop-house apartment warehouse', [12, 18, 24], [18, 26, 30], [2, 3, 4], 2.2),
    'a-old-town': ('shop-house house apartment shop-house', [7.2, 9, 11.6], [17, 22, 26], [2, 3, 4], 1.25),
    'a-river': ('house house apartment shop-house', [8.4, 11, 18], [14, 19, 23], [2, 3, 4], 1.8),
    'a-civic': ('office apartment shop-house civic', [14, 22, 28], [18, 26, 30], [3, 5, 7], 1.8),
    'a-upland': ('house apartment house shop-house', [9, 12, 22], [15, 20, 24], [2, 3, 5], 2.5),
    'b-workshop': ('workshop apartment shop-house warehouse', [12, 18, 24], [18, 25, 30], [2, 3, 5], 2.4),
    'b-campus': ('apartment civic shop-house office', [14, 22, 30], [18, 24, 28], [3, 4, 6], 2.5),
    'b-station': ('shop-house office apartment shop-house', [10, 18, 26], [20, 26, 32], [3, 5, 8], 1.5),
    'b-housing': ('apartment apartment house shop-house', [14, 22, 30], [16, 22, 26], [3, 4, 6], 2.5),
    'b-north': ('apartment house office shop-house', [12, 20, 26], [18, 24, 28], [3, 5, 6], 2),
    'c-cargo': ('workshop warehouse shop-house apartment', [16, 24, 32], [20, 28, 34], [2, 3, 4], 3),
    'c-production': ('workshop shop-house warehouse house', [12, 20, 28], [20, 26, 30], [2, 3, 4], 2.4),
    'c-market': ('shop-house workshop shop-house apartment', [7.5, 9.6, 14], [18, 24, 28], [2, 3, 4], 1.25),
}


def passage_surface(paths):
    """One non-overlapping pavement, including junctions and protected holes."""
    pavement = unary_union([LineString(p['points']).buffer(p['width'] / 2, cap_style='flat',
                                                         join_style='mitre') for p in paths])
    triangles = list(polygons(constrained_delaunay_triangles(pavement)))
    assert abs(sum(p.area for p in triangles) - pavement.area) < 1e-5
    return [[list(p) for p in triangle.exterior.coords[:-1]] for triangle in triangles]


def court_path(available, start, end, half_width=1.6):
    """Visibility graph around actual protected islands, with full path width."""
    clear = available.buffer(-half_width, join_style='mitre')
    regions = [p for p in polygons(clear) if p.buffer(1e-6).covers(Point(start))
               and p.buffer(1e-6).covers(Point(end))]
    if not regions:
        return None
    region = max(regions, key=lambda p: p.area)
    safe = prep(region.buffer(1e-6))
    if safe.covers(LineString([start, end])):
        return [start, end]
    points = [start, end, *[list(p) for ring in [region.exterior, *region.interiors] for p in ring.coords[:-1]]]
    pending = [(0, 0)];distance = {0: 0};previous = {}
    while pending:
        travelled, i = heapq.heappop(pending)
        if travelled != distance[i]:
            continue
        if i == 1:
            ids = [1]
            while ids[-1] != 0:
                ids.append(previous[ids[-1]])
            return [points[n] for n in reversed(ids)]
        for j, p in enumerate(points):
            if j == i:
                continue
            candidate = travelled + math.dist(points[i], p)
            if candidate >= distance.get(j, math.inf) or not safe.covers(LineString([points[i], p])):
                continue
            distance[j] = candidate;previous[j] = i;heapq.heappush(pending, (candidate, j))
    return None


def allocate(block, ground=None):
    available = unary_union([read_outline(p) for p in block['available']])
    families, widths, depths, storeys, setback = TYPES[block['district']]
    families = families.split()
    token = int.from_bytes(hashlib.sha256(block['id'].encode()).digest()[:4], 'big')
    edges = []
    for edge in block['edges']:
        a, b = edge['a'], edge['b']
        length = math.dist(a, b)
        if length < 8:
            continue
        t = ((b[0] - a[0]) / length, (b[1] - a[1]) / length)
        n = (-t[1], t[0])
        face = read_outline(block['boundary'])
        mid = [(a[k] + b[k]) / 2 for k in range(2)]
        if not face.covers(Point(*(mid[k] + n[k] * .1 for k in range(2)))):
            n = tuple(-v for v in n)
        edges.append({**edge, 'length': length, 't': t, 'n': n})
    # Choose openings across the block. Taking just the two longest boundary
    # edges can join adjacent corners and leave the whole interior untouched.
    candidates = []
    gate_area = available
    regions = list(polygons(gate_area.buffer(-1.6, join_style='mitre')))
    for edge in sorted(edges, key=lambda e: -e['length']):
        for fraction in [.5, .3, .7]:
            a, t, n, length = edge['a'], edge['t'], edge['n'], edge['length']
            start = [a[k] + t[k] * length * fraction + n[k] * (edge['width'] / 2 + .3) for k in range(2)]
            end = [start[k] + n[k] * 35 for k in range(2)]
            path = LineString([start, end]).buffer(1.6, cap_style='flat')
            if gate_area.buffer(.08).covers(path):
                if ground and abs(ground.road(start, edge['road'])-ground.ground(start)) > .8:
                    continue
                region = next((i for i, p in enumerate(regions) if p.buffer(1e-6).covers(Point(end))), None)
                if region is not None:
                    candidates.append({'road': edge['road'], 'start': start, 'end': end, 'width': 3.2, 'region': region})
    pairs = [(math.dist(a['end'], b['end']), i, j) for i, a in enumerate(candidates)
             for j, b in enumerate(candidates[:i]) if a['road'] != b['road'] and a['region'] == b['region']]
    if pairs:
        _, i, j = max(pairs)
        gates = [candidates[i], candidates[j]]
    else:
        gates = candidates[:1]
    paths = [[g['start'], g['end']] for g in gates]
    connection = court_path(gate_area, gates[0]['end'], gates[1]['end']) if len(gates) == 2 else None
    if connection:
        paths.append(connection)
        # Larger blocks receive branching alleys when a third opening serves
        # land remote from the first passage. Existing reservations choose the
        # bends; no evenly spaced secondary grid is introduced.
        for _ in range(2 if block['availableArea'] > 36000 else (1 if block['availableArea'] > 18000 else 0)):
            network = unary_union([LineString(p) for p in paths])
            remaining = [g for g in candidates if g['region'] == gates[0]['region']
                         and all(g['road'] != old['road'] for old in gates)]
            if not remaining:
                break
            gate = max(remaining, key=lambda g: Point(g['end']).distance(network))
            if Point(gate['end']).distance(network) < 35:
                break
            target = list(nearest_points(Point(gate['end']), network)[1].coords)[0]
            branch = court_path(gate_area, gate['end'], target)
            if not branch:
                break
            gates.append(gate);paths.append([gate['start'], *branch])
    gates = [{k: v for k, v in g.items() if k != 'region'} for g in gates]
    if ground:
        ground.register_passages(paths, gates, block['id'])
    for i, path in enumerate(paths):
        available = available.difference(LineString(path).buffer(1.6, cap_style='flat', join_style='mitre'))
        for a, b in zip(path, path[1:]):
            length = math.dist(a, b)
            if length < 8:
                continue
            for start, end in [(a, b), (b, a)]:
                t = tuple((end[k] - start[k]) / length for k in range(2))
                edges.append({'a': start, 'b': end, 'road': block['id'] + '-passage-' + str(i),
                              'width': 3.2, 'length': length, 't': t, 'n': (-t[1], t[0]), 'interior': True})
    plots = []
    occupied = []
    # Parcel ends follow the real road angle. Wider commercial streets receive
    # fronts first; subsequent corners fit into the remaining site exactly.
    for edge_index, edge in enumerate(sorted(edges, key=lambda e: (-e['width'], e['road'], tuple(e['a'])))):
        a, t, n, length = edge['a'], edge['t'], edge['n'], edge['length']
        cursor = 1.2
        address = 0
        while length - cursor >= 5:
            seed = token + edge_index * 31 + address * 13
            family = families[seed % len(families)]
            if edge.get('interior'):
                family = (['workshop', 'house'] if block['use'] == 'industry' else ['house', 'apartment'])[seed % 2]
            width = widths[(seed // 3) % len(widths)]
            if family == 'house':
                width = min(width, 9.2 + seed % 5 * .6)
            if family in ['apartment', 'office', 'civic']:
                width = max(width, 12)
            span = min(width, length - cursor - .5)
            if span < 5:
                break
            pavement = 1.8 if edge['width'] >= 5 else 1.45
            front_offset = edge['width'] / 2 + max(setback, pavement + .3)
            accepted = None
            # The range reduces depth at true obstacles instead of clipping a
            # room to an acute needle. A reserved footway/entrance is never lost.
            preferred_depth = depths[(seed // 5) % len(depths)]
            if family == 'house':
                preferred_depth = min(preferred_depth, 15)
            for depth in sorted({preferred_depth, *[d for d in depths if d < preferred_depth], 12, 9}, reverse=True):
                def point(u, v):
                    return [a[k] + t[k] * u + n[k] * v for k in range(2)]
                points = [point(cursor + .4, front_offset), point(cursor + span - .4, front_offset),
                          point(cursor + span - .4, front_offset + depth), point(cursor + .4, front_offset + depth)]
                shape = Polygon(points)
                if not available.covers(shape):
                    continue
                if any(shape.distance(old) < .8 - 1e-6 for old in occupied):
                    continue
                floors = storeys[(seed // 7) % len(storeys)]
                if family == 'house':
                    floors = min(3, floors)
                if family == 'warehouse':
                    floors = min(2, floors)
                parcel_id = block['id'] + f'-{edge_index:02d}-{address:03d}'
                entry = doorway(points, family, floors, parcel_id)
                entry_u = sum((entry[k] - a[k]) * t[k] for k in range(2))
                approach = point(entry_u, edge['width'] / 2 + .3)
                entry_path = LineString([approach, entry]).buffer(.8, cap_style='flat')
                if not available.buffer(.08).covers(entry_path) or any(entry_path.intersects(old) for old in occupied):
                    continue
                if ground and not ground.fits(points, approach, entry, edge['road']):
                    continue
                accepted = {'id': parcel_id, 'outline': points,
                            'front': points[:2], 'entry': entry, 'approach': approach,
                            'family': family, 'floors': floors, 'area': shape.area,
                            'road': edge['road'], 'band': block['band'], 'district': block['district']}
                occupied.append(shape)
                # Keep the door walk available after a subsequent frontage turns
                # into the corner; reserve it independently of wall separation.
                available = available.difference(entry_path)
                break
            if accepted:
                plots.append(accepted)
                cursor += span
            else:
                cursor += min(2, span)
            address += 1
    open_space = available.difference(unary_union(occupied)) if occupied else available
    passages = [{'id': block['id'] + '-passage-' + str(i), 'points': path, 'width': 3.2}
                for i, path in enumerate(paths)]
    return {**block, 'plots': plots, 'gates': gates,
            'passages': passages, 'passagePieces': passage_surface(passages),
            'connectedGates': connection is not None,
            'openSpace': [outline(p) for p in polygons(open_space)],
            'buildingArea': sum(p['area'] for p in plots),
            'status': 'planar parcel candidate; native height and connection checks pending'}
