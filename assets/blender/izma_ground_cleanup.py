"""Discard collapsed native ground faces after export position rounding."""
from izma_street_frontages import triangle_altitude


def clean_ground(packed):
    pool = packed['vertices']
    removed = {'drawingTriangles': 0, 'collisionTriangles': 0, 'emptySurfaceGroups': 0}

    def keep(indices, kind):
        valid = []
        for i in range(0, len(indices), 3):
            triangle = indices[i:i+3]
            points = [pool[j*3:j*3+3] for j in triangle]
            if triangle_altitude(points) <= 1e-6:
                removed[kind] += 1
            else:
                valid.extend(triangle)
        return valid

    meshes = {material: keep(indices, 'drawingTriangles') for material, indices in packed['meshes'].items()}
    surfaces = []
    for surface in packed['surfaces']:
        indices = keep(surface['indices'], 'collisionTriangles')
        if not indices:
            removed['emptySurfaceGroups'] += 1
            continue
        # The old conservative bounds remain valid; do not change regional
        # ownership because one zero-area face at an edge was removed.
        surfaces.append({**surface, 'indices': indices})
    return {**packed, 'meshes': meshes, 'surfaces': surfaces}, removed
