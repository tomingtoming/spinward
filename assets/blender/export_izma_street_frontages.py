"""Export the saved native pavement scene without replacing any upstream layer."""
import bpy
import hashlib
import json
import sys
from pathlib import Path
from collections import defaultdict

sys.path.insert(0,str(Path(__file__).resolve().parent))
from izma_authoring_paths import authoring_root,city_asset_name
ROOT=authoring_root()
ASSETS=ROOT/'assets/blender'
sys.path.insert(0,str(ASSETS))
from colony_manifest_io import read_manifest,write_manifest,encoded
from izma_block_composition import invalidate_blocks
from izma_street_frontages import triangle_altitude
from izma_collision_mesh import simplify_collision_surface,simplify_packed_collision
from colony_collision_partition import refine_city_ground

contract=json.loads((ASSETS/city_asset_name('izma-street-frontages.json')).read_text())
for name,digest in contract['dependencies'].items():
    assert hashlib.sha256((ASSETS/name).read_bytes()).hexdigest()==digest,('Rebuild street frontages',name)
source=ROOT/'src/worlds/generated/izmaColony.json'
manifest=read_manifest(source)
manifest.pop('cornerBlocks',None)
invalidate_blocks(manifest)
manifest['tiles']=[t for t in manifest['tiles'] if not t.get('cornerBlock')]
manifest['visits']={k:v for k,v in manifest['visits'].items() if not k.startswith('corner-')}
assert hashlib.sha256(json.dumps([manifest['base']['vertices'],manifest['base']['meshes']['earth']],separators=(',',':')).encode()).hexdigest()==contract['terrainHash']
scene=bpy.data.scenes['SW_izma_street_frontages']
assert scene['owner']=='spinward-izma-street-frontages-v1'
scene.view_layers[0].update()
pool=[];lookup={};meshes=defaultdict(list);surfaces=[];degenerate_triangles=0
collision_triangles_removed=0;maximum_sampled_error=0
def indices(vertices):
    result=[]
    for v in vertices:
        key=tuple(round(n,5) for n in v)
        if key not in lookup:lookup[key]=len(pool)//3;pool.extend(key)
        result.append(lookup[key])
    return result
for obj in scene.objects:
    if obj.type!='MESH' or 'frontage_id' not in obj:continue
    mesh=obj.data;mesh.calc_loop_triangles();points=[];floor=[]
    for v in mesh.vertices:
        w=obj.matrix_world@v.co;points.append((-w.y,w.x,w.z))
    flags=mesh.attributes['ground_surface']
    for tri in mesh.loop_triangles:
        ids=indices([points[i] for i in tri.vertices])
        # Clipping can leave collinear triangle corners after native/export
        # rounding. Rapier produced lateral ghost contacts on those zero-area
        # faces. Remove them from both drawing and physics, at a 1 µm altitude.
        if triangle_altitude([pool[i*3:i*3+3] for i in ids])<=1e-6:
            degenerate_triangles+=1
            continue
        name='frontage-'+mesh.materials[tri.material_index].name.removeprefix('SWF_')
        assert name in ['frontage-paving','frontage-edge','frontage-rail']
        meshes[name].extend(ids)
        if flags.data[tri.polygon_index].value:floor.extend(ids)
    if floor:
        physical,error=simplify_collision_surface([pool[i*3:i*3+3] for i in floor],manifest['radius'])
        collision_triangles_removed+=len(floor)//3-len(physical)//3
        maximum_sampled_error=max(maximum_sampled_error,error)
        floor=indices(physical)
        assert len(floor)*3*8<=4*1024*1024,('Pavement collision compound exceeds budget',obj.name)
        xs=[pool[i*3] for i in floor];ys=[pool[i*3+1] for i in floor]
        surfaces.append({'indices':floor,'bounds':[min(xs),min(ys),max(xs),max(ys)]})

for name,definition in contract['materials'].items():
    manifest['palette']['frontage-'+name]=definition['color']
    manifest['materialDetails']['frontage-'+name]={k:v for k,v in definition.items() if k!='color'}
counts={'streets':len(contract['paths']),'districts':len({p['district'] for p in contract['paths']}),
        'length':sum(p['length'] for p in contract['paths']),
        'pavingArea':sum(p['pavingArea'] for p in contract['paths']),
        'fixedTriangles':sum(len(v)//3 for v in meshes.values()),
        'collisionTriangles':sum(len(s['indices'])//3 for s in surfaces),'surfaceGroups':len(surfaces),
        'degenerateTrianglesRemoved':degenerate_triangles,
        'collisionTrianglesRemoved':collision_triangles_removed,'maximumSampledCollisionError':maximum_sampled_error}
packed={'vertices':pool,'meshes':dict(meshes),'surfaces':surfaces}
if city_asset_name('izma-street-frontages.json')!='izma-street-frontages.json':
    packed,simplified=simplify_packed_collision(packed)
    packed=refine_city_ground(packed)
    counts['surfaceGroups']=len(packed['surfaces'])
    counts['collisionTriangles']=sum(len(s['indices'])//3 for s in packed['surfaces'])
    counts['collisionTrianglesRemoved']+=simplified['removedTriangles']
    counts['maximumSampledCollisionError']=max(counts['maximumSampledCollisionError'],simplified['maximumSampledError'])
manifest['streetFrontages']={'version':1,'fixed':packed,
                             'counts':counts,'paths':contract['paths']}
result=write_manifest(source,manifest)
out=ROOT/'qa/webxr/evidence/colony-street-corners-20260918'
out.mkdir(parents=True,exist_ok=True)
(out/'export.json').write_text(json.dumps({'counts':counts,**result},indent=2)+'\n')
print(json.dumps({'counts':counts,**result}),flush=True)
