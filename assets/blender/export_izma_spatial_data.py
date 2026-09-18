"""Build a separate regional package and Blender-derived distant ground.

Run in an isolated Blender with -- --output-root ABSOLUTE_DIRECTORY. The source
manifest and source blend files remain untouched. Publishing the package to the
application also requires the runtime's regional readiness/eviction contract.
"""
import argparse
import hashlib
import json
import math
import sys
from collections import deque
from pathlib import Path

import bpy
import bmesh
from mathutils import Vector
from mathutils.bvhtree import BVHTree

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'assets/blender'))
from colony_manifest_io import encoded, read_manifest, write_manifest
from colony_spatial_data import fixed_layers, write_regions


def on_segment(point, start, end, tolerance=1e-6):
    line = [end[k] - start[k] for k in range(3)]
    offset = [point[k] - start[k] for k in range(3)]
    length_squared = sum(v * v for v in line)
    if length_squared < 1e-16:
        return False
    t = sum(offset[k] * line[k] for k in range(3)) / length_squared
    return 0 <= t <= 1 and sum((offset[k] - line[k] * t) ** 2 for k in range(3)) <= tolerance ** 2


def coarse_mesh(vertices, indices, audit=None, locked_vertices=frozenset()):
    used = sorted(set(indices)); local = {v: i for i, v in enumerate(used)}
    source = [vertices[i * 3:i * 3 + 3] for i in used]
    origin_x = (min(p[0] for p in source) + max(p[0] for p in source)) / 2
    origin_y = (min(p[1] for p in source) + max(p[1] for p in source)) / 2
    radius = 3200
    curved = [((radius - z) * math.cos((x - origin_x) / radius) - radius,
               y - origin_y, (radius - z) * math.sin((x - origin_x) / radius)) for x, y, z in source]
    mesh = bpy.data.meshes.new('regional-ground-candidate')
    mesh.from_pydata(curved, [],
                     [tuple(local[i] for i in indices[j:j + 3]) for j in range(0, len(indices), 3)])
    bm = bmesh.new()
    try:
        bm.from_mesh(mesh)
        source_index = bm.verts.layers.int.new('source_index')
        for i, vertex in enumerate(bm.verts):
            vertex[source_index] = i
        # Simplify the actual cylindrical surface, not a flat map whose new
        # diagonals acquire a different chord height when wrapped afterwards.
        # Non-manifold vertices can join independent garden polygons at a point;
        # they must not enter Blender's vertex-collapse pass.
        bm.normal_update()
        def eligible(vertex):
            if not vertex.is_manifold:
                return False
            if tuple(source[vertex[source_index]]) in locked_vertices:
                return False
            if not vertex.is_boundary:
                return True
            neighbours = [edge.other_vert(vertex) for edge in vertex.link_edges if edge.is_boundary]
            return len(neighbours) == 2 and on_segment(curved[vertex[source_index]],
                curved[neighbours[0][source_index]], curved[neighbours[1][source_index]], tolerance=.005)
        bmesh.ops.dissolve_limit(bm, angle_limit=.005, use_dissolve_boundaries=False,
                                verts=[v for v in bm.verts if eligible(v)],
                                edges=[e for e in bm.edges if e.is_manifold])
        bmesh.ops.triangulate(bm, faces=list(bm.faces))
        bm.verts.ensure_lookup_table(); bm.verts.index_update()
        # Dissolving removes vertices without moving them. Retain exact source
        # coordinates, including shared boundaries, instead of round-tripping
        # through Blender's float32 cylinder positions.
        retained = [v[source_index] for v in bm.verts]
        faces = [tuple(v.index for v in f.verts) for f in bm.faces]
    finally:
        bm.free(); bpy.data.meshes.remove(mesh)
    used = sorted({i for face in faces for i in face})
    local = {i: j for j, i in enumerate(used)}
    retained = [retained[i] for i in used]
    faces = [tuple(local[i] for i in face) for face in faces]
    # Keep validation in the same curved space in which the app renders these
    # faces. Both directions catch removed surfaces and filled-in holes.
    source_map = {v: i for i, v in enumerate(sorted(set(indices)))}
    original = [tuple(source_map[i] for i in indices[j:j + 3]) for j in range(0, len(indices), 3)]
    candidate = [tuple(retained[i] for i in face) for face in faces]
    # A material contains many disconnected gardens, pads and road fragments.
    # Preserve a difficult component without discarding reductions elsewhere.
    parent = list(range(len(source)))
    def root(v):
        while parent[v] != v:
            parent[v] = parent[parent[v]]; v = parent[v]
        return v
    for a, b, c in original:
        parent[root(b)] = root(a); parent[root(c)] = root(a)
    components, coarse_components = {}, {}
    for face in original:
        components.setdefault(root(face[0]), []).append(face)
    for face in candidate:
        if len({root(v) for v in face}) != 1:
            raise ValueError('Simplification connected independent surfaces')
        coarse_components.setdefault(root(face[0]), []).append(face)
    result = {'accepted': True, 'fallbackComponents': 0, 'components': len(components),
              'maxSampleError': 0., 'samples': 0, 'reasons': {}}
    final = []
    for component, original_faces in components.items():
        candidate_faces = coarse_components.get(component, [])
        ids = sorted({i for face in original_faces for i in face})
        remap = {v: i for i, v in enumerate(ids)}
        check = verify_surface([curved[i] for i in ids],
            [tuple(remap[i] for i in f) for f in original_faces],
            [tuple(remap[i] for i in f) for f in candidate_faces])
        if check['accepted']:
            locked_ids = {i for i in ids if tuple(source[i]) in locked_vertices}
            def shared_edges(faces):
                edges = {}
                for face in faces:
                    for a, b in zip(face, face[1:] + face[:1]):
                        if a in locked_ids and b in locked_ids:
                            edge = tuple(sorted((a, b)))
                            edges[edge] = edges.get(edge, 0) + 1
                return {edge for edge, count in edges.items() if count == 1}
            if shared_edges(original_faces) != shared_edges(candidate_faces):
                check['accepted'] = False; check['reason'] = 'shared-edge'
        result['samples'] += check['samples']
        if check['accepted']:
            final.extend(candidate_faces)
            result['maxSampleError'] = max(result['maxSampleError'], check['maxSampleError'])
        else:
            final.extend(original_faces)
            result['accepted'] = False
            result['fallbackComponents'] += 1
            reason = check['reason']
            result['reasons'][reason] = result['reasons'].get(reason, 0) + 1
    if audit is not None:
        audit.update(result)
    used = sorted({i for face in final for i in face}); local = {v: i for i, v in enumerate(used)}
    return [source[i] for i in used], [tuple(local[i] for i in face) for face in final]


def verify_surface(points, original, candidate, tolerance=.10):
    """Boundary identity plus bidirectional sampled distance gate.

    This is not a continuous Hausdorff proof. Every triangle's corners, edge
    midpoints and centroid are sampled in each direction. On failure the full
    original drawing is retained; collision data is never simplified.
    """
    def boundary(faces):
        edges = {}
        for a, b, c in faces:
            for u, v in ((a, b), (b, c), (c, a)):
                edge = (min(u, v), max(u, v))
                edges[edge] = edges.get(edge, 0) + 1
        edges = {edge: count for edge, count in edges.items() if count != 2}
        chains = {edge: set(edge) for edge in edges}
        adjacent = {}
        for a, b in edges:
            adjacent.setdefault(a, set()).add(b)
            adjacent.setdefault(b, set()).add(a)
        pending = deque(sorted(adjacent))
        while pending:
            vertex = pending.popleft()
            neighbours = adjacent.get(vertex, set())
            if len(neighbours) != 2:
                continue
            a, b = sorted(neighbours)
            av, vb, ab = tuple(sorted((a, vertex))), tuple(sorted((vertex, b))), (a, b)
            if edges[av] != 1 or edges[vb] != 1 or ab in edges:
                continue
            # Both contours must reduce to the same segments, with every
            # original subdivision point <=5 mm from that common contour.
            # The two boundaries are then at most 10 mm apart. Check all
            # accumulated points so small successive errors cannot add up.
            combined = chains[av] | chains[vb]
            if not all(on_segment(points[v], points[a], points[b], tolerance=.005) for v in combined):
                continue
            del edges[av], edges[vb]
            del chains[av], chains[vb]
            edges[ab] = 1
            chains[ab] = combined
            del adjacent[vertex]
            adjacent[a].remove(vertex); adjacent[a].add(b)
            adjacent[b].remove(vertex); adjacent[b].add(a)
            pending.extend((a, b))
        return edges
    result = {'accepted': False, 'maxSampleError': 0., 'samples': 0, 'reason': ''}
    if not candidate or len(candidate) > len(original):
        result['reason'] = 'triangle-count'; return result
    if boundary(original) != boundary(candidate):
        result['reason'] = 'boundary'; return result
    vectors = [Vector(point) for point in points]
    for faces, target in ((original, candidate), (candidate, original)):
        tree = BVHTree.FromPolygons(vectors, target, all_triangles=True)
        for face in faces:
            a, b, c = (vectors[i] for i in face)
            normal = (b - a).cross(c - a)
            if normal.length_squared > 1e-16:
                target_normal = tree.find_nearest((a + b + c) / 3)[1]
                if target_normal is None or normal.normalized().dot(target_normal) < .95:
                    result['reason'] = 'winding'; return result
            for point in (a, b, c, (a + b) / 2, (b + c) / 2, (c + a) / 2, (a + b + c) / 3):
                distance = tree.find_nearest(point)[3]
                result['samples'] += 1
                if distance is None or distance > tolerance:
                    result['reason'] = 'surface-distance'; return result
                result['maxSampleError'] = max(result['maxSampleError'], distance)
    result['accepted'] = True
    return result


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--output-root', type=Path, required=True)
    args = parser.parse_args(sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else [])
    output = args.output_root
    if not output.is_absolute() or output.resolve() == ROOT.resolve():
        raise ValueError('Use a separate absolute output root for the candidate package')
    source = read_manifest(ROOT / 'src/worlds/generated/izmaColony.json')
    catalog = write_regions(output, source)
    # A local region may be loaded beside distant neighbours. Shared drawing
    # vertices must survive exactly, irrespective of the far contour tolerance.
    owners, locked = {}, set()
    for region in catalog['regions']:
        packed = json.loads((output / 'public' / region['url'][1:]).read_bytes())
        for i in {i for ids in packed['meshes'].values() for i in ids}:
            point = tuple(packed['vertices'][i * 3:i * 3 + 3])
            if point in owners and owners[point] != region['id']:
                locked.add(point)
            else:
                owners[point] = region['id']
    del owners
    far = {'vertices': [], 'meshes': {}, 'surfaces': []}
    ranges = {}
    audits = []
    for index, region in enumerate(catalog['regions']):
        packed = json.loads((output / 'public' / region['url'][1:]).read_bytes())
        ranges[region['id']] = {}
        for material, indices in packed['meshes'].items():
            (output / 'export-progress.json').write_text(json.dumps({
                'region': region['id'], 'regionIndex': index, 'material': material,
                'sourceTriangles': len(indices) // 3}) + '\n')
            audit = {'region': region['id'], 'material': material, 'sourceTriangles': len(indices) // 3}
            points, faces = coarse_mesh(packed['vertices'], indices, audit, locked)
            audit['farTriangles'] = len(faces)
            audits.append(audit)
            offset = len(far['vertices']) // 3
            far['vertices'].extend(v for point in points for v in point)
            target = far['meshes'].setdefault(material, [])
            start = len(target)
            target.extend(i + offset for face in faces for i in face)
            ranges[region['id']][material] = [start, len(target) - start]
        if index % 100 == 0:
            print(json.dumps({'regionsCompleted': index + 1, 'regionsTotal': len(catalog['regions'])}), flush=True)

    scene = bpy.data.scenes.new('SW_izma_regional_far_ground')
    scene['owner'] = 'spinward-regional-ground-v1'
    scene['source_sha256'] = catalog['sourceSha256']
    scene['coarsen_space'] = 'cylinder'
    bpy.context.window.scene = scene
    for material, indices in far['meshes'].items():
        used = sorted(set(indices)); local = {v: i for i, v in enumerate(used)}
        mesh = bpy.data.meshes.new(material)
        mesh.from_pydata([far['vertices'][i * 3:i * 3 + 3] for i in used], [],
                         [tuple(local[i] for i in indices[j:j + 3]) for j in range(0, len(indices), 3)])
        obj = bpy.data.objects.new(material, mesh); scene.collection.objects.link(obj)
        mat = bpy.data.materials.new(material)
        color = source['palette'][material].lstrip('#')
        mat.diffuse_color = tuple(int(color[k:k + 2], 16) / 255 for k in (0, 2, 4)) + (1,)
        mesh.materials.append(mat)
    blend = output / 'assets/blender/izma-far-ground.blend'
    blend.parent.mkdir(parents=True, exist_ok=True)
    bpy.data.libraries.write(str(blend), {scene}, fake_user=True, compress=True)
    (output / 'surface-audit.json').write_text(json.dumps(audits, indent=2) + '\n')

    runtime = dict(source)
    for name in fixed_layers(source):
        if name == 'base':
            runtime[name] = far
        else:
            runtime[name] = {k: v for k, v in source[name].items() if k not in ('fixed', 'parcels', 'streets')}
            runtime[name]['fixed'] = {'vertices': [], 'meshes': {}, 'surfaces': []}
    runtime['streaming'] = {**catalog, 'farRanges': ranges,
                            'farBlendSha256': hashlib.sha256(blend.read_bytes()).hexdigest()}
    target = output / 'src/worlds/generated/izmaColonyRuntime.json'
    target.parent.mkdir(parents=True, exist_ok=True)
    saved = write_manifest(target, runtime)
    result = {**saved, 'sourceSha256': catalog['sourceSha256'], 'regions': len(catalog['regions']),
              'regionalBytes': catalog['counts']['bytes'], 'catalogBytes': len(encoded(catalog)),
              'originalTriangles': catalog['counts']['drawingTriangles'],
              'farTriangles': sum(len(ids) // 3 for ids in far['meshes'].values()),
              'unchangedFallbackComponents': sum(a['fallbackComponents'] for a in audits),
              'protectedSharedVertices': len(locked),
              'boundarySeparationLimit': .01,
              'maxSampleError': max(a['maxSampleError'] for a in audits),
              'surfaceSamples': sum(a['samples'] for a in audits),
              'blendBytes': blend.stat().st_size,
              'status': 'Candidate package; application streaming is not connected'}
    (output / 'export.json').write_text(json.dumps(result, indent=2) + '\n')
    print(json.dumps(result), flush=True)


if __name__ == '__main__':
    main()
