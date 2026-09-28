"""Compose saved whole-block native geometry with retained neighbourhoods.

Run in isolated Blender with the original neighbourhood .blend open. The old
source scene/files remain reusable. Explicit new output names are mandatory.
"""
import argparse
from collections import Counter
import hashlib
import json
import math
from pathlib import Path
import sys
import bpy

ASSETS = Path(__file__).resolve().parent
ROOT = ASSETS.parents[1]
sys.path.insert(0, str(ASSETS))
from colony_manifest_io import read_manifest
from izma_city_contract import parcel_contract
from izma_block_composition import read_composition


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def compose(plan_path, native_plan_path, native_path, output):
    assert all(p.is_absolute() for p in [plan_path, native_plan_path, native_path, output])
    assert output.suffix == '.blend' and not output.exists() and not output.with_suffix('.json').exists()
    assert plan_path.parent == ASSETS, 'The composed native source needs a permanent sibling plan'
    plan = json.loads(plan_path.read_text())
    native_plan = json.loads(native_plan_path.read_text())
    report = json.loads(native_path.with_suffix('.json').read_text())
    assert report['planSha256'] == digest(native_plan_path)
    assert plan['districts'] == native_plan['districts'], 'A dependency revision must preserve actual geometry'
    for name, value in plan['dependencies'].items():
        assert digest(ASSETS/name) == value, ('Stale city plan', name)
    source = json.loads((ASSETS/'izma-neighbourhood-parcels.json').read_text())
    base = read_manifest(ROOT/'src/worlds/generated/izmaColony.json')['base']
    terrain_hash = hashlib.sha256(json.dumps([base['vertices'], base['meshes']['earth']], separators=(',', ':')).encode()).hexdigest()
    assert plan['terrainHash'] == terrain_hash == source['terrainHash']
    assert report.get('failedThresholds') == 0 and report.get('largeRetainingWalls') == 0
    assert report['connectionSourceSha256'] == digest(ASSETS/'izma_city_entry_connection.py')
    blocks = [b for d in plan['districts'] for b in d['blocks']]
    block_index = {b['id']: b for b in blocks}
    retired = [p for b in blocks for p in b['retiredParcels']]
    assert len(retired) == len(set(retired))
    retired = set(retired)
    source_ids = {p['id'] for p in source['parcels']}
    assert retired <= source_ids
    composition = read_composition()
    assert not retired.intersection(composition['retiredParcelIds'])
    profiles = {s['id']: s['profile'] for s in source['streets']}
    for r in json.loads((ASSETS/'izma-transport.json').read_text())['profiles']:
        profiles[r['id']] = [[q[0]+r['band']*math.tau*3200/3, *q[1:]] for q in r['points']]
    streets = list(source['streets'])
    for block in report['blocks']:
        for p in block['passages']:
            assert p['id'] not in profiles
            profiles[p['id']] = p['profile']
            streets.append({**p, 'district': block['district'], 'band': block_index[block['id']]['band'],
                            'kind': 'pedestrian', 'character': 'passage', 'connections': [],
                            'block': block['id'], 'surfaceMaterial': 'paving'})
    new_parcels = [parcel_contract(p, profiles) for b in report['blocks'] for p in b['plots']]
    new_ids = {p['id'] for p in new_parcels}
    assert len(new_ids) == len(new_parcels) and not new_ids.intersection(source_ids)
    parcels = [p for p in source['parcels'] if p['id'] not in retired]+new_parcels
    parcel_ids = {p['id'] for p in parcels}
    original = bpy.data.scenes['SW_izma_neighbourhoods']
    assert original.get('owner') == 'spinward-izma-neighbourhoods-v1'
    assert Path(bpy.data.filepath).resolve() == (ASSETS/'izma-neighbourhoods.blend').resolve()
    # Appending a whole scene localizes each ID against every existing object.
    # Link for reading, then copy only the required mesh/object/material data.
    print(json.dumps({'phase': 'link-native-source', 'newParcels': len(new_ids)}), flush=True)
    with bpy.data.libraries.load(str(native_path), link=True) as (available, loaded):
        loaded.scenes = ['SW_izma_city_fabric_candidate']
    native = loaded.scenes[0]
    assert native['plan_sha256'] == report['planSha256']
    scene = bpy.data.scenes.new('SW_izma_city_neighbourhoods')
    scene['owner'] = 'spinward-izma-city-neighbourhoods-v1'
    scene['terrain_hash'] = terrain_hash
    scene['city_plan_sha256'] = digest(plan_path)
    scene.unit_settings.system = 'METRIC'
    scene.unit_settings.scale_length = 1
    removed = Counter()
    for obj in original.objects:
        if obj.get('parcel_id') in retired:
            removed['light' if obj.type == 'LIGHT' else 'mesh-lod-'+str(obj.get('lod'))] += 1
            continue
        scene.collection.objects.link(obj)
    local_materials = {}
    copied = 0
    for linked in native.objects:
        if linked.get('lod') == 2:
            continue
        assert linked.type == 'MESH', ('Unexpected native object type', linked.name)
        obj = linked.copy()
        obj.name = linked.name
        obj.data = linked.data.copy()
        for i, material in enumerate(linked.data.materials):
            if material not in local_materials:
                local_materials[material] = material.copy()
                local_materials[material].name = material.name
                local_materials[material]['spinward_material'] = material.name.removeprefix('SWCF_')
            obj.data.materials[i] = local_materials[material]
        if obj.get('family') == 'passage':
            block = block_index[obj['block_id']]
            obj['urban_street_id'] = block['id']+'-passages'
            obj['band'] = block['band']
        else:
            assert obj.get('parcel_id') in new_ids, ('Unowned candidate object', obj.name)
        scene.collection.objects.link(obj)
        copied += 1
        if copied % 2000 == 0:
            print(json.dumps({'phase': 'copy-native-meshes', 'objects': copied}), flush=True)
    lods = {p: set() for p in parcel_ids}
    used_materials = set()
    for obj in scene.objects:
        assert obj.get('parcel_id') not in retired, ('Retired object survived', obj.name)
        if obj.type != 'MESH':
            continue
        if 'urban_street_id' not in obj:
            assert obj.get('parcel_id') in parcel_ids, ('Unknown parcel object', obj.name)
            lods[obj['parcel_id']].add(int(obj['lod']))
        for material in obj.data.materials:
            used_materials.add(material)
    for material in used_materials:
        key = material.get('spinward_material', material.name.removeprefix('SWD_'))
        assert key in source['materials'], ('Unknown semantic material', material.name)
        material['spinward_material'] = key
        assert material.library is None, ('Composed material remains linked', material.name)
    assert all(o.library is None and (o.type != 'MESH' or o.data.library is None) for o in scene.objects)
    assert all({0, 1} <= levels for levels in lods.values()), 'Composed parcel missing native LOD'
    assert len([o for o in scene.objects if o.name.endswith('_entry_connection')]) == report['entryConnections']
    contract = {**source, 'created': '2026-09-19', 'parcels': parcels, 'streets': streets,
                'neighbourhoods': [{**n, 'parcels': [p['id'] for p in parcels if p['district'] == n['id']]}
                                  for n in source['neighbourhoods']],
                'dependencies': {**plan['dependencies'], plan_path.name: digest(plan_path)},
                'cityFabric': {'planHash': digest(plan_path), 'retiredParcelIds': sorted(retired),
                               'sourceNativeSha256': digest(native_path),
                               'sourceNativePlanSha256': report['planSha256'],
                               'sourceOriginalNativeSha256': digest(ASSETS/'izma-neighbourhoods.blend'),
                               'blocks': [b['id'] for b in blocks], 'newParcelIds': sorted(new_ids)}}
    assert all(n['parcels'] for n in contract['neighbourhoods'])
    scene['parcel_count'] = len(parcels)
    scene.view_layers[0].update()
    print(json.dumps({'phase': 'write-composed-native', 'objects': len(scene.objects)}), flush=True)
    bpy.data.libraries.write(str(output), {scene}, fake_user=True, compress=True)
    contract['nativeSha256'] = digest(output)
    output.with_suffix('.json').write_text(json.dumps(contract, ensure_ascii=False, separators=(',', ':'))+'\n')
    result = {'sourceParcels': len(source_ids), 'retiredParcels': len(retired), 'newParcels': len(new_ids),
              'composedParcels': len(parcels), 'runtimeParcelsAfterExistingBlocks': len(parcels)-len(composition['retiredParcelIds']),
              'retiredNativeObjects': dict(removed), 'objects': len(scene.objects), 'streets': len(streets),
              'nativeBytes': output.stat().st_size, 'nativeSha256': contract['nativeSha256'],
              'status': 'saved native composition; dependent grounds and runtime export pending'}
    print(json.dumps(result, indent=2), flush=True)
    return result


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    for name in ['plan', 'native-plan', 'native', 'output']:
        parser.add_argument('--'+name, type=Path, required=True)
    args = parser.parse_args(sys.argv[sys.argv.index('--')+1:])
    compose(args.plan, args.native_plan, args.native, args.output)
