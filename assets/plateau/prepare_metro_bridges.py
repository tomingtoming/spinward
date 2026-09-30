"""Viaducts across the windows at verified source cuts, and window upkeep.

toming chose short-span viaducts (no navigation clearance is needed over a
window) and window maintenance crawlers running along the glass (2026-09-30).
Each viaduct carries one real line straight across the window at the cut's
edge height, which both strips share. Coordinates are in the first strip's
source frame; the window lies beyond its +x edge.
"""
import argparse
import json
import math
from pathlib import Path

from metro_geometry import Grid

# (line, operator, deck width m, visual tracks). The Arakawa deck's rails come
# from the tram service itself.
LINES = [('山手線', '東日本旅客鉄道', 11.0, 2), ('荒川線', '東京都', 8.0, 0)]
NAMES = {'山手線': '山手線', '荒川線': '都電荒川線'}
WINDOWS = [('east', 'central')]


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
    half = next(b for b in plan['bands'] if b['id'] == 'east')['bounds'][2]
    window = 2 * math.pi * study['radius'] / 6
    assert abs(window - 2 * half) < 1e-6
    bridges = []
    for first, second in WINDOWS:
        for line, operator, width, tracks in LINES:
            cut = next(c for c in source['windowConnections']['candidates'] if c['line'] == line
                       and c.get('operator') == operator and [s['band'] for s in c['sides']] == [first, second])
            a, b = cut['sides']
            assert a['local'][0] > 0 > b['local'][0] and abs(a['local'][1] - b['local'][1]) < 1e-6
            height = float(Grid(root, first).height(*a['local']))
            assert abs(height - float(Grid(root, second).height(*b['local']))) < .01
            bridges.append(dict(id=f"{first}-{second}-{cut['sourceTrack']}", name=NAMES[line], line=line,
                                band=first, far=second, sourceTrack=cut['sourceTrack'], y=round(a['local'][1], 3),
                                x0=round(half, 3), x1=round(half + window, 3), height=round(height, 3),
                                width=width, tracks=tracks))
            print(line, 'y', round(a['local'][1], 1), 'height', round(height, 2))
    result = dict(origin='ai', created='2026-09-30', layout=plan['layout'],
                  radius=study['radius'], span=study['span'],
                  frames=[[s['id'], s['band'], s['frame']] for s in study['samples']],
                  source=dict(alignment=source['source'], receipts=source['sourceReceipts']),
                  pierSpacing=50.0, bridges=bridges,
                  # Axial crawler rails on every window, offset from the pier lines.
                  maintenance=dict(railSpacing=100.0, railOffset=25.0, gauge=2.4, crawlerSpacing=4000.0))
    args.output.write_text(json.dumps(result, ensure_ascii=False, indent=1) + '\n')


if __name__ == '__main__':
    main()
