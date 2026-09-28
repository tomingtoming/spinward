"""Describe saved city-fabric meshes for the existing neighbourhood exporter."""
import hashlib
import math
from izma_building_forms import building_form


def parcel_contract(native, profiles):
    p = dict(native)
    w, d, _ = p['size']
    seed = int.from_bytes(hashlib.sha256(p['id'].encode()).digest()[:4], 'big')
    floor_h = 3.4 if p['family'] == 'office' else 5.2 if p['family'] == 'warehouse' else 3.2
    form, volumes, roofs = building_form(p['family'], w, d, p['floors'], floor_h, seed, True)
    assert p['form'] == form and p['volumes'] == [list(v) for v in volumes], p['id']
    bottom = p['foundationBottom'] - p['floor']
    p['proxyParts'] = [[0, 0, bottom, w+.5, d+.5, -bottom, 'foundation', 'box']]
    p['solids'] = [[0, 0, bottom, w+.5, d+.5, -bottom]]
    p['balconyGuards'] = []
    for u, v, z, width, depth, height in volumes:
        p['proxyParts'].append([u, v, z, width, depth, height, p['wall'], 'box'])
        p['solids'].append([u, v, bottom, width, depth, z+height-bottom])
    # Facade balconies belong to the first saved volume. Courtyard apartments
    # have a shallower front wing than the single-slab form.
    if p['family'] == 'apartment':
        u, v, z, width, depth, height = volumes[0]
        slab_y = v-depth/2-.8
        for row in range(1, round(height/floor_h)):
            level = z+row*floor_h
            p['proxyParts'].append([u, slab_y, level-.16, width*.92, 1.6, 1.14, p['wall'], 'box'])
            p['balconyGuards'].append([u, slab_y, level, width*.92+.1, 1.6, .98, .1])
    for u, v, z, width, depth, height, shape in roofs:
        p['proxyParts'].append([u, v, z, width, depth, height, p['roof'], shape])
    entry = p['entrance']
    start = entry['start']
    if p.get('entryConnection'):
        a, b = p['entryConnection'][:2]
        start = [(a[k]+b[k])/2 for k in range(3)]
    p['route'] = p['road']
    p['doors'] = [entry['end']]
    p['access'] = {'start': start, 'end': entry['end'], 'width': entry['width'],
                   'stairs': not entry['ramp'],
                   'maximumStep': 0 if entry['ramp'] else abs(entry['end'][2]-entry['start'][2])/entry['steps'],
                   'length': math.dist(start[:2], entry['end'][:2])}
    candidates = []
    for a, b in zip(profiles[p['route']], profiles[p['route']][1:]):
        dx, dy = b[0]-a[0], b[1]-a[1]
        length2 = dx*dx+dy*dy
        if length2 < 1e-12:
            continue
        t = max(0, min(1, ((start[0]-a[0])*dx+(start[1]-a[1])*dy)/length2))
        q = [a[k]+t*(b[k]-a[k]) for k in range(3)]
        candidates.append((math.dist(start[:2], q[:2]), q))
    assert candidates, ('Missing frontage profile', p['id'], p['route'])
    p['frontage'] = min(candidates)[1]
    return p
