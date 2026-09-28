"""Export the composed native city through the bounded neighbourhood format.

An explicit output root lets the complete dependent-layer assembly be validated
before replacing the running authored world. It must contain a source manifest.
"""
import argparse
import hashlib
import json
import math
from pathlib import Path
import sys
import bpy
from mathutils.kdtree import KDTree

ASSETS = Path(__file__).resolve().parent
ROOT = ASSETS.parents[1]
sys.path.insert(0, str(ASSETS))
from export_izma_districts import export
from izma_block_composition import read_composition
from colony_collision_partition import merge_adjacent_frontages, refine_city_ground
from izma_city_native_parts import load_city_scene
from izma_ground_cleanup import clean_ground
from izma_collision_mesh import simplify_packed_collision, finalize_packed_collision


def export_city(output_root, native_root=ASSETS, preserve_layout=False, appearance_only=False):
    assert output_root.is_absolute()
    assert native_root.is_absolute()
    contract_path = native_root/'izma-city-neighbourhoods.json'
    contract = json.loads(contract_path.read_text())
    for name, digest in contract['dependencies'].items():
        assert hashlib.sha256((ASSETS/name).read_bytes()).hexdigest() == digest, ('Stale city composition', name)
    scene = load_city_scene(contract, native_root)
    assert scene['city_plan_sha256'] == contract['cityFabric']['planHash']
    scene.view_layers[0].update()
    # Compare the new collision guards to saved visible native vertices, including
    # the courtyard form whose front wing differs from the old slab assumption.
    verified_guards = 0
    new_ids = set(contract['cityFabric']['newParcelIds'])
    for p in contract['parcels']:
        if p['id'] not in new_ids or not p['balconyGuards']:
            continue
        mesh = scene.objects[p['id']+'_lod0'].data
        tree = KDTree(len(mesh.vertices))
        for i, v in enumerate(mesh.vertices):
            tree.insert(v.co, i)
        tree.balance()
        for u, v, z, width, depth, height, _ in p['balconyGuards']:
            for x in [u-width/2, u+width/2]:
                for y in [v-depth/2, v+depth/2]:
                    for h in [z, z+height]:
                        _, _, distance = tree.find((x, y, h))
                        assert distance < 1e-4, ('Collision guard differs from native balcony', p['id'], distance)
            verified_guards += 1
    composition = read_composition()
    visits = {}
    parcels = {p['id']: p for p in contract['parcels']}
    omitted = set(composition['retiredParcelIds'])
    for n in contract['neighbourhoods']:
        p = next(parcels[i] for i in n['parcels'] if i not in omitted)
        a, b = p['access']['start'], p['access']['end']
        shift = p['band']*math.tau*3200/3
        visits['neighbourhood-'+n['id']] = {'band': p['band'], 'position': [a[0]-shift, a[1]],
                                           'lookAt': [b[0]-shift, b[1]], 'heightHint': a[2]+.3}
    print(json.dumps({'verifiedNativeBalconyGuards': verified_guards, 'exporting': len(parcels)-len(omitted)}), flush=True)
    cleanup = {}
    def clean_fixed(packed):
        result, removed = clean_ground(packed)
        cleanup.update(removed)
        result,cleanup['simplification']=simplify_packed_collision(result)
        result=refine_city_ground(result)
        result,cleanup['finalization']=finalize_packed_collision(result)
        return result
    result = export({'layer': 'neighbourhoods', 'contractPath': contract_path,
                     'scene': scene.name, 'owner': scene['owner'],
                     'omitParcelIds': sorted(omitted), 'compositionHash': composition['planHash'],
                     'outputRoot': output_root,
                     'preserveLayout': preserve_layout,
                     'appearanceOnly': appearance_only,
                     'evidence': str(output_root/'export-neighbourhoods'),
                     'visits': visits, 'lightSources': True,
                     'fixedTransform': clean_fixed,
                     'surfaceTransform': lambda surfaces: merge_adjacent_frontages(surfaces, contract['parcels'])})
    result['verifiedNativeBalconyGuards'] = verified_guards
    result['removedDegenerateGround'] = cleanup
    result['status'] = ('site-preserving city revision exported; regional/far runtime must be regenerated'
                        if preserve_layout else
                        'composed city exported; rebuild dependent grounds and regional runtime before installation')
    (output_root/'export-neighbourhoods/result.json').write_text(json.dumps(result, indent=2)+'\n')
    print(json.dumps(result, indent=2), flush=True)


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--output-root', type=Path, required=True)
    parser.add_argument('--native-root', type=Path, default=ASSETS)
    parser.add_argument('--preserve-layout', action='store_true')
    parser.add_argument('--appearance-only', action='store_true',
                        help='Require unchanged drawing and physical surfaces as well as parcel layout')
    args = parser.parse_args(sys.argv[sys.argv.index('--')+1:])
    export_city(args.output_root, args.native_root, args.preserve_layout or args.appearance_only, args.appearance_only)
