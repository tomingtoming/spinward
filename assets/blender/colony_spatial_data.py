"""Lossless regional drawing and complete collision compounds for the colony.

The full authoring manifest remains authoritative. This derivative deliberately
does not publish a runtime manifest: distant ground and safe arrival must be
connected before the application can discard its global geometry.
"""
import hashlib
import math
from pathlib import Path

from colony_manifest_io import PART_LIMIT, encoded

REGION_SIZE = 512


def fixed_layers(manifest):
    # Discover fixed layers so new pavement/building layers cannot silently be
    # omitted by a stale list maintained separately from the native exporters.
    layers = {'base': manifest['base']}
    layers.update((name, value['fixed']) for name, value in manifest.items()
                  if isinstance(value, dict) and 'fixed' in value)
    for name, packed in layers.items():
        if not all(key in packed for key in ('vertices', 'meshes', 'surfaces')):
            raise ValueError('Invalid fixed colony layer: ' + name)
    return layers


def partition(manifest, cell_size=REGION_SIZE, *, _preserve_surface_ids=False):
    if not math.isfinite(cell_size) or cell_size <= 0:
        raise ValueError('Invalid colony region size')
    regions = {}

    def region(x, y):
        cell = (math.floor(x / cell_size), math.floor(y / cell_size))
        if cell not in regions:
            regions[cell] = {'vertices': [], 'meshes': {}, 'surfaces': [], '_lookup': {}}
        return regions[cell]

    for name, packed in fixed_layers(manifest).items():
        vertices = packed['vertices']
        if len(vertices) % 3 or not all(math.isfinite(v) for v in vertices):
            raise ValueError('Invalid colony vertices: ' + name)
        points = [vertices[i:i + 3] for i in range(0, len(vertices), 3)]
        # Preserve numeric types and signed zero when distinct source vertices
        # have equal Python numeric values. There is no coordinate quantization.
        keys = [encoded(point) for point in points]

        def remap(chunk, indices):
            result = []
            for i in indices:
                if not isinstance(i, int) or isinstance(i, bool) or not 0 <= i < len(points):
                    raise ValueError('Invalid colony vertex index: ' + name)
                key = keys[i]
                if key not in chunk['_lookup']:
                    chunk['_lookup'][key] = len(chunk['vertices']) // 3
                    chunk['vertices'].extend(points[i])
                result.append(chunk['_lookup'][key])
            return result

        for material, indices in packed['meshes'].items():
            if len(indices) % 3:
                raise ValueError('Incomplete drawing triangle: ' + name)
            for j in range(0, len(indices), 3):
                ids = indices[j:j + 3]
                if any(not isinstance(i, int) or isinstance(i, bool) or not 0 <= i < len(points) for i in ids):
                    raise ValueError('Invalid drawing index: ' + name)
                chunk = region(*(sum(points[i][k] for i in ids) / 3 for k in (0, 1)))
                chunk['meshes'].setdefault(material, []).extend(remap(chunk, ids))
        for i, surface in enumerate(packed['surfaces']):
            bounds, indices = surface['bounds'], surface['indices']
            if not indices or len(indices) % 3 or len(bounds) != 4 or not all(math.isfinite(v) for v in bounds) or bounds[0] > bounds[2] or bounds[1] > bounds[3]:
                raise ValueError('Invalid collision compound: ' + name)
            # Keep one physical compound intact even if it spans many regions.
            chunk = region((bounds[0] + bounds[2]) / 2, (bounds[1] + bounds[3]) / 2)
            ident = surface['id'] if _preserve_surface_ids else name + ':' + str(i)
            chunk['surfaces'].append({**surface, 'id': ident,
                                      'indices': remap(chunk, indices)})
    for chunk in regions.values():
        del chunk['_lookup']
    return regions


def write_regions(root, manifest, *, cell_size=REGION_SIZE, byte_limit=PART_LIMIT):
    """Write immutable parts; return descriptors for the later runtime exporter.

    Validate every request size before writing. Existing content-addressed files
    are verified, never overwritten. This function cannot replace the source or
    publish a partially assembled runtime index.
    """
    def bounded(ident, packed, size, depth=0):
        data = encoded(packed)
        if len(data) > byte_limit:
            if depth >= 8:
                raise ValueError(f'Colony region {ident} exceeds request budget: {len(data)} > {byte_limit}; indivisible collision compounds remain intact')
            # Dense city blocks need smaller requests than open countryside.
            # Repartition drawing triangles and whole physical compounds by
            # their original coordinates; never renumber a surface's identity.
            children = partition({'base': packed}, size / 2, _preserve_surface_ids=True)
            for cell, child in sorted(children.items()):
                suffix = '-'.join(str(v).replace('-', 'n') for v in cell)
                yield from bounded(ident + '-q-' + suffix, child, size / 2, depth + 1)
            return
        yield ident, packed, data

    prepared = []
    regions = partition(manifest, cell_size)
    candidates = (candidate for cell, packed in sorted(regions.items())
                  for candidate in bounded('region-' + '-'.join(str(v).replace('-', 'n') for v in cell), packed, cell_size))
    for ident, packed, data in candidates:
        digest = hashlib.sha256(data).hexdigest()
        url = '/landscapes/izma/data-' + digest + '.json'
        vertices = packed['vertices']
        surfaces = []
        for surface in packed['surfaces']:
            # Region selection uses complete compound bounds. Finer occupied
            # rectangles belong to the bounded runtime collision cache after
            # the region is ready, not to the permanently resident catalog.
            surfaces.append({**{k: v for k, v in surface.items() if k != 'indices'},
                             'height': max(vertices[i * 3 + 2] for i in surface['indices'])})
        # Original collision bounds may keep more precision than the exported
        # vertices. Cover both; rounding that extra extent away can omit a
        # compound from readiness selection at a region's boundary.
        bounds = [min([*vertices[0::3], *(s['bounds'][0] for s in surfaces)]),
                  min([*vertices[1::3], *(s['bounds'][1] for s in surfaces)]),
                  max([*vertices[0::3], *(s['bounds'][2] for s in surfaces)]),
                  max([*vertices[1::3], *(s['bounds'][3] for s in surfaces)])]
        descriptor = {'id': ident,
                      'url': url, 'bytes': len(data),
                      'bounds': bounds,
                      'maxHeight': max(vertices[2::3]), 'surfaces': surfaces}
        prepared.append((descriptor, packed, data))
    for descriptor, _, data in prepared:
        target = Path(root) / 'public' / descriptor['url'][1:]
        if target.exists():
            if target.read_bytes() != data:
                raise ValueError('Existing colony region has unexpected contents: ' + descriptor['url'])
        else:
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(data)
    return {'format': 'colony-regions-v1', 'cellSize': cell_size,
            'sourceSha256': hashlib.sha256(encoded(manifest)).hexdigest(),
            'layers': list(fixed_layers(manifest)), 'regions': [d for d, _, _ in prepared],
            'counts': {'drawingTriangles': sum(len(ids) // 3 for _, p, _ in prepared for ids in p['meshes'].values()),
                       'collisionTriangles': sum(len(s['indices']) // 3 for _, p, _ in prepared for s in p['surfaces']),
                       'surfaces': sum(len(p['surfaces']) for _, p, _ in prepared),
                       'bytes': sum(d['bytes'] for d, _, _ in prepared)}}
