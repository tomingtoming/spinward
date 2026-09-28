"""Partition saved geometry without splitting a physical collision compound."""
import hashlib
import json
import math
from pathlib import Path

REGION_SIZE = 512
REGION_BYTES = 2 * 1024 * 1024
LAYERS = ['architecture', 'publicRealm', 'neighbourhoods', 'railways', 'landUse']


def partition_regions(manifest):
    layers = {'base': manifest['base'], **{k: manifest[k]['fixed'] for k in LAYERS if k in manifest}}
    regions = {}

    def region(x, y):
        cell = (math.floor(x / REGION_SIZE), math.floor(y / REGION_SIZE))
        if cell not in regions:
            regions[cell] = {'vertices': [], 'lookup': {}, 'meshes': {}, 'surfaces': []}
        return regions[cell]

    def remap(chunk, vertices, indices):
        result = []
        for i in indices:
            point = tuple(vertices[i * 3:i * 3 + 3])
            if point not in chunk['lookup']:
                chunk['lookup'][point] = len(chunk['vertices']) // 3
                chunk['vertices'].extend(point)
            result.append(chunk['lookup'][point])
        return result

    for name, packed in layers.items():
        vertices = packed['vertices']
        for material, indices in packed['meshes'].items():
            for j in range(0, len(indices), 3):
                ids = indices[j:j + 3]
                chunk = region(sum(vertices[i * 3] for i in ids) / 3, sum(vertices[i * 3 + 1] for i in ids) / 3)
                chunk['meshes'].setdefault(material, []).extend(remap(chunk, vertices, ids))
        for i, surface in enumerate(packed['surfaces']):
            x0, y0, x1, y1 = surface['bounds']
            chunk = region((x0 + x1) / 2, (y0 + y1) / 2)
            chunk['surfaces'].append({**surface, 'id': name + ':' + str(i),
                                      'indices': remap(chunk, vertices, surface['indices'])})
    for chunk in regions.values():
        del chunk['lookup']
    return regions


def export_regions(root, manifest, coarsen):
    from colony_manifest_io import encoded, write_manifest
    root = Path(root)
    regions = partition_regions(manifest)
    descriptors = []
    far_vertices = []
    far_meshes = {}
    far_ranges = {}
    original_draw = original_physics = coarse_count = 0
    for cell, packed in sorted(regions.items()):
        ident = 'region-' + '-'.join(str(n).replace('-', 'n') for n in cell)
        vertices = packed['vertices']
        bounds = [min(vertices[0::3]), min(vertices[1::3]), max(vertices[0::3]), max(vertices[1::3])]
        data = encoded(packed)
        if len(data) > REGION_BYTES:
            raise ValueError(('Repartition region exceeding request budget', ident, len(data)))
        digest = hashlib.sha256(data).hexdigest()
        url = '/landscapes/izma/data-' + digest + '.json'
        target = root / 'public' / url[1:]
        if target.exists():
            if target.read_bytes() != data:
                raise ValueError('Unexpected regional asset: ' + url)
        else:
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(data)
        surfaces = []
        for surface in packed['surfaces']:
            surfaces.append({k: v for k, v in surface.items() if k != 'indices'})
            surfaces[-1]['height'] = max(vertices[i * 3 + 2] for i in surface['indices'])
            original_physics += len(surface['indices']) // 3
        descriptors.append({'id': ident, 'url': url, 'bytes': len(data), 'bounds': bounds,
                            'maxHeight': max(vertices[2::3]), 'surfaces': surfaces})
        ranges = {}
        for material, indices in packed['meshes'].items():
            original_draw += len(indices) // 3
            points, faces = coarsen(vertices, indices)
            offset = len(far_vertices) // 3
            far_vertices.extend(n for point in points for n in point)
            target_indices = far_meshes.setdefault(material, [])
            start = len(target_indices)
            target_indices.extend(offset + i for face in faces for i in face)
            ranges[material] = [start, len(target_indices) - start]
            coarse_count += len(faces)
        far_ranges[ident] = ranges
    runtime = {k: v for k, v in manifest.items() if k not in ['base', *LAYERS]}
    runtime['base'] = {'vertices': far_vertices, 'meshes': far_meshes, 'surfaces': []}
    for layer in LAYERS:
        if layer in manifest:
            runtime[layer] = {k: v for k, v in manifest[layer].items() if k not in ['fixed', 'parcels', 'streets']}
            runtime[layer]['fixed'] = {'vertices': [], 'meshes': {}, 'surfaces': []}
    runtime['streaming'] = {'version': 1, 'cellSize': REGION_SIZE,
                            'sourceSha256': hashlib.sha256(encoded(manifest)).hexdigest(),
                            'regions': descriptors, 'farRanges': far_ranges,
                            'counts': {'drawingTriangles': original_draw, 'physicalTriangles': original_physics,
                                       'farTriangles': coarse_count, 'surfaces': sum(len(d['surfaces']) for d in descriptors)}}
    result = write_manifest(root / 'src/worlds/generated/izmaColonyRuntime.json', runtime)
    result.update(runtime['streaming']['counts'])
    result.update({'regions': len(descriptors), 'regionBytes': sum(d['bytes'] for d in descriptors),
                   'largestRegionBytes': max(d['bytes'] for d in descriptors),
                   'sourceSha256': runtime['streaming']['sourceSha256']})
    return result, runtime
