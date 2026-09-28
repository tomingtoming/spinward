"""Street-tram service on a real N02 alignment inside one Tokyo source strip.

The first line is the Toden Arakawa line in the east strip. Track geometry is
the N02 centreline, resampled; heights follow the shared GSI terrain grid and
are smoothed only along the line. Stops are the N02 stations of the same line,
projected onto that centreline. No source tile, road or building is altered.
"""
import argparse
import json
import math
from pathlib import Path

import numpy as np
from metro_geometry import Grid

LINE = dict(id='toden-arakawa', band='east', line='荒川線', operator='東京都', name='都電荒川線', color='#3f7f63')
STEP = 4.0
# A ±32 m running median drops narrow structures and channels the DEM sees
# (the JR embankment and Shakujii river beside Oji-ekimae) but keeps ramps.
# A ±12 m moving average then removes 5 m grid steps.
MEDIAN = 8
SMOOTH = 3
# Doors face the centreline; passengers board from a street-level island whose
# edges are this far from it. Stop height averages the ground at both edges,
# because streets can have several percent crossfall.
ISLAND_EDGE = 1.4


def chain(tracks):
    """Join LineStrings end to end. A branch, gap or loop is an error."""
    key = lambda p: (round(p[0], 3), round(p[1], 3))
    ends = {}
    for i, t in enumerate(tracks):
        c = t['geometry']['coordinates']
        for p in (c[0], c[-1]):
            ends.setdefault(key(p), []).append(i)
    assert all(len(v) <= 2 for v in ends.values()), 'branching alignment'
    terminals = [k for k, v in ends.items() if len(v) == 1]
    assert len(terminals) == 2, f'expected one chain, found {len(terminals)} ends'
    start = min(terminals)  # deterministic: lowest source x first
    points, used, here = [list(start)], set(), start
    while len(used) < len(tracks):
        i = next(i for i in ends[here] if i not in used)
        c = [list(p) for p in tracks[i]['geometry']['coordinates']]
        if key(c[0]) != here:
            c.reverse()
        points += c[1:]
        used.add(i)
        here = key(c[-1])
    return np.array(points, dtype=float)


def resample(points, step):
    d = np.r_[0, np.cumsum(np.hypot(*np.diff(points, axis=0).T))]
    s = np.r_[np.arange(0, d[-1], step), d[-1]]
    return s, np.c_[np.interp(s, d, points[:, 0]), np.interp(s, d, points[:, 1])]


def project(xy, s, point):
    """Arc length of the nearest point on the resampled polyline."""
    a, b = xy[:-1], xy[1:]
    ab = b-a
    t = np.clip(((point-a)*ab).sum(1)/np.maximum((ab*ab).sum(1), 1e-12), 0, 1)
    q = a+ab*t[:, None]
    i = int(np.argmin(np.hypot(*(q-point).T)))
    return float(s[i]+t[i]*(s[i+1]-s[i])), float(np.hypot(*(q[i]-point)))


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--root', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    root = args.root.resolve()
    plan = json.loads((root / 'tokyo-metro-plan.json').read_text())
    assert plan['layout'] == 'inland-b'
    study = json.loads((root / 'derived/metro-overview.json').read_text())
    source = json.loads((root / 'metro-transport-source.json').read_text())
    band = next(b for b in source['bands'] if b['id'] == LINE['band'])
    bounds = next(b for b in plan['bands'] if b['id'] == LINE['band'])['bounds']
    tracks = [t for t in band['tracks'] if t['line'] == LINE['line'] and t['operator'] == LINE['operator']]
    stations = [s for s in band['stations'] if s['line'] == LINE['line'] and s['operator'] == LINE['operator']]
    assert tracks and len(stations) >= 3

    s, xy = resample(chain(tracks), STEP)
    assert np.all((xy[:, 0] >= bounds[0]-1e-6) & (xy[:, 0] <= bounds[2]+1e-6))
    ground = Grid(root, LINE['band']).height(xy[:, 0], xy[:, 1])
    padded = np.pad(ground, MEDIAN, mode='edge')
    median = np.median(np.lib.stride_tricks.sliding_window_view(padded, 2*MEDIAN+1), axis=1)
    padded = np.pad(median, SMOOTH, mode='edge')
    height = np.convolve(padded, np.ones(2*SMOOTH+1)/(2*SMOOTH+1), mode='valid')

    grid = Grid(root, LINE['band'])
    stops = []
    for station in stations:
        at, offset = project(xy, s, np.array(station['center']))
        assert offset < 30, (station['name'], offset)
        centre = np.array([np.interp(at, s, xy[:, 0]), np.interp(at, s, xy[:, 1])])
        i = min(int(np.searchsorted(s, at)), len(s)-1)
        a, b = xy[max(i-1, 0)], xy[min(i+1, len(s)-1)]
        normal = np.array([b[1]-a[1], a[0]-b[0]])/np.hypot(*(b-a))
        edges = [grid.height(*(centre+side*ISLAND_EDGE*normal)) for side in (-1, 1)]
        stops.append(dict(id=station['id'], name=station['name'], s=round(at, 3),
                          height=round(float(np.mean(edges)), 3), crossfallM=round(float(edges[1]-edges[0]), 3),
                          center=station['center'], centreOffsetM=round(offset, 2)))
    stops.sort(key=lambda stop: stop['s'])
    # A stop needs a whole car length of track on both sides for the vehicle.
    stops = [stop for stop in stops if 8 <= stop['s'] <= s[-1]-8]
    assert len({stop['name'] for stop in stops}) == len(stops) >= 3

    grade = np.abs(np.diff(height))/np.diff(s)
    result = dict(
        origin='ai', created='2026-09-29', layout=plan['layout'],
        radius=study['radius'], span=study['span'],
        frames=[[sample['id'], sample['band'], sample['frame']] for sample in study['samples']],
        sources=dict(alignment=source['source'], receipts=source['sourceReceipts'],
                     terrain=Grid(root, LINE['band']).meta['sha256']),
        islandEdge=ISLAND_EDGE,
        method=f'N02 centreline chained and resampled every {STEP:g} m; GSI grid height with a '
               f'{2*MEDIAN+1}-sample running median and {2*SMOOTH+1}-sample moving average along the line; '
               'N02 stops projected onto it.',
        lines=[dict(**{k: LINE[k] for k in ('id', 'band', 'name', 'color', 'operator')},
                    length=round(float(s[-1]), 3),
                    maxGrade=round(float(grade.max()), 4),
                    maxGroundDeviationM=round(float(np.abs(height-ground).max()), 3),
                    points=[[round(float(a), 3), round(float(x), 3), round(float(y), 3), round(float(h), 3)]
                            for a, (x, y), h in zip(s, xy, height)],
                    stations=stops)])
    args.output.write_text(json.dumps(result, ensure_ascii=False, indent=1)+'\n')
    line = result['lines'][0]
    print(line['name'], line['length'], 'm', len(line['points']), 'points', len(stops), 'stops',
          'max grade', line['maxGrade'], 'max ground deviation', line['maxGroundDeviationM'])
    for stop in stops:
        print(' ', stop['name'], stop['s'], 'offset', stop['centreOffsetM'], 'crossfall', stop['crossfallM'])


if __name__ == '__main__':
    main()
