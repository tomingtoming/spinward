"""Validate the exported corridor against clear space and its real deck mesh."""
import argparse
import gzip
import json
import struct
from pathlib import Path

import numpy as np
from shapely import STRtree, union_all
from shapely.geometry import LineString, Point, Polygon
from metro_geometry import Grid


def audit(root, path):
    data = json.loads(path.read_text()); study = json.loads((root/'derived/metro-overview.json').read_text())
    assert data['frames'] == [[s['id'], s['band'], s['frame']] for s in study['samples']]
    assert next(s['band'] for s in study['samples'] if s['id'] == data['region']) == data['band']
    domain = union_all([Polygon(p[0], p[1:]) for p in data['walkable']]).buffer(1e-5)
    grid = Grid(root, data['region']); faces = []; triangles = 0
    for bridge in data['bridges']:
        assert bridge['band'] == data['band'], 'Bridge and route are on different bands'
        raw = gzip.decompress((root/'derived'/bridge['path']).read_bytes())
        size = struct.unpack('<I', raw[:4])[0]; header = json.loads(raw[4:4+size]); start = 4+((size+3)//4)*4
        for mesh in header['meshes']:
            attrs = mesh['attributes']
            positions = np.frombuffer(raw, dtype='<f4', count=attrs['position']['count'], offset=start+attrs['position']['offset']).reshape(-1, 3)
            indices = np.frombuffer(raw, dtype='<u4', count=attrs['index']['count'], offset=start+attrs['index']['offset']).reshape(-1, 3)
            triangles += len(indices)
            if mesh['name'] == 'bridge-decks': faces.extend(positions[indices])
    faces = np.array(faces); tree = STRtree([Polygon(f[:, :2]) for f in faces])
    max_slope = 0; max_error = 0
    for a, b, *_ in data['edges']:
        pa, pb = data['nodes'][a], data['nodes'][b]; line = LineString([pa[:2], pb[:2]])
        assert domain.covers(line), f'Route leaves verified clear space: {a}, {b}'
        max_slope = max(max_slope, abs(pa[2]-pb[2])/line.length)
    for point in data['nodes']:
        height = grid.height(*point[:2])
        for i in tree.query(Point(point[:2]), predicate='intersects'):
            face = faces[i]; uv = face[1:, :2]-face[0, :2]
            if abs(np.linalg.det(uv)) < 1e-8: continue
            weights = np.linalg.solve(uv.T, np.array(point[:2])-face[0, :2])
            height = max(height, face[0, 2]+weights@(face[1:, 2]-face[0, 2]))
        max_error = max(max_error, abs(height-point[2]))
    # Much tighter than the guide's 65cm level-transition threshold.
    assert max_error < .08, f'Guide height differs from actual deck triangles: {max_error}'
    assert max_slope < .20, f'Unexpected steep walking segment: {max_slope}'
    return dict(nodes=len(data['nodes']), edges=len(data['edges']), bridges=len(data['bridges']),
                uncoveredEdges=0, structureTriangles=triangles, maximumGuideHeightErrorM=max_error,
                maximumGrade=max_slope, routes=data['routes'])


if __name__ == '__main__':
    parser = argparse.ArgumentParser(); parser.add_argument('--root', type=Path, required=True)
    parser.add_argument('--network', type=Path, required=True); args = parser.parse_args()
    print(json.dumps(audit(args.root, args.network), indent=2))
