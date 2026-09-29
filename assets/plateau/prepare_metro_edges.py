"""Terrain height along each Tokyo strip edge beside the windows.

The terrain is an open sheet; its window-side edges stand up to ~43 m above
the structural floor. A retaining wall closes them. Each sample is the
maximum edge height within ±5 m of a 10 m station, so the linearly
interpolated wall top never dips below the terrain edge (the grid rows are
5 m apart, and the edge height is linear between rows).
"""
import argparse
import json
import math
from pathlib import Path

import numpy as np
from metro_geometry import Grid

SPACING = 10.0


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--root', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    root = args.root.resolve()
    plan = json.loads((root / 'tokyo-metro-plan.json').read_text())
    assert plan['layout'] == 'inland-b'
    study = json.loads((root / 'derived/metro-overview.json').read_text())
    edges = []
    for band in plan['bands']:
        x0, y0, x1, y1 = band['bounds']
        grid = Grid(root, band['id'])
        stations = np.arange(y0, y1 + SPACING / 2, SPACING)
        assert math.isclose(stations[-1], y1)
        for side, x in ((-1, x0), (1, x1)):
            samples = [grid.height(np.full(stations.shape, x), np.clip(stations + d, y0, y1)) for d in (-5, 0, 5)]
            top = np.max(samples, axis=0)
            # Decimetres, rounded up so the wall top stays above the terrain.
            edges.append(dict(band=band['id'], side=side, x=x, y0=y0,
                              top=[int(v) for v in np.ceil(top * 10)]))
            print(band['id'], side, 'min', round(float(top.min()), 1), 'max', round(float(top.max()), 1))
    result = dict(origin='ai', created='2026-09-30', layout=plan['layout'],
                  radius=study['radius'], span=study['span'],
                  frames=[[s['id'], s['band'], s['frame']] for s in study['samples']],
                  source=dict(terrain={b['id']: Grid(root, b['id']).meta['sha256'] for b in plan['bands']}),
                  spacing=SPACING, unit='decimetre', edges=edges)
    args.output.write_text(json.dumps(result, separators=(',', ':')) + '\n')


if __name__ == '__main__':
    main()
