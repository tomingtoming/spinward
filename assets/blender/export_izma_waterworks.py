"""Export saved waterworks into an isolated, content-addressed colony package.

The existing composed city and frozen previews are never rewritten. Physical
faces come from the saved near/fixed native objects, independently of which
visual LOD is loaded. Regional compilation is a separate subsequent step.
"""
import argparse
from collections import defaultdict
import hashlib
import json
import math
from pathlib import Path
import sys

import bpy

ASSETS = Path(__file__).resolve().parent
ROOT = ASSETS.parents[1]
sys.path.insert(0, str(ASSETS))
from colony_manifest_io import encoded, read_manifest, write_manifest, write_immutable
from colony_collision_partition import refine_city_ground
from izma_collision_mesh import finalize_packed_collision
from izma_street_frontages import triangle_altitude


def pack(groups, physical=None):
    pool, lookup = [], {}

    def indices(points):
        result = []
        for point in points:
            if point not in lookup:
                lookup[point] = len(pool) // 3
                pool.extend(point)
            result.append(lookup[point])
        return result

    meshes = {name: indices(points) for name, points in groups.items()}
    surfaces = []
    for key, points in (physical or {}).items():
        surfaces.append({'indices': indices(points), 'groundSurface': key[-1],
                         'bounds': [min(p[0] for p in points), min(p[1] for p in points),
                                    max(p[0] for p in points), max(p[1] for p in points)]})
    return {'vertices': pool, 'meshes': meshes, 'surfaces': surfaces}


def export(candidate, output):
    for path in [candidate, output]:
        if not path.is_absolute() or path.resolve() == ROOT:
            raise ValueError('Use separate absolute candidate/output roots')
    native = candidate / 'assets/blender/izma-waterworks.blend'
    report = json.loads(native.with_suffix('.json').read_text())
    plan_path = native.with_name('izma-waterworks-plan.json')
    plan = json.loads(plan_path.read_text())
    assert report['nativeSha256'] == hashlib.sha256(native.read_bytes()).hexdigest()
    assert report['planSha256'] == hashlib.sha256(plan_path.read_bytes()).hexdigest()
    for name, digest in plan['dependencies'].items():
        assert hashlib.sha256((ASSETS / name).read_bytes()).hexdigest() == digest, ('Stale waterworks', name)
    bpy.ops.wm.open_mainfile(filepath=str(native))
    scene = bpy.data.scenes['SW_izma_waterworks']
    assert scene['owner'] == report['owner'] and scene['planSha256'] == report['planSha256']
    scene.view_layers[0].update()
    source = ROOT / 'src/worlds/generated/izmaColony.json'
    manifest = read_manifest(source)
    before = hashlib.sha256(encoded(manifest)).hexdigest()
    base = manifest['base']
    earth = [base['vertices'][i * 3:i * 3 + 3] for i in base['meshes']['earth']]
    assert hashlib.sha256(encoded(earth)).hexdigest() == plan['earthSha256']
    manifest['tiles'] = [tile for tile in manifest['tiles'] if not tile.get('waterworks')]
    manifest['visits'] = {name: point for name, point in manifest['visits'].items() if not name.startswith('waterworks-')}
    geometry = {f['id']: [defaultdict(list) for _ in range(3)] for f in plan['facilities']}
    fixed, physical = defaultdict(list), defaultdict(list)
    lights, buried = [], []
    rejected = 0
    for obj in scene.objects:
        if obj.type == 'LIGHT':
            assert obj['waterworks_id'] in geometry and obj.library is None
            p = obj.matrix_world.translation
            lights.append({'position': [-p.y, p.x, p.z], 'color': obj['color'],
                           'intensity': obj['intensity'], 'distance': obj['distance']})
            continue
        if obj.get('buried'):
            assert obj.type == 'MESH' and obj.library is None and obj.data.library is None
            assert not any(f.value for f in obj.data.attributes['physical'].data)
            points = json.loads(obj['centreline'])
            contract = next(p for p in report['buriedPipes'] if p['id'] == obj['waterworks_id'])
            assert contract['profile'] == points and contract['radius'] == obj['radius']
            buried.append(contract)
            continue
        assert obj.type == 'MESH' and obj.get('waterworks_id') in geometry
        assert obj.library is None and obj.data.library is None
        lod, ident = int(obj['lod']), obj['waterworks_id']
        assert lod in [-1, 0, 1, 2]
        mesh = obj.data
        mesh.calc_loop_triangles()
        vertices = []
        for vertex in mesh.vertices:
            p = obj.matrix_world @ vertex.co
            vertices.append(tuple(round(n, 5) for n in (-p.y, p.x, p.z)))
        flags, floors = mesh.attributes['physical'], mesh.attributes['ground_surface']
        for triangle in mesh.loop_triangles:
            points = [vertices[i] for i in triangle.vertices]
            if triangle_altitude(points) <= 1e-6:
                rejected += 1
                continue
            material = mesh.materials[triangle.material_index]['spinward_material']
            target = fixed if lod < 0 else geometry[ident][lod]
            target[material].extend(points)
            if lod <= 0 and flags.data[triangle.polygon_index].value:
                x, y = [sum(p[k] for p in points) / 3 for k in [0, 1]]
                key = (ident, math.floor(x / 32), math.floor(y / 32), bool(floors.data[triangle.polygon_index].value))
                physical[key].extend(points)
    assert rejected == 0, ('Degenerate native waterworks triangles', rejected)
    counts = {'facilities': len(geometry), 'nearTriangles': 0, 'midTriangles': 0,
              'farTriangles': 0, 'fixedTriangles': sum(len(p) // 3 for p in fixed.values())}
    for name, color in report['materials'].items():
        manifest['palette']['waterworks-' + name] = color
    manifest.setdefault('materialDetails', {})['waterworks-lamp'] = {'emission': {'color': '#ffe5b9', 'intensity': .35}}
    fixed_mesh, collision_audit = finalize_packed_collision(refine_city_ground(pack(fixed, physical)))
    counts['collisionTriangles'] = sum(len(s['indices']) // 3 for s in fixed_mesh['surfaces'])
    counts['surfaceGroups'] = len(fixed_mesh['surfaces'])
    # Existing tiles are immutable. Hard-link only their byte-identical payloads
    # into the new package; the manifest writer emits its own immutable parts.
    for tile in manifest['tiles']:
        origin = ROOT / 'public' / tile['url'].lstrip('/')
        target = output / 'public' / tile['url'].lstrip('/')
        target.parent.mkdir(parents=True, exist_ok=True)
        if target.exists():
            assert target.read_bytes() == origin.read_bytes()
        else:
            target.hardlink_to(origin)
    files = []
    for site in plan['facilities']:
        groups = geometry[site['id']]
        assert all(groups)
        data = pack(groups[0])
        data['mid'] = pack(groups[1])
        payload = encoded(data)
        assert len(payload) <= 4 * 1024 * 1024
        ident = 'waterworks-' + site['id']
        filename = ident + '-' + hashlib.sha256(payload).hexdigest()[:12] + '.json'
        url = '/landscapes/izma/' + filename
        write_immutable(output / 'public' / url.lstrip('/'), payload)
        points = [p for values in groups[0].values() for p in values]
        manifest['tiles'].append({'id': ident, 'url': url, 'band': site['band'], 'districts': [],
                                  'bounds': [min(p[0] for p in points), min(p[1] for p in points),
                                             max(p[0] for p in points), max(p[1] for p in points)],
                                  'boxes': [], 'proxyMesh': pack(groups[2]), 'architecture': True, 'waterworks': True})
        x, y = site['localPosition']
        # Arrive beyond the pump house's end, with the tank in view. The east
        # door position looked directly into its wall and concealed the plant.
        manifest['visits'][ident] = {'band': site['band'], 'position': [x + 65, y + 58],
                                    'lookAt': [x - 35, y + 48], 'heightHint': site['floor']}
        for lod, key in enumerate(['nearTriangles', 'midTriangles', 'farTriangles']):
            counts[key] += sum(len(v) // 3 for v in groups[lod].values())
        files.append({'id': ident, 'url': url, 'bytes': len(payload)})
    manifest['waterworks'] = {'version': 1, 'fixed': fixed_mesh, 'counts': counts,
                              'nativeSha256': report['nativeSha256'], 'planSha256': report['planSha256'],
                              'facilities': plan['facilities'], 'loops': plan['loops'],
                              'lights': lights, 'buriedPipes': buried, 'burialAudit': plan['burialAudit']}
    header = output / 'src/worlds/generated/izmaColony.json'
    header.parent.mkdir(parents=True, exist_ok=True)
    result = write_manifest(header, manifest)
    report = {'origin': 'ai', 'created': '2026-09-20', 'sourceBefore': before, **result,
              'counts': counts, 'files': files, 'collisionAudit': collision_audit,
              'status': 'isolated full manifest; regional export and application checks pending'}
    (output / 'waterworks-export.json').write_text(json.dumps(report, indent=2) + '\n')
    print(json.dumps(report), flush=True)


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--candidate-root', type=Path, required=True)
    parser.add_argument('--output-root', type=Path, required=True)
    args = parser.parse_args(sys.argv[sys.argv.index('--') + 1:])
    export(args.candidate_root, args.output_root)
