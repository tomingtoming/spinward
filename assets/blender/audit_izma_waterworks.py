"""Check the saved pipe meshes, connection graph and supported light sources."""
import argparse
from collections import defaultdict
import hashlib
import json
import math
from pathlib import Path
import sys

import bpy
import bmesh
from mathutils.kdtree import KDTree


def audit(candidate):
    assets = candidate / 'assets/blender'
    report = json.loads((assets / 'izma-waterworks.json').read_text())
    plan = json.loads((assets / 'izma-waterworks-plan.json').read_text())
    native = assets / 'izma-waterworks.blend'
    assert hashlib.sha256(native.read_bytes()).hexdigest() == report['nativeSha256']
    bpy.ops.wm.open_mainfile(filepath=str(native))
    scene = bpy.data.scenes['SW_izma_waterworks']
    assert scene['planSha256'] == report['planSha256']
    scene.view_layers[0].update()
    pipes = {obj['waterworks_id']: obj for obj in scene.objects if obj.get('buried')}
    assert len(pipes) == len(report['buriedPipes']) == 36
    mesh_audits, graph = [], defaultdict(set)
    endpoint = lambda p: tuple(round(v, 4) for v in p)
    for contract in report['buriedPipes']:
        obj = pipes[contract['id']]
        centres = contract['profile']
        radius = contract['radius']
        tree = KDTree(len(centres))
        for i, p in enumerate(centres):
            tree.insert(p, i)
        tree.balance()
        error = 0
        for vertex in obj.data.vertices:
            world = obj.matrix_world @ vertex.co
            error = max(error, abs(tree.find((-world.y, world.x, world.z))[2] - radius))
        assert error < .01, ('Native pipe left its specified centreline/radius', obj.name, error)
        bm = bmesh.new()
        try:
            bm.from_mesh(obj.data)
            boundary = [edge for edge in bm.edges if edge.is_boundary]
            assert len(boundary) == 16, ('Open joints or duplicated rings', obj.name, len(boundary))
            assert all(edge.is_manifold or edge.is_boundary for edge in bm.edges)
            seen, pending = set(), [next(iter(bm.verts))]
            while pending:
                vertex = pending.pop()
                if vertex in seen:
                    continue
                seen.add(vertex)
                pending.extend(edge.other_vert(vertex) for edge in vertex.link_edges)
            assert len(seen) == len(bm.verts), ('Disconnected native pipe pieces', obj.name)
        finally:
            bm.free()
        a, b = endpoint(centres[0]), endpoint(centres[-1])
        graph[a].add(b); graph[b].add(a)
        mesh_audits.append({'id': contract['id'], 'vertices': len(obj.data.vertices),
                            'maximumRadiusError': error, 'openEndEdges': 16})
    loops = []
    for band in range(3):
        facilities = [f for f in plan['facilities'] if f['band'] == band]
        pumps = {f['role']: endpoint([f['position'][0] + 43, f['position'][1], f['floor'] + 1.1]) for f in facilities}
        seen, pending = set(), [pumps['recovery']]
        while pending:
            node = pending.pop()
            if node not in seen:
                seen.add(node); pending.extend(graph[node])
        assert pumps['supply'] in seen, ('Recovery/supply pumps do not connect', band)
        for f in facilities:
            branches = [p for p in report['buriedPipes'] if p['facility'] == f['id']]
            assert len(branches) == (4 if f['role'] == 'supply' else 7)
            assert all(endpoint(p['profile'][-1]) in seen for p in branches)
        loops.append({'band': band, 'connectedPumpAndTankEndpoints': len(seen),
                      'returnLength': next(p['length'] for p in report['buriedPipes'] if p['id'] == f'band-{band}-return-main')})
    # Cross-check lights against the independently stored native fixture mesh.
    light_audits = []
    scene.view_layers[0].update()
    for light in [o for o in scene.objects if o.type == 'LIGHT']:
        fixture = next(o for o in scene.objects if o.type == 'MESH' and
                       o.get('waterworks_id') == light['waterworks_id'] and o.get('component') == 'maintenance-lights')
        p = light.matrix_world.translation
        inverse = fixture.matrix_world.inverted()
        hit, location, normal, face = fixture.ray_cast(inverse @ p, (0, 0, 1), distance=.25)
        assert hit, ('Light source without a fixture above it', light.name)
        assert fixture.data.materials[fixture.data.polygons[face].material_index]['spinward_material'] in ['waterworks-lamp', 'waterworks-steel']
        light_audits.append(light.name)
    assert len(light_audits) == len(report['lights'])
    result = {'origin': 'ai', 'created': '2026-09-20', 'nativeSha256': report['nativeSha256'],
              'pipes': mesh_audits, 'loops': loops, 'supportedLights': len(light_audits),
              'burialAudit': plan['burialAudit'],
              'scope': 'native mesh continuity, pump/tank/return connections and sampled cover; hydraulic capacity is not simulated'}
    (candidate / 'waterworks-native-audit.json').write_text(json.dumps(result, indent=2) + '\n')
    print(json.dumps(result), flush=True)


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--candidate-root', type=Path, required=True)
    args = parser.parse_args(sys.argv[sys.argv.index('--') + 1:])
    audit(args.candidate_root)
