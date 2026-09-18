"""Remove only native balcony backs coincident with the opaque main wall.

This migrates saved facades without replotting or regenerating other geometry.
The building recipe also omits these faces on subsequent complete rebuilds.
"""
import bpy, bmesh, json, sys
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(Path(__file__).resolve().parent))
from izma_building_forms import building_form
from izma_facades import seed
name = Path(bpy.data.filepath).stem
assert name in ['izma-districts', 'izma-neighbourhoods']
infill = name == 'izma-neighbourhoods'
scene = bpy.data.scenes['SW_izma_neighbourhoods' if infill else 'SW_izma_districts']
contract_path = ROOT / 'assets/blender' / ('izma-neighbourhood-parcels.json' if infill else 'izma-parcels.json')
contract = json.loads(contract_path.read_text())

def physical(mesh):
    mesh.calc_loop_triangles()
    flags = mesh.attributes['ground_surface']
    faces = Counter()
    for tri in mesh.loop_triangles:
        if flags.data[tri.polygon_index].value:
            points = tuple(tuple(mesh.vertices[i].co) for i in tri.vertices)
            faces[min(points[i:] + points[:i] for i in range(3))] += 1
    return faces

removed = changed = 0
for p in contract['parcels']:
    if p['family'] != 'apartment': continue
    _, expected, _ = building_form(p['family'], *p['size'][:2], p['floors'], 3.2, seed(p['id']), infill)
    volume = p.get('volumes', expected)[0]
    u, v, z, w, d, h = volume
    for lod in [0, 1]:
        mesh = bpy.data.objects[p['id'] + '_lod' + str(lod)].data
        before = physical(mesh)
        indices = []
        for face in mesh.polygons:
            if mesh.materials[face.material_index].name != 'SWD_foundation': continue
            vs = [mesh.vertices[i].co for i in face.vertices]
            low, high = min(q.z for q in vs), max(q.z for q in vs)
            level = round((high-z) / 3.2)
            if (all(abs(q.y - (v-d/2)) < 1e-5 for q in vs)
                    and .15 < high-low < .17 and level >= 1
                    and abs(high-(z+level*3.2)) < 1e-5
                    and all(abs(q.x-u) <= w*.46+1e-5 for q in vs)):
                assert not mesh.attributes['ground_surface'].data[face.index].value
                indices.append(face.index)
        if not indices: continue
        bm = bmesh.new()
        try:
            bm.from_mesh(mesh); bm.faces.ensure_lookup_table()
            bmesh.ops.delete(bm, geom=[bm.faces[i] for i in indices], context='FACES_ONLY')
            bm.to_mesh(mesh)
        finally: bm.free()
        mesh.update()
        assert physical(mesh) == before, ('Physical support changed', p['id'], lod)
        removed += len(indices); changed += 1
scene['balcony_back_revision'] = 1
bpy.data.libraries.write(str(ROOT / 'assets/blender' / (name + '.blend')), {scene}, fake_user=True, compress=True)
result = {'source': name, 'changedLODs': changed, 'removedHiddenFaces': removed, 'physicalFacesUnchanged': True}
out = ROOT / 'qa/webxr/evidence/colony-facades-20260918'
(out / (name + '-balcony-backs.json')).write_text(json.dumps(result, indent=2) + '\n')
print(json.dumps(result), flush=True)
