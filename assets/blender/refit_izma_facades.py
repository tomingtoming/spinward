"""Refresh the saved primary/infill facades without replotting land or entries.

Run an isolated Blender CLI with either izma-districts.blend or
izma-neighbourhoods.blend. Only the named parcel LOD objects are replaced.
Ground-face multisets must stay exactly equal before the source is saved.
"""
import bpy, hashlib, json, sys
from collections import Counter
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent))
from izma_mesh_builder import BuildingMeshBuilder
from izma_building_meshes import render_building
from izma_facades import seed

ROOT = Path(__file__).resolve().parents[2]
name = Path(bpy.data.filepath).stem
assert name in ['izma-districts', 'izma-neighbourhoods'], ('Unexpected source', name)
infill = name == 'izma-neighbourhoods'
scene = bpy.data.scenes['SW_izma_neighbourhoods' if infill else 'SW_izma_districts']
assert scene.get('owner') == ('spinward-izma-neighbourhoods-v1' if infill else 'spinward-izma-districts-v1')
contract_path = ROOT / 'assets/blender' / ('izma-neighbourhood-parcels.json' if infill else 'izma-parcels.json')
contract_bytes = contract_path.read_bytes()
contract = json.loads(contract_bytes)
materials = {name: bpy.data.materials['SWD_' + name] for name in contract['materials']}
config = {'variedMassing': infill, 'shopAwningBottom': 2.50 if infill else 2.55}

def physical_faces(objects):
    faces = Counter()
    for obj in objects:
        mesh = obj.data
        flags = mesh.attributes['ground_surface']
        mesh.calc_loop_triangles()
        for tri in mesh.loop_triangles:
            if flags.data[tri.polygon_index].value:
                points = tuple(tuple(mesh.vertices[i].co) for i in tri.vertices)
                faces[min(points[i:] + points[:i] for i in range(3))] += 1
    return faces

counts = [0, 0]
objects = {obj.name: obj for obj in scene.objects}
for i, parcel in enumerate(contract['parcels']):
    old = [objects[parcel['id'] + '_lod' + str(lod)] for lod in [0, 1]]
    before = [physical_faces([obj]) for obj in old]
    render_building(lambda: BuildingMeshBuilder(scene, materials, objects), parcel, seed(parcel['id']), config)
    for lod in [0, 1]:
        obj = objects[parcel['id'] + '_lod' + str(lod)]
        assert physical_faces([obj]) == before[lod], ('Physical support changed', parcel['id'], lod)
        obj['facade_revision'] = 'recessed-openings-v2'
        counts[lod] += len(obj.data.loop_triangles)
    if i % 500 == 0: print('FACADE', name, i, flush=True)

lights = 0
if infill:
    for obj in scene.objects:
        if obj.type == 'LIGHT' and 'parcel_id' in obj:
            obj.data.energy = 140
            obj['intensity'] = 140
            obj['distance'] = 28
            lights += 1
scene['facade_revision'] = 'recessed-openings-v2'
scene.view_layers[0].update()
assert contract_path.read_bytes() == contract_bytes
bpy.data.libraries.write(str(ROOT / 'assets/blender' / (name + '.blend')), {scene}, fake_user=True, compress=True)
result = {'source': name, 'parcels': len(contract['parcels']), 'nearTriangles': counts[0],
          'midTriangles': counts[1], 'retunedLights': lights,
          'contractSha256': hashlib.sha256(contract_bytes).hexdigest(), 'physicalFacesUnchanged': True}
out = ROOT / 'qa/webxr/evidence/colony-facades-20260918'
out.mkdir(parents=True, exist_ok=True)
(out / (name + '-native.json')).write_text(json.dumps(result, indent=2) + '\n')
print(json.dumps(result), flush=True)
