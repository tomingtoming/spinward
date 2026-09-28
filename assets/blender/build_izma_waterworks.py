"""Native supply reservoirs, recovery plants and their saved service approaches.

The six sites share engineering dimensions but retain district-era materials.
No original scene or live application data is changed. Every LOD is saved in
the candidate blend; its explicit collision flags are exported separately.
"""
import argparse
import hashlib
import json
import math
from pathlib import Path
import sys
import bpy
from mathutils import Vector

ASSETS = Path(__file__).resolve().parent
sys.path.insert(0, str(ASSETS))
from izma_mesh_builder import BuildingMeshBuilder
from izma_native_signs import NativeSigns

MATERIALS = {
    'concrete': '#aaa99a', 'rim': '#c5c3b4', 'water': '#557d7e',
    'steel': '#657571', 'pipe': '#6e8c84', 'valve': '#925c42',
    'brick': '#997c68', 'plaster': '#d0cebe', 'sage': '#a5b2a0',
    'roof': '#616e70', 'tile': '#775e50', 'glass': '#456067',
    'door': '#68776f', 'soil': '#706447', 'reed': '#82915c',
    'wall-ivory': '#e1dec9', 'sign': '#435b57', 'lamp': '#d4d1b6',
}


def build_waterworks(candidate):
    if not candidate.is_absolute() or candidate.resolve() == ASSETS.parents[1]:
        raise ValueError('Use a separate absolute candidate root')
    plan_path = candidate / 'assets/blender/izma-waterworks-plan.json'
    plan = json.loads(plan_path.read_text())
    for name, digest in plan['dependencies'].items():
        assert hashlib.sha256((ASSETS / name).read_bytes()).hexdigest() == digest, ('Stale site source', name)
    owner = 'spinward-izma-waterworks-v1'
    scene = bpy.data.scenes.new('SW_izma_waterworks')
    scene['owner'] = owner
    scene['planSha256'] = hashlib.sha256(plan_path.read_bytes()).hexdigest()
    scene.unit_settings.system = 'METRIC'
    scene.unit_settings.scale_length = 1
    bpy.context.window.scene = scene
    materials = {}
    for name, color in MATERIALS.items():
        material = bpy.data.materials.new('SWW_' + name)
        material.diffuse_color = tuple(int(color[i:i + 2], 16) / 255 for i in [1, 3, 5]) + (1,)
        material['spinward_material'] = 'waterworks-' + name
        materials[name] = material
    signs = NativeSigns(scene)
    records = []
    buried_records = []
    light_records = []

    def tube(builder, points, radius, material, segments):
        # Shared rings keep elbows and bends closed. Independent cylinders
        # left open wedges where successive segment directions changed.
        rings = []
        points = [Vector(p) for p in points]
        closed = (points[0] - points[-1]).length < 1e-6
        for i, point in enumerate(points):
            before = (point - points[i - 1 if i else -2]).normalized() if i or closed else None
            after = (points[i + 1 if i + 1 < len(points) else 1] - point).normalized() if i + 1 < len(points) or closed else None
            tangent = ((before + after).normalized() if before is not None and after is not None else before or after)
            axis = Vector((0, 0, 1)) if abs(tangent.z) < .9 else Vector((0, 1, 0))
            u = tangent.cross(axis).normalized() * radius
            v = tangent.cross(u).normalized() * radius
            rings.append([tuple(point + math.cos(j * math.tau / segments) * u +
                                math.sin(j * math.tau / segments) * v) for j in range(segments)])
        for a, b in zip(rings, rings[1:]):
            for i in range(segments):
                j = (i + 1) % segments
                builder.face([a[i], a[j], b[j], b[i]], material)

    def water_plane(builder, x, y, width, depth, level):
        count = math.ceil(depth / 12)
        for i in range(count):
            y0, y1 = y - depth / 2 + depth * i / count, y - depth / 2 + depth * (i + 1) / count
            builder.quad((x - width / 2, y0, level), (x + width / 2, y0, level),
                         (x + width / 2, y1, level), (x - width / 2, y1, level), 'water')

    def rectangular_basin(builder, x, y, width, depth):
        builder.box(x, y, .02, width + 1.2, depth + 1.2, .25, 'concrete', True)
        for u in [x - width / 2, x + width / 2]:
            builder.box(u, y, .25, .6, depth, 2.95, 'rim', True)
        for v in [y - depth / 2, y + depth / 2]:
            builder.box(x, v, .25, width + .6, .6, 2.95, 'rim', True)
        water_plane(builder, x, y, width - .6, depth - .6, 2.6)

    def circular_basin(builder, x, y, radius, segments):
        # Open water, an annular rim and a radial scraper bridge make the
        # recovery plant read differently from the rectangular supply pools.
        for i in range(segments):
            a, b = i * math.tau / segments, (i + 1) * math.tau / segments
            outer = [(x + math.cos(t) * (radius + .6), y + math.sin(t) * (radius + .6)) for t in [a, b]]
            inner = [(x + math.cos(t) * radius, y + math.sin(t) * radius) for t in [a, b]]
            builder.face([(*outer[0], .02), (*outer[1], .02), (*outer[1], 3.2), (*outer[0], 3.2)], 'concrete')
            builder.face([(*inner[1], .25), (*inner[0], .25), (*inner[0], 3.2), (*inner[1], 3.2)], 'concrete')
            builder.face([(*outer[0], 3.2), (*outer[1], 3.2), (*inner[1], 3.2), (*inner[0], 3.2)], 'rim', True)
            builder.face([(x, y, 2.6), (*inner[0], 2.6), (*inner[1], 2.6)], 'water')
            builder.face([(x, y, .25), (*inner[0], .25), (*inner[1], .25)], 'concrete', True)
        builder.box(x, y, 3.2, radius * 2, 1.2, .18, 'steel', True)
        builder.box(x, y, .25, 1.2, 1.2, 3.15, 'steel', True)

    def handrail(builder, a, b, lod):
        if lod == 2:
            return
        tube(builder, [[a[0], a[1], a[2] + 1.05], [b[0], b[1], b[2] + 1.05]], .045, 'steel', 6)
        count = math.ceil(math.dist(a[:2], b[:2]) / 2.5)
        for i in range(count + 1):
            p = [a[k] + (b[k] - a[k]) * i / count for k in range(3)]
            builder.box(p[0], p[1], p[2], .07, .07, 1.05, 'steel')

    def save_component(builder, parcel, suffix, lod, physical=True):
        obj = builder.finish(parcel['id'] + '_' + suffix + '_' + str(lod), parcel, lod)
        obj['waterworks_id'] = parcel['id']
        obj['band'] = parcel['band']
        obj['component'] = suffix
        obj.hide_render = lod != 0 and lod != -1
        flags = obj.data.attributes.new('physical', 'BOOLEAN', 'FACE')
        for flag, material in zip(flags.data, builder.m):
            flag.value = physical and material not in ['water', 'glass', 'sign', 'wall-ivory', 'reed', 'lamp']
        return obj

    def save_buried(ident, band, points, radius, facility=None):
        cx, cy, floor = points[0]
        parcel = {'id': ident, 'band': band, 'position': [cx, cy], 'floor': floor,
                  'yaw': 0, 'district': ident, 'family': 'waterworks'}
        builder = BuildingMeshBuilder(scene, materials)
        tube(builder, [(x - cx, y - cy, h - floor) for x, y, h in points], radius, 'pipe', 8)
        obj = save_component(builder, parcel, 'buried-pipe', -2, False)
        obj['buried'] = True
        obj['centreline'] = json.dumps(points)
        obj['radius'] = radius
        obj['facility'] = facility or ''
        obj.hide_render = True
        # These saved meshes are underground infrastructure. They are retained
        # for authoring/section inspection and omitted from the surface renderer.
        buried_records.append({'id': ident, 'band': band, 'radius': radius,
                               'profile': points, 'facility': facility,
                               'length': sum(math.dist(a, b) for a, b in zip(points, points[1:]))})

    for route in plan['buriedRoutes']:
        save_buried(route['id'], route['band'], route['profile'], route['radius'], route.get('facility'))

    for site in plan['facilities']:
        parcel = {**site, 'yaw': 0, 'district': site['id'], 'family': 'waterworks'}
        # Shared ground is a native fixed layer. Exposed vertical faces close
        # the slab down into the existing terrain; no hollow floating pad.
        b = BuildingMeshBuilder(scene, materials)
        bottom = site['foundationBottom'] - site['floor']
        b.box(0, 0, bottom, 160, 220, -bottom, 'concrete', True)
        save_component(b, parcel, 'ground', -1)
        access = BuildingMeshBuilder(scene, materials)
        cx, cy = site['position']
        rows = [[x - cx, y - cy, h - site['floor']] for x, y, h in site['serviceAccess']['profile']]
        for row, (a, c) in enumerate(zip(rows, rows[1:])):
            # Centreline has constant x; side faces close the supported deck.
            for x0, x1 in [(-3, 0), (0, 3)]:
                points = [(a[0] + x0, a[1], a[2]), (a[0] + x1, a[1], a[2]),
                          (c[0] + x1, c[1], c[2]), (c[0] + x0, c[1], c[2])]
                access.face(points, 'concrete', True)
            for side, dx in enumerate([-3, 3]):
                az = site['serviceAccess']['groundEdges'][row][side] - site['floor'] - .15
                cz = site['serviceAccess']['groundEdges'][row + 1][side] - site['floor'] - .15
                access.face([(a[0] + dx, a[1], a[2]), (c[0] + dx, c[1], c[2]),
                             (c[0] + dx, c[1], cz), (a[0] + dx, a[1], az)], 'concrete')
        save_component(access, parcel, 'service-road', -1)
        fixtures = BuildingMeshBuilder(scene, materials)
        lamps = [(16, 10, 0, 4.5), (16, -4, 0, 6.4), (-30, -4, 0, 6.4),
                 (-65, -4, 0, 6.4), (64, 0, 0, 4), (64, 56, 0, 4)]
        if site['role'] == 'recovery':
            lamps.extend([(-2, -44, 0, 6.4), (-2, 44, 0, 6.4)])
        # Supported roadside fixtures share the fixed regional layer. The six
        # nearest point lights are selected by the existing global light pool.
        for i in range(0, len(rows), 4):
            x, y, h = rows[i]
            lamps.append((x + 2.7, y, h, 4.5))
        for number, (x, y, z, height) in enumerate(lamps):
            fixtures.box(x, y, z, .28, .28, .12, 'concrete')
            fixtures.box(x, y, z + .1, .1, .1, height - .1, 'steel')
            fixtures.box(x, y, z + height, .58, .42, .08, 'roof')
            fixtures.box(x, y, z + height - .04, .48, .32, .04, 'lamp')
            light = bpy.data.lights.new(site['id'] + '-maintenance-' + str(number), 'POINT')
            light.color = (1, .89, .69)
            light.energy = 120
            obj = bpy.data.objects.new(light.name, light)
            scene.collection.objects.link(obj)
            # The source sits just under its physical fixture, never detached.
            obj.location = (cy + y, -(cx + x), site['floor'] + z + height - .09)
            obj['waterworks_id'] = site['id']
            obj['color'] = '#ffe5b9'; obj['intensity'] = 120; obj['distance'] = 24
            light_records.append({'facility': site['id'], 'position': [cx + x, cy + y, site['floor'] + z + height - .09]})
        save_component(fixtures, parcel, 'maintenance-lights', -1)
        # Buried process branches join every tank to the pump chamber, which
        # also joins the pressure-return riser and the visible river line.
        tanks = [(-35, -55), (-35, 55)] if site['role'] == 'supply' else [(-35, -48), (-35, 48), (25, -75), (25, -45), (25, 75)]
        for i, (x, y) in enumerate(tanks):
            points = [(43, 0, 1.1), (43, 0, -.8), (x, y, -.8), (x, y, 1.1)]
            save_buried(site['id'] + '-tank-' + str(i), site['band'],
                        [[cx + x, cy + y, site['floor'] + h] for x, y, h in points], .3, site['id'])
        save_buried(site['id'] + '-pump-manifold', site['band'],
                    [[cx + 43, cy, site['floor'] + 1.1], [cx + 43, cy - 21.2, site['floor'] + 1.1]], .65, site['id'])
        for lod in [0, 1, 2]:
            b = BuildingMeshBuilder(scene, materials)
            if site['role'] == 'supply':
                for y in [-55, 55]:
                    rectangular_basin(b, -35, y, 64, 80)
                b.box(-27, 0, 3.2, 82, 5.2, .18, 'steel', True)
                for x in [-64, -32, 0, 12]:
                    b.box(x, 0, 0, .5, .5, 3.2, 'concrete')
                handrail(b, (-68, -2.3, 3.38), (14, -2.3, 3.38), lod)
                handrail(b, (-68, 2.3, 3.38), (10, 2.3, 3.38), lod)
            else:
                for y in [-48, 48]:
                    circular_basin(b, -35, y, 25, [40, 24, 16][lod])
                    for side in [-.65, .65]:
                        handrail(b, (-60, y + side, 3.38), (-10, y + side, 3.38), lod)
                    b.box(-7.5, y, 3.2, 5, 1.2, .18, 'steel', True)
                # The stair meets a central landing, then a clear gallery joins
                # both scraper bridges. Leave openings at the T junctions.
                b.box(3.5, 0, 3.2, 21, 5.2, .18, 'steel', True)
                # Meet at shared edges instead of stacking coplanar deck caps.
                # The central landing ends at the outside of the gallery.
                for y in [-25, 25]:
                    b.box(-6, y, 3.2, 2, 44.8, .18, 'steel', True)
                for y in [-48, -24, 0, 24, 48]:
                    b.box(-6, y, 0, .5, .5, 3.2, 'concrete')
                for x in [-7.1, -4.9]:
                    for a, c in [(-46, -3), (3, 46)]:
                        handrail(b, (x, a, 3.38), (x, c, 3.38), lod)
                # Three separate reed/filter cells at the eastern edge of the
                # settling tanks, away from the service lane and pump house.
                for y in [-75, -45, 75]:
                    rectangular_basin(b, 25, y, 26, 20)
                    if site['band'] == 2 and lod == 0:
                        for x in [16, 22, 28, 34]:
                            for v in [y - 6, y, y + 6]:
                                b.box(x, v, 2.6, .05, .05, .9, 'reed')
            # Maintenance stairs are full geometry at near and middle LOD.
            # The landing leaves a clear gate from the service lane on the east.
            if lod < 2:
                for i in range(22):
                    b.box(12, 9 - i * .3, 0, 2, .3, (i + 1) * (3.38 / 22), 'concrete', True)
                handrail(b, (10.95, 9.15, 0), (10.95, 2.55, 3.38), lod)
                handrail(b, (13.05, 9.15, 0), (13.05, 2.55, 3.38), lod)
            save_component(b, parcel, 'basins', lod)

            b = BuildingMeshBuilder(scene, materials)
            wall = ['brick', 'plaster', 'sage'][site['band']]
            b.box(43, 0, 0, 30, 42, 6.4, wall, True)
            if site['band'] != 1:
                b.gable(43, 0, 6.4, 31, 43, 2.3, 'tile' if site['band'] == 0 else 'roof')
            else:
                b.box(43, 0, 6.4, 31, 43, .3, 'roof', True)
            b.box(58.06, 0, .05, .12, 1.4, 2.25, 'door')
            if lod < 2:
                for y in [-15, -8, 8, 15]:
                    b.box(58.08, y, 2, .1, 3, 1.4, 'glass')
                b.box(60, 0, 2.5, 4, 3, .18, 'steel')
                for y in [-1.4, 1.4]:
                    b.box(61.7, y, 0, .1, .1, 2.5, 'steel')
                for x in [34, 43, 52]:
                    b.box(x, -21.12, .4, 4, .18, 3.6, 'door')
                b.box(43, -21.15, 4.65, 24, .22, 1, 'sign')
                if lod == 0:
                    signs(b, ('RESERVOIR' if site['role'] == 'supply' else 'WATER RECLAMATION'),
                          43, -21.28, 4.8, 22, .65)
            save_component(b, parcel, 'pump-house', lod)

            b = BuildingMeshBuilder(scene, materials)
            segments = [12, 8, 6][lod]
            # Pipes run along the maintenance side, away from the entrance.
            tube(b, [(43, -21.2, 1.1), (43, -102, 1.1), (-35, -102, 1.1), (-35, -94, 1.1)],
                 .65, 'pipe', segments)
            for x in [-30, -10, 10, 30]:
                b.box(x, -102, 0, 1.6, 2, .5, 'concrete')
            for y in [-32, -48, -64, -80, -96]:
                b.box(43, y, 0, 2, 1.6, .5, 'concrete')
            if lod == 0:
                for x in [-10, 25]:
                    tube(b, [(x, -102, 1.7), (x, -102, 2.25)], .09, 'steel', 8)
                    wheel = [(x + math.cos(i * math.tau / 16) * .45,
                              -102 + math.sin(i * math.tau / 16) * .45, 2.25) for i in range(17)]
                    tube(b, wheel, .055, 'valve', 6)
            # River end is at the actual saved water level. The line descends
            # into the bank; only its exposed sections appear above the soil.
            px, py, ph = site['riverPort']
            tube(b, [(-35, -102, 1.1), (-72, -102, 1.1),
                     (px - cx, py - cy, ph - site['floor'])], .65, 'pipe', segments)
            for x, y, bottom, top in site['pipeSupports']:
                b.box(x - cx, y - cy, bottom - site['floor'], 1.4, 1.4, top - bottom, 'concrete')
            save_component(b, parcel, 'pipework', lod)
        records.append({'id': site['id'], 'role': site['role'], 'band': site['band'],
                        'floor': site['floor'], 'components': 12, 'lamps': len(lamps),
                        'serviceRoad': site['serviceAccess']['road']})
    scene.view_layers[0].update()
    assert all(o.library is None and (o.type != 'MESH' or o.data.library is None) for o in scene.objects)
    target = candidate / 'assets/blender/izma-waterworks.blend'
    bpy.data.libraries.write(str(target), {scene}, fake_user=True, compress=True)
    report = {'origin': 'ai', 'created': '2026-09-20', 'owner': owner,
              'planSha256': scene['planSha256'], 'nativeSha256': hashlib.sha256(target.read_bytes()).hexdigest(),
              'objects': len(scene.objects), 'facilities': records,
              'materials': MATERIALS, 'lights': light_records, 'buriedPipes': buried_records,
              'status': 'saved native candidate; not yet exported to the application'}
    (target.with_suffix('.json')).write_text(json.dumps(report, indent=2) + '\n')
    print(json.dumps(report), flush=True)


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--candidate-root', type=Path, required=True)
    args = parser.parse_args(sys.argv[sys.argv.index('--') + 1:])
    build_waterworks(args.candidate_root)
