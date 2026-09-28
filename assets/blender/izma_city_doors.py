"""The native facade's doorway in unrolled plan coordinates, before allocation."""
import hashlib
import math
from izma_building_forms import building_form


def doorway(polygon, family, floors, parcel_id):
    w, d = math.dist(polygon[0], polygon[1]), math.dist(polygon[1], polygon[2])
    centre = [sum(p[k] for p in polygon) / 4 for k in range(2)]
    nx, ny = [(polygon[3][k] - polygon[0][k]) / d for k in range(2)]
    seed = int.from_bytes(hashlib.sha256(parcel_id.encode()).digest()[:4], 'big')
    floor_h = 3.4 if family == 'office' else (5.2 if family == 'warehouse' else 3.2)
    _, volumes, _ = building_form(family, w, d, floors, floor_h, seed, True)
    main = volumes[0]
    u = -w / 2 + 1.5 if family == 'warehouse' else main[0]
    v = main[1] - main[4] / 2
    return [centre[0] + ny * u + nx * v, centre[1] - nx * u + ny * v]
