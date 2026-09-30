"""Street-tram service on a real N02 alignment across Tokyo source strips.

The Toden Arakawa line runs in the east strip, crosses the east–central
window on a viaduct at the verified source cut, and continues in the central
strip to Waseda. Track geometry is the N02 centreline, resampled; land heights
follow the shared GSI terrain grid, smoothed only along the line. Over the
window the track stays level at the cut's edge height, the viaduct deck.
Points are stored in the first strip's source frame: a later strip's x is
shifted by its arc offset (2πR/3 per strip), so the colony mapping is one
continuous curve. Stops are the N02 stations of the line, projected onto it.
No source tile, road or building is altered.
"""
import argparse
import json
import math
from pathlib import Path

import numpy as np
from metro_geometry import Grid

LINE = dict(id='toden-arakawa', band='east', parts=('east', 'central'), line='荒川線', operator='東京都', name='都電荒川線', color='#3f7f63')
# Land within this distance of a cut blends into the level deck height.
BLEND = 60.0
# Street trams climb about 7% at most (Asukayama); the DEM's cuttings are steeper.
MAX_GRADE = .08
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
    radius = study['radius']
    index = {b['id']: b['band'] for b in plan['bands']}
    shift = {part: (index[part] - index[LINE['band']]) * 2 * math.pi / 3 * radius for part in LINE['parts']}
    grids = {part: Grid(root, part) for part in LINE['parts']}
    ours = lambda item: item['line'] == LINE['line'] and item['operator'] == LINE['operator']

    # Chain each strip, then join consecutive strips across their verified cut.
    pieces, stations, crossings = [], [], []
    for n, part in enumerate(LINE['parts']):
        band = next(b for b in source['bands'] if b['id'] == part)
        bounds = next(b for b in plan['bands'] if b['id'] == part)['bounds']
        points = chain([t for t in band['tracks'] if ours(t)])
        if n:  # enter from the previous strip's side
            cut = next(c for c in source['windowConnections']['candidates'] if c['line'] == LINE['line']
                       and [x['band'] for x in c['sides']] == [LINE['parts'][n-1], part])
            (a, b) = cut['sides']
            assert abs(a['local'][1] - b['local'][1]) < 1e-6
            if np.hypot(*(points[-1] - b['local'])) < np.hypot(*(points[0] - b['local'])):
                points = points[::-1]
            assert np.hypot(*(points[0] - b['local'])) < 1 and np.hypot(*(pieces[-1][-1] - (np.array(a['local']) + [shift[LINE['parts'][n-1]], 0]))) < 1
            x0, x1 = a['local'][0] + shift[LINE['parts'][n-1]], b['local'][0] + shift[part]
            height = float(grids[part].height(*b['local']))
            assert abs(height - float(grids[LINE['parts'][n-1]].height(*a['local']))) < .01
            crossings.append(dict(sourceTrack=cut['sourceTrack'], y=a['local'][1], x0=x0, x1=x1, height=height))
        elif LINE['parts'][1:]:  # leave toward the next strip
            if points[0][0] > points[-1][0]:
                points = points[::-1]
        assert np.all((points[:, 0] >= bounds[0]-1e-6) & (points[:, 0] <= bounds[2]+1e-6))
        pieces.append(points + [shift[part], 0])
        stations += [dict(station, part=part) for station in band['stations'] if ours(station)]
    s, xy = resample(np.vstack(pieces), STEP)

    # Land height per strip; over a window the level deck at the cut height.
    part_of = lambda x: next((p for p in LINE['parts'] if abs(x - shift[p]) <= 1675.5160819145565 + 1e-6), None)
    ground = np.empty(len(s))
    for i, (x, y) in enumerate(xy):
        part = part_of(x)
        ground[i] = grids[part].height(x - shift[part], y) if part else next(c['height'] for c in crossings if c['x0'] <= x <= c['x1'])
    padded = np.pad(ground, MEDIAN, mode='edge')
    median = np.median(np.lib.stride_tricks.sliding_window_view(padded, 2*MEDIAN+1), axis=1)
    padded = np.pad(median, SMOOTH, mode='edge')
    height = np.convolve(padded, np.ones(2*SMOOTH+1)/(2*SMOOTH+1), mode='valid')
    for c in crossings:
        for i, x in enumerate(xy[:, 0]):
            d = max(c['x0'] - x, x - c['x1'], 0)
            if d < BLEND:
                height[i] += (c['height'] - height[i]) * (1 - d / BLEND)
    # Limit the grade: average the tightest envelopes above and below the
    # profile. Each obeys the limit, so their mean does too, and it never
    # leans wholly above or below the ground.
    ds = np.diff(s)
    upper, lower = height.copy(), height.copy()
    for rng in (range(1, len(s)), range(len(s)-2, -1, -1)):
        for i in rng:
            j, d = (i-1, ds[i-1]) if rng.step == 1 else (i+1, ds[i])
            upper[i] = max(upper[i], upper[j] - MAX_GRADE*d)
            lower[i] = min(lower[i], lower[j] + MAX_GRADE*d)
    height = (upper + lower) / 2
    land = np.array([part_of(x) is not None for x in xy[:, 0]])

    stops = []
    for station in stations:
        centre_source = np.array(station['center']) + [shift[station['part']], 0]
        at, offset = project(xy, s, centre_source)
        assert offset < 30, (station['name'], offset)
        centre = np.array([np.interp(at, s, xy[:, 0]), np.interp(at, s, xy[:, 1])])
        i = min(int(np.searchsorted(s, at)), len(s)-1)
        a, b = xy[max(i-1, 0)], xy[min(i+1, len(s)-1)]
        normal = np.array([b[1]-a[1], a[0]-b[0]])/np.hypot(*(b-a))
        grid, dx = grids[station['part']], shift[station['part']]
        edges = [grid.height(*(centre+side*ISLAND_EDGE*normal - [dx, 0])) for side in (-1, 1)]
        stops.append(dict(id=station['id'], name=station['name'], band=station['part'], s=round(at, 3),
                          height=round(float(np.mean(edges)), 3), crossfallM=round(float(edges[1]-edges[0]), 3),
                          center=station['center'], centreOffsetM=round(offset, 2)))
    stops.sort(key=lambda stop: stop['s'])
    # A stop needs a whole car length of track on both sides for the vehicle.
    stops = [stop for stop in stops if 8 <= stop['s'] <= s[-1]-8]
    assert len({stop['name'] for stop in stops}) == len(stops) >= 3

    grade = np.abs(np.diff(height))/np.diff(s)
    result = dict(
        origin='ai', created='2026-09-30', layout=plan['layout'],
        radius=study['radius'], span=study['span'],
        frames=[[sample['id'], sample['band'], sample['frame']] for sample in study['samples']],
        sources=dict(alignment=source['source'], receipts=source['sourceReceipts'],
                     terrain={part: grids[part].meta['sha256'] for part in LINE['parts']}),
        islandEdge=ISLAND_EDGE,
        method=f'N02 centreline chained per strip and joined across verified cuts, resampled every {STEP:g} m; '
               f'GSI grid height with a {2*MEDIAN+1}-sample running median and {2*SMOOTH+1}-sample moving average; '
               f'level at the cut edge height over windows, blended over {BLEND:g} m of land; grade limited to {MAX_GRADE:.0%} '
               'by averaging the tightest envelopes above and below; N02 stops projected onto it.',
        lines=[dict(**{k: LINE[k] for k in ('id', 'band', 'name', 'color', 'operator')},
                    length=round(float(s[-1]), 3),
                    maxGrade=round(float(grade.max()), 4),
                    maxGroundDeviationM=round(float(np.abs(height-ground)[land].max()), 3),
                    crossings=[{k: (round(v, 3) if isinstance(v, float) else v) for k, v in c.items()} for c in crossings],
                    points=[[round(float(a), 3), round(float(x), 3), round(float(y), 3), round(float(h), 3)]
                            for a, (x, y), h in zip(s, xy, height)],
                    stations=stops)])
    args.output.write_text(json.dumps(result, ensure_ascii=False, indent=1)+'\n')
    line = result['lines'][0]
    print(line['name'], line['length'], 'm', len(line['points']), 'points', len(stops), 'stops',
          'max grade', line['maxGrade'], 'max ground deviation', line['maxGroundDeviationM'], 'crossings', line['crossings'])
    for stop in stops:
        print(' ', stop['band'], stop['name'], stop['s'], 'offset', stop['centreOffsetM'], 'crossfall', stop['crossfallM'])


if __name__ == '__main__':
    main()
