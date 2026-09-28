"""Save Blender-derived distant ground and lossless nearby regions.

Run in isolated Blender after the last native colony export. The full authoring
document stays intact; runtime metadata records its hash to reject stale builds.
"""
import bpy, bmesh, math, json, sys
from pathlib import Path
ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'assets/blender'))
from colony_manifest_io import read_manifest
from colony_regions import export_regions

owner = 'spinward-izma-regions-v1'
scene = bpy.data.scenes.new('SW_izma_far_ground')
scene['owner'] = owner
bpy.context.window.scene = scene


def coarsen(vertices, indices):
    used = sorted(set(indices)); lookup = {i: j for j, i in enumerate(used)}
    points = [vertices[i * 3:i * 3 + 3] for i in used]
    faces = [[lookup[i] for i in indices[j:j + 3]] for j in range(0, len(indices), 3)]
    mesh = bpy.data.meshes.new('region-candidate')
    mesh.from_pydata(points, [], faces); mesh.update()
    bm = bmesh.new(); bm.from_mesh(mesh)
    # Keep outer boundaries and sharp height changes. Only the distant drawing
    # is simplified; the original triangles remain in the local region payload.
    bmesh.ops.dissolve_limit(bm, angle_limit=.005, use_dissolve_boundaries=False,
                             verts=list(bm.verts), edges=list(bm.edges))
    bmesh.ops.triangulate(bm, faces=list(bm.faces))
    bm.verts.ensure_lookup_table(); bm.verts.index_update()
    points = [tuple(v.co) for v in bm.verts]
    faces = [tuple(v.index for v in f.verts) for f in bm.faces]
    bm.free(); bpy.data.meshes.remove(mesh)
    # Unrolling a long flat face into the cylinder must not create a kilometre
    # chord. A <=64m circumferential span limits cylindrical chord sag to .16m.
    pending = list(faces); faces = []
    while pending:
        face = pending.pop()
        a, b = max(((face[i], face[(i + 1) % 3]) for i in range(3)), key=lambda edge: abs(points[edge[0]][0] - points[edge[1]][0]))
        if abs(points[a][0] - points[b][0]) <= 64:
            faces.append(face); continue
        mid = len(points); points.append(tuple((points[a][k] + points[b][k]) / 2 for k in range(3)))
        i = next(i for i in range(3) if face[i] == a and face[(i + 1) % 3] == b)
        c = face[(i + 2) % 3]
        pending.extend([(a, mid, c), (mid, b, c)])
    return points, faces


manifest = read_manifest(ROOT / 'src/worlds/generated/izmaColony.json')
result, runtime = export_regions(ROOT, manifest, coarsen)
far = runtime['base']
materials = {}
for name, ids in far['meshes'].items():
    used = sorted(set(ids)); lookup = {i: j for j, i in enumerate(used)}
    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata([far['vertices'][i * 3:i * 3 + 3] for i in used], [],
                     [tuple(lookup[i] for i in ids[j:j + 3]) for j in range(0, len(ids), 3)])
    obj = bpy.data.objects.new(name, mesh); scene.collection.objects.link(obj)
    material = bpy.data.materials.new(name)
    value = runtime['palette'][name].lstrip('#')
    material.diffuse_color = tuple(int(value[k:k + 2], 16) / 255 for k in (0, 2, 4)) + (1,)
    mesh.materials.append(material)
scene['source_sha256'] = result['sourceSha256']
# Independent derivative blend; the opened source and GUI scene are untouched.
bpy.ops.wm.save_as_mainfile(filepath=str(ROOT / 'assets/blender/izma-far-ground.blend'))
out = ROOT / 'qa/webxr/evidence/colony-regions-20260918'
out.mkdir(parents=True, exist_ok=True)
(out / 'export.json').write_text(json.dumps(result, indent=2) + '\n')
print(json.dumps(result))
