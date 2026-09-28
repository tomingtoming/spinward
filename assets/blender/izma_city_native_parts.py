"""Keep the composed city editable as independent, bounded native districts."""
import argparse
import hashlib
import json
from pathlib import Path
import sys
import bpy

ASSETS = Path(__file__).resolve().parent
CONTRACT = ASSETS/'izma-city-neighbourhoods.json'
INDEX = ASSETS/'izma-city-neighbourhoods-native.json'


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def write_parts():
    contract = json.loads(CONTRACT.read_text())
    source = ASSETS/'izma-city-neighbourhoods.blend'
    assert Path(bpy.data.filepath).resolve() == source.resolve()
    assert digest(source) == contract['nativeSha256'] and not INDEX.exists()
    scene = bpy.data.scenes['SW_izma_city_neighbourhoods']
    parcels = {p['id']: p for p in contract['parcels']}
    groups = {n['id']: [] for n in contract['neighbourhoods']}
    for obj in scene.objects:
        district = parcels[obj['parcel_id']]['district'] if obj.get('parcel_id') in parcels else obj['district']
        groups[district].append(obj)
    result = {'version': 1, 'contractSha256': digest(CONTRACT), 'sourceAssemblySha256': digest(source),
              'owner': scene['owner'], 'planSha256': scene['city_plan_sha256'], 'parts': []}
    for district, objects in sorted(groups.items()):
        part = bpy.data.scenes.new('SW_city_'+district)
        for key in ['owner', 'terrain_hash', 'city_plan_sha256']:
            part[key] = scene[key]
        part.unit_settings.system = 'METRIC'
        part.unit_settings.scale_length = 1
        for obj in objects:
            assert obj.library is None and (obj.type != 'MESH' or obj.data.library is None)
            part.collection.objects.link(obj)
        path = ASSETS/('izma-city-neighbourhoods-'+district+'.blend')
        assert not path.exists(), ('Preserve the previous native part', path)
        part.view_layers[0].update()
        bpy.data.libraries.write(str(path), {part}, fake_user=True, compress=True)
        assert path.stat().st_size < 96*1024*1024, ('Split oversized native district', district)
        row = {'district': district, 'scene': part.name, 'file': path.name, 'sha256': digest(path),
               'bytes': path.stat().st_size, 'objects': len(objects)}
        result['parts'].append(row)
        print(json.dumps(row), flush=True)
    assert sum(p['objects'] for p in result['parts']) == len(scene.objects)
    INDEX.write_text(json.dumps(result, indent=2)+'\n')
    return result


def load_city_scene(contract, assets=ASSETS):
    source = assets/'izma-city-neighbourhoods.blend'
    if Path(bpy.data.filepath).resolve() == source.resolve():
        assert digest(source) == contract['nativeSha256']
        return bpy.data.scenes['SW_izma_city_neighbourhoods']
    index = json.loads((assets/'izma-city-neighbourhoods-native.json').read_text())
    assert index['contractSha256'] == digest(assets/'izma-city-neighbourhoods.json')
    assert index['sourceAssemblySha256'] == contract['nativeSha256']
    assert index['planSha256'] == contract['cityFabric']['planHash']
    scene = bpy.data.scenes.new('SW_izma_city_export')
    scene['owner'] = index['owner']
    scene['city_plan_sha256'] = index['planSha256']
    for part in index['parts']:
        path = assets/part['file']
        assert digest(path) == part['sha256'], ('Native district changed', part['file'])
        with bpy.data.libraries.load(str(path), link=True) as (_, target):
            target.scenes = [part['scene']]
        native = target.scenes[0]
        assert native['city_plan_sha256'] == index['planSha256'] and len(native.objects) == part['objects']
        for obj in native.objects:
            scene.collection.objects.link(obj)
    assert len(scene.objects) == sum(p['objects'] for p in index['parts'])
    return scene


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--write', action='store_true', required=True)
    parser.parse_args(sys.argv[sys.argv.index('--')+1:])
    write_parts()
