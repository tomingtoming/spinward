"""Inspect a full-city parcel candidate in a separate native Blender scene.

This deliberately writes only explicitly named candidate outputs. Failed
thresholds remain in the audit; this scene is not a runtime replacement.
Run with background Blender and --python, then -- --plan ... --output ... .
"""
import argparse
import hashlib
import json
import math
import sys
from pathlib import Path

import bpy
from mathutils import Vector

ASSETS = Path(__file__).resolve().parent
ROOT = ASSETS.parents[1]
sys.path.insert(0, str(ASSETS))
from colony_manifest_io import read_manifest
from izma_ground_patches import GroundPatches, area
from izma_mesh_builder import BuildingMeshBuilder
from izma_building_meshes import render_building
from izma_building_forms import building_form
from izma_city_entry_connection import connection, append_connection
from izma_city_entry_sides import append_entry_sides
from izma_city_access import append_entry,native_walk_patches,footway_obstructs,raised_footway_entry
from izma_native_signs import NativeSigns


def project(point, a, b):
    dx, dy = b[0] - a[0], b[1] - a[1]
    t = max(0, min(1, ((point[0] - a[0]) * dx + (point[1] - a[1]) * dy) / (dx * dx + dy * dy)))
    q = [a[k] + (b[k] - a[k]) * t for k in range(2)]
    return math.dist(point, q), a[2] + (b[2] - a[2]) * t


def build(plan_path, output):
    assert plan_path.is_absolute() and output.is_absolute()
    assert output.suffix == '.blend' and output != plan_path
    assert not output.exists(), 'Use a fresh candidate filename; preserve previous evidence'
    plan = json.loads(plan_path.read_text())
    for name, digest in plan['dependencies'].items():
        assert hashlib.sha256((ASSETS / name).read_bytes()).hexdigest() == digest, ('Stale candidate', name)
    manifest_path = ROOT / 'src/worlds/generated/izmaColony.json'
    manifest = read_manifest(manifest_path)
    terrain_hash = hashlib.sha256(json.dumps([manifest['base']['vertices'], manifest['base']['meshes']['earth']],
                                             separators=(',', ':')).encode()).hexdigest()
    assert plan.get('terrainHash') == terrain_hash, 'Replan city fabric against the current terrain'
    terrain = GroundPatches(manifest['base'])
    footway = native_walk_patches(manifest['base'])
    neighbourhood = json.loads((ASSETS / 'izma-neighbourhood-parcels.json').read_text())
    profiles = {s['id']: s['profile'] for s in neighbourhood['streets']}
    for road in json.loads((ASSETS / 'izma-transport.json').read_text())['profiles']:
        shift = road['band'] * math.tau * 3200 / 3
        profiles[road['id']] = [[p[0] + shift, p[1], p[2]] for p in road['points']]
    scene = bpy.data.scenes.new('SW_izma_city_fabric_candidate')
    scene['owner'] = 'spinward-izma-city-fabric-candidate-v1'
    scene['plan_sha256'] = hashlib.sha256(plan_path.read_bytes()).hexdigest()
    scene['status'] = 'candidate; audit failures are not approved for runtime'
    scene.unit_settings.system = 'METRIC'
    scene.unit_settings.scale_length = 1
    bpy.context.window.scene = scene
    materials = {}
    for name, definition in neighbourhood['materials'].items():
        mat = bpy.data.materials.new('SWCF_' + name)
        mat.diffuse_color = tuple(int(definition['color'][i:i + 2], 16) / 255 for i in [1, 3, 5]) + (1,)
        mat['definition'] = json.dumps(definition)
        materials[name] = mat
    signs = NativeSigns(scene)

    def heights(polygon):
        polygon = list(polygon)
        if area(polygon) < 0:
            polygon.reverse()
        pieces = list(terrain.split(polygon))
        covered = sum(abs(area(p)) for p in pieces)
        assert abs(covered - abs(area(polygon))) < max(.01, abs(area(polygon)) * 1e-5), ('Terrain coverage', covered, polygon)
        return [p[2] for piece in pieces for p in piece]

    def ground(point):
        x, y = point
        return max(heights([[x - .005, y - .005], [x + .005, y - .005],
                            [x + .005, y + .005], [x - .005, y + .005]]))

    def street(point, road):
        if road not in profiles:
            assert '-passage-' in road, ('Missing road profile', road)
            return ground(point) + .08
        p = profiles[road]
        _, h = min(project(point, a, b) for a, b in zip(p, p[1:]) if a[:2] != b[:2])
        return max(ground(point) + .045, h + .035)

    report = {'origin': 'ai', 'created': '2026-09-19', 'planSha256': scene['plan_sha256'],
              'sourceHeaderSha256': hashlib.sha256(manifest_path.read_bytes()).hexdigest(),
              'terrainHash': terrain_hash,
              'transportSha256': hashlib.sha256((ASSETS / 'izma-transport.json').read_bytes()).hexdigest(),
              'status': scene['status'], 'blocks': [],
              'counts': {'buildings': 0, 'near': 0, 'mid': 0, 'far': 0, 'passageTriangles': 0}}
    blocks = [b for d in plan['districts'] for b in d['blocks']]
    for block_index, block in enumerate(blocks):
        row = {'id': block['id'], 'district': block['district'], 'plots': [], 'passages': [],
               'planarConnectedGates': block['connectedGates'], 'gateThresholds': []}
        for gate in block['gates']:
            h = ground(gate['start']) + .08
            row['gateThresholds'].append({**gate, 'groundHeight': h, 'roadHeight': street(gate['start'], gate['road'])})

        def walk_height(point, terrain_height):
            correction = 0
            for gate in row['gateThresholds']:
                a, b = gate['start'], gate['end']
                dx, dy = b[0] - a[0], b[1] - a[1]
                length2 = dx * dx + dy * dy
                t = ((point[0] - a[0]) * dx + (point[1] - a[1]) * dy) / length2
                distance = abs(dx * (point[1] - a[1]) - dy * (point[0] - a[0])) / math.sqrt(length2)
                if -.001 <= t <= 1 and distance <= gate['width'] / 2 + .001:
                    correction = max(correction, (gate['roadHeight'] - gate['groundHeight']) * (1 - max(0, t)))
            return terrain_height + .08 + correction

        for path in block['passages']:
            profile = []
            for a, b in zip(path['points'], path['points'][1:]):
                count = max(1, math.ceil(math.dist(a, b) / 3))
                for i in range(count):
                    p = [a[k] + (b[k] - a[k]) * i / count for k in range(2)]
                    profile.append([*p, walk_height(p, ground(p))])
            p = path['points'][-1];profile.append([*p, walk_height(p, ground(p))])
            profiles[path['id']] = profile
            slopes = [abs(b[2] - a[2]) / math.dist(a[:2], b[:2]) for a, b in zip(profile, profile[1:]) if a[:2] != b[:2]]
            row['passages'].append({**path, 'profile': profile, 'maximumGrade': max(slopes),
                                    'status': 'candidate ramp; stairs/landings required' if max(slopes) > .10 else 'candidate ramp; physical verification pending'})
        for plot in block['plots']:
            polygon = plot['outline']
            centre = [sum(p[k] for p in polygon) / 4 for k in range(2)]
            w, d = math.dist(polygon[0], polygon[1]), math.dist(polygon[1], polygon[2])
            # Local +Y runs into the lot even if the source road runs backwards.
            nx, ny = [(polygon[3][k] - polygon[0][k]) / d for k in range(2)]
            yaw = math.atan2(-nx, ny)
            c, s = math.cos(yaw), math.sin(yaw)

            def world(u, v):
                return [centre[0] + c * u - s * v, centre[1] + s * u + c * v]

            samples = heights(polygon)
            floor, bottom = max(samples) + .14, min(samples) - .4
            seed = int.from_bytes(hashlib.sha256(plot['id'].encode()).digest()[:4], 'big')
            family, floors = plot['family'], plot['floors']
            floor_h = 3.4 if family == 'office' else (5.2 if family == 'warehouse' else 3.2)
            form, volumes, roofs = building_form(family, w, d, floors, floor_h, seed, True)
            main = volumes[0]
            du = -w / 2 + 1.5 if family == 'warehouse' else main[0]
            dv = main[1] - main[4] / 2
            door = world(du, dv)
            assert math.dist(door, plot['entry']) < 1e-6, ('Door moved after reservation', plot['id'])
            approach = plot['approach']
            start_h = street(approach, plot['road'])
            length = math.dist(approach, door)
            rise = floor - start_h
            steps = max(1, math.ceil(abs(rise) / .16))
            ramp = abs(rise) <= length * .08
            issues = []
            if not ramp and length / steps < .28:
                issues.append('entrance-run-too-short')
            if max(samples) - min(samples) > 2.4:
                issues.append('retaining-wall-over-2.4m')
            parcel = {**plot, 'position': centre, 'yaw': yaw, 'floor': floor, 'foundationBottom': bottom,
                      'size': [w, d, floors * floor_h], 'volumes': volumes, 'form': form,
                      'wall': ['wall-ivory', 'wall-grey', 'wall-ochre', 'wall-brick', 'wall-white', 'wall-sage'][(seed // 100) % 6],
                      'roof': ['roof-slate', 'roof-tile', 'roof-green'][(seed // 1000) % 3],
                      'groundShop': family == 'shop-house' or (family == 'apartment' and seed % 5 == 0),
                      'entrance': {'start': [*approach, start_h], 'end': [*door, floor], 'width': 1.6,
                                   'ramp': ramp, 'steps': 1 if ramp else steps},
                      'groundRange': [min(samples), max(samples)], 'issues': issues}
            if footway_obstructs(parcel,footway):
                parcel=raised_footway_entry(parcel,footway)
                floor=parcel['floor'];entry=parcel['entrance']
                start_h=entry['start'][2];rise=floor-start_h;ramp=entry['ramp'];steps=entry['steps']
                issues=[issue for issue in issues if issue!='entrance-run-too-short']
                parcel['issues']=issues
            render_building(lambda: BuildingMeshBuilder(scene, materials), parcel, seed,
                            {'variedMassing': True, 'buildingIdentity': True, 'signWriter': signs})
            for obj in [scene.objects[plot['id'] + f'_lod{lod}'] for lod in [0, 1]]:
                obj['block_id'] = block['id']
                obj['candidate_issues'] = ','.join(issues)
                obj.data.calc_loop_triangles()
                report['counts']['near' if obj['lod'] == 0 else 'mid'] += len(obj.data.loop_triangles)
            builder = BuildingMeshBuilder(scene, materials)
            builder.box(0, 0, bottom - floor, w + .5, d + .5, floor - bottom, 'foundation', cap=False)
            for u, v, z, pw, pd, ph in volumes:
                builder.box(u, v, z, pw, pd, ph, parcel['wall'], cap=False)
            for u, v, z, pw, pd, ph, shape in roofs:
                if shape == 'gable':
                    builder.gable(u, v, z, pw, pd, ph, parcel['roof'])
                else:
                    builder.box(u, v, z, pw, pd, ph, parcel['roof'])
            obj = builder.finish(plot['id'] + '_lod2', parcel, 2)
            obj['block_id'] = block['id'];obj.hide_render = True
            obj.data.calc_loop_triangles();report['counts']['far'] += len(obj.data.loop_triangles)
            # Show only entries with feasible tread depth; rejected thresholds
            # remain explicit audit failures, not invented vertical stair walls.
            if 'entrance-run-too-short' not in issues:
                builder = BuildingMeshBuilder(scene, materials)
                append_entry(builder,parcel)
                append_entry_sides(builder, parcel, ground)
                obj = builder.finish(plot['id'] + '_entry', parcel, -1);obj['block_id'] = block['id']
                obj['entry_sides_revision'] = 1
                # The allocation starts outside the road reservation. Complete
                # its physical connection to the actual new passage pavement.
                corners = connection(parcel, lambda p: walk_height(p, ground(p)))
                if corners:
                    bridge = BuildingMeshBuilder(scene, materials)
                    append_connection(bridge, parcel, corners)
                    obj = bridge.finish(plot['id'] + '_entry_connection', parcel, -1)
                    obj['block_id'] = block['id'];parcel['entryConnection'] = corners
            row['plots'].append(parcel);report['counts']['buildings'] += 1
        builder = BuildingMeshBuilder(scene, materials)
        bounds = block['boundary']['outer']
        cx, cy = [sum(p[k] for p in bounds) / len(bounds) for k in range(2)]
        pending = list(block.get('passagePieces', []))
        while pending:
            triangle = pending.pop()
            longest = max(range(3), key=lambda i: math.dist(triangle[i], triangle[(i + 1) % 3]))
            a, b, c = triangle[longest], triangle[(longest + 1) % 3], triangle[(longest + 2) % 3]
            if math.dist(a, b) > 6:
                mid = [(a[k] + b[k]) / 2 for k in range(2)]
                pending.extend([[a, mid, c], [mid, b, c]])
                continue
            if area(triangle) < 0:
                triangle.reverse()
            for piece in terrain.split(triangle):
                builder.face([(x - cx, y - cy, walk_height((x, y), h)) for x, y, h in piece], 'paving', True)
        if builder.f:
            obj = builder.finish(block['id'] + '_passages', {'id': block['id'], 'district': block['district'],
                                  'family': 'passage', 'position': [cx, cy], 'floor': 0, 'yaw': 0}, -1)
            obj['block_id'] = block['id'];obj['candidate_issues'] = 'physical connection unverified'
            obj.data.calc_loop_triangles();report['counts']['passageTriangles'] += len(obj.data.loop_triangles)
        report['blocks'].append(row)
        print(json.dumps({'block': block['id'], 'index': block_index + 1, 'total': len(blocks),
                          'buildings': report['counts']['buildings']}), flush=True)
    scene.view_layers[0].update()
    output.parent.mkdir(parents=True, exist_ok=True)
    bpy.data.libraries.write(str(output), {scene}, fake_user=True, compress=True)
    report['blendBytes'] = output.stat().st_size
    report['failedThresholds'] = sum('entrance-run-too-short' in p['issues'] for b in report['blocks'] for p in b['plots'])
    report['largeRetainingWalls'] = sum('retaining-wall-over-2.4m' in p['issues'] for b in report['blocks'] for p in b['plots'])
    output.with_suffix('.json').write_text(json.dumps(report, ensure_ascii=False, separators=(',', ':')) + '\n')
    print(json.dumps({k: v for k, v in report.items() if k != 'blocks'}), flush=True)
    return report


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--plan', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args(sys.argv[sys.argv.index('--') + 1:])
    build(args.plan, args.output)
