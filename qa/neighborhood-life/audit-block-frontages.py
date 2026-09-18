"""Measure saved building frontage beside native local streets.

This is a horizontal design audit, not an image/visibility or reference-density
measurement. Junction openings are included. Distances start at the road edge.
Usage: python3 qa/neighborhood-life/audit-block-frontages.py > /absolute/report.json
"""
import json
import math
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
infill = json.loads((ROOT / 'assets/blender/izma-neighbourhood-parcels.json').read_text())
primary = json.loads((ROOT / 'assets/blender/izma-parcels.json').read_text())
cells = {}

for parcel in [*primary['parcels'], *infill['parcels']]:
    x, y = parcel['position']
    c, s = math.cos(parcel['yaw']), math.sin(parcel['yaw'])
    if 'volumes' in parcel:
        volumes = [v for v in parcel['volumes'] if v[2] == 0]
    else:
        count = 2 if parcel['family'] in ['office', 'civic'] else 1
        volumes = parcel['solids'][1:1 + count]
    for u, v, _, width, depth, height in volumes:
        if height <= 0:
            continue
        centre = (x + c * u - s * v, y + s * u + c * v)
        extent_x, extent_y = abs(c) * width / 2 + abs(s) * depth / 2, abs(s) * width / 2 + abs(c) * depth / 2
        box = (*centre, c, s, width / 2, depth / 2)
        for i in range(math.floor((centre[0] - extent_x) / 64), math.floor((centre[0] + extent_x) / 64) + 1):
            for j in range(math.floor((centre[1] - extent_y) / 64), math.floor((centre[1] + extent_y) / 64) + 1):
                cells.setdefault((parcel['band'], i, j), []).append(box)


def hit(origin, direction, box, limit):
    x, y, c, s, hw, hd = box
    dx, dy = origin[0] - x, origin[1] - y
    local = (c * dx + s * dy, -s * dx + c * dy)
    ray = (c * direction[0] + s * direction[1], -s * direction[0] + c * direction[1])
    near, far = 0, limit
    for p, d, half in zip(local, ray, (hw, hd)):
        if abs(d) < 1e-9:
            if abs(p) > half:
                return False
            continue
        a, b = sorted(((-half - p) / d, (half - p) / d))
        near, far = max(near, a), min(far, b)
        if near > far:
            return False
    return True


def beside(street, point, direction, reach):
    edge = (point[0] + direction[0] * street['width'] / 2, point[1] + direction[1] * street['width'] / 2)
    end = (edge[0] + direction[0] * reach, edge[1] + direction[1] * reach)
    candidates = set()
    for i in range(math.floor(min(edge[0], end[0]) / 64), math.floor(max(edge[0], end[0]) / 64) + 1):
        for j in range(math.floor(min(edge[1], end[1]) / 64), math.floor(max(edge[1], end[1]) / 64) + 1):
            candidates.update(cells.get((street['band'], i, j), []))
    return any(hit(edge, direction, box, reach) for box in candidates)


districts, streets = {}, []
for street in infill['streets']:
    totals = {'length': 0, 'bothSidesWithin8m': 0, 'bothSidesWithin15m': 0, 'neitherSideWithin15m': 0}
    for a, b in zip(street['profile'], street['profile'][1:]):
        dx, dy = b[0] - a[0], b[1] - a[1]
        length = math.hypot(dx, dy)
        if length < 1e-6:
            continue
        point = ((a[0] + b[0]) / 2, (a[1] + b[1]) / 2)
        directions = ((-dy / length, dx / length), (dy / length, -dx / length))
        close = [beside(street, point, direction, 8) for direction in directions]
        wider = [beside(street, point, direction, 15) for direction in directions]
        totals['length'] += length
        totals['bothSidesWithin8m'] += length * all(close)
        totals['bothSidesWithin15m'] += length * all(wider)
        totals['neitherSideWithin15m'] += length * (not any(wider))
    d = districts.setdefault(street['district'], {key: 0 for key in totals})
    for key, value in totals.items():
        d[key] += value
    streets.append({'id': street['id'], 'district': street['district'], **totals})

for value in [*districts.values(), *streets]:
    value['bothSidesWithin15mFraction'] = value['bothSidesWithin15m'] / value['length'] if value['length'] else 0

print(json.dumps({'method': 'Length-weighted native-street segment midpoints, horizontal ground-volume rays normal to the street, including junction openings. Fixed 8/15 m thresholds are Spinward diagnostics, not dimensions measured from the animation.', 'districts': districts, 'streets': streets}, indent=2))
