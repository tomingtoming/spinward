"""Fit authored cross-town links to existing streets and occupied reservations.

The route choices and intermediate points live in izma-district-links.json.
Only attachment positions may slide a short distance along their named parent.
This is an offline authoring aid, not a runtime or random street generator.
"""
import math
from plan_izma_urban import corridor, overlaps, project, ReservationIndex, SPACING


def add_district_links(master, design, streets, districts, fixed_reservations):
    nodes = {n['id']: n for n in master['nodes']}
    roads = {}
    for route in master['routes']:
        points = [nodes[n] for n in route['nodes']]
        if len({p['band'] for p in points}) != 1:
            continue
        band = points[0]['band']
        roads[route['id']] = {**route, 'band': band,
            'points': [[p['xy'][0] + band * SPACING, p['xy'][1]] for p in points]}
    roads.update({s['id']: s for s in streets})
    rejected = []
    for district in master['districts']:
        key = district['id']
        if key not in design['districts']:
            continue
        spec = design['districts'][key]
        band = district['band']
        centre = district['centre']
        station = nodes[key + '-station']['xy']
        direction = 1 if centre[0] > station[0] else -1
        world = lambda p: [centre[0] + band * SPACING + direction * p[0], centre[1] + direction * p[1]]
        region = next(d for d in districts if d['id'] == key)
        region['centreLinks'] = []
        region['centrePremise'] = spec['premise']
        reserved = ReservationIndex()
        for polygon in fixed_reservations[band]:
            reserved.append(polygon)
        water = master['water'][band]
        for a, b in zip(water['reach'], water['reach'][1:]):
            reserved.append(corridor([a[0] + band * SPACING, a[1]], [b[0] + band * SPACING, b[1]], water['bankWidth'] * 2 + 8))

        def resolve(name):
            if name.startswith('existing:'): return name[len('existing:'):]
            if name.startswith('@'): return 'urban-' + key + '-link-' + name[1:]
            if name == 'town': return f'band-{band}-town-road'
            return key + '-' + {'station': 'station-road', 'neighbourhood': 'neighbourhood-road',
                'garden': 'garden-lane', 'campus': 'campus-loop', 'access': 'access'}[name]

        def attach(parent, near, slide):
            choices = []
            for a, b in zip(parent['points'], parent['points'][1:]):
                x, y, t = project(*near, a, b)
                choices.append((math.hypot(x - near[0], y - near[1]), a, b, t))
            _, a, b, t = min(choices, key=lambda c: c[0])
            length = math.dist(a, b)
            t = max(.01, min(.99, t + slide / length))
            return [a[k] + (b[k] - a[k]) * t for k in range(2)]

        def clear(points, width, parents):
            def blocked(reason):
                blockers[reason] = blockers.get(reason, 0) + 1
                return False
            # The complete junction edge must fit on the parent carriageway.
            # A wider lane joining a narrow lane obliquely can put an apron
            # corner on grass even when both centrelines intersect exactly.
            aprons = []
            for p, q, parent_id in [(points[0], points[1], parents[0]),
                                     (points[-1], points[-2], parents[-1])]:
                parent = roads[parent_id]
                length = math.dist(p, q)
                if length < 8:
                    return blocked('short-segment')
                tx, ty = (p[0] - q[0]) / length, (p[1] - q[1]) / length
                maximum = .65 if parent_id.startswith('urban-') else 3
                available = []
                for a, b in zip(parent['points'], parent['points'][1:]):
                    if math.dist(project(*p, a, b)[:2], p) > .05:
                        continue
                    span = math.dist(a, b)
                    px, py = (b[0] - a[0]) / span, (b[1] - a[1]) / span
                    sine = abs(tx * py - ty * px)
                    cosine = abs(tx * px + ty * py)
                    if sine < .05:
                        continue
                    available.append((parent['width'] / 2 - .08 - width / 2 * cosine) / sine)
                apron = min(maximum, max(available, default=0))
                if apron < .3:
                    return blocked('junction-width:' + parent_id)
                corners = [[p[0] + tx * apron - ty * side * width / 2,
                            p[1] + ty * apron + tx * side * width / 2] for side in [-1, 1]]
                if not any(all(math.dist(project(*corner, a, b)[:2], corner) <= parent['width'] / 2 - .079
                               for corner in corners)
                           for a, b in zip(parent['points'], parent['points'][1:])):
                    return blocked('junction-width:' + parent_id)
                aprons.append(apron)
            if any(abs(p[0] - band * SPACING) > 3200 * math.pi / 6 - master['edgeReserve']
                   or not district['axial'][0] < p[1] < district['axial'][1] for p in points):
                return blocked('boundary')
            for index, (a, b) in enumerate(zip(points, points[1:])):
                if math.dist(a, b) < 8:
                    return blocked('short-segment')
                shape = corridor(a, b, width + 1.2)
                if reserved.intersects(shape):
                    ids = {i for cell in reserved.keys(shape) for i in reserved.cells.get(cell, [])}
                    hit = next(i for i in sorted(ids) if overlaps(shape, reserved.shapes[i][0]))
                    poly = reserved.shapes[hit][0]
                    x, y = [sum(p[k] for p in poly) / len(poly) for k in range(2)]
                    return blocked(f'reservation at {x:.1f},{y:.1f}')
                for road in roads.values():
                    if road['band'] != band:
                        continue
                    for p, q in zip(road['points'], road['points'][1:]):
                        if not overlaps(shape, corridor(p, q, road['width'] + 1)):
                            continue
                        joins = []
                        if index == 0 and road['id'] == parents[0]: joins.append(a)
                        if index == len(points) - 2 and road['id'] == parents[1]: joins.append(b)
                        if not any(math.dist(project(*j, p, q)[:2], j) < .05 for j in joins):
                            return blocked('road:' + road['id'])
            return aprons

        for authored in spec['links']:
            ident = 'urban-' + key + '-link-' + authored['id']
            parents = [resolve(end[0]) for end in authored['ends']]
            if any(parent not in roads for parent in parents):
                rejected.append({'id': ident, 'district': key, 'reason': 'parent-unavailable'})
                continue
            near = [world(end[1]) for end in authored['ends']]
            width = authored.get('width', spec['width'])
            candidate = None
            blockers = {}
            shifts = [0, 8, -8, 16, -16, 28, -28, 42, -42]
            for left, right in sorted(((a, b) for a in shifts for b in shifts), key=lambda p: abs(p[0]) + abs(p[1])):
                points = [attach(roads[parents[0]], near[0], left), *map(world, authored['via']), attach(roads[parents[1]], near[1], right)]
                aprons = clear(points, width, parents)
                if aprons:
                    candidate = {'id': ident, 'district': key, 'band': band, 'kind': 'local', 'width': width,
                        'points': points, 'connections': parents, 'role': 'district-link',
                        'character': spec['character'], 'purpose': authored['purpose'],
                        'frontageFamilies': authored.get('families', spec['families']),
                        'aprons': aprons,
                        'parents': [p for p in parents if p.startswith('urban-')],
                        'authoring': {'ends': authored['ends'], 'via': authored['via'], 'slides': [left, right]}}
                    break
            if candidate:
                roads[ident] = candidate
                streets.append(candidate)
                region['streets'].append(ident)
                region['centreLinks'].append(ident)
            else:
                rejected.append({'id': ident, 'district': key, 'reason': 'reserved-corridor', 'blockedBy': blockers})
    return rejected
