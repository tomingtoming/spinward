"""Install the saved complete blocks after their replacement reservations.

Near, middle and distant polygons come from the same saved Blender scene.
Only explicitly retired neighbourhood IDs disappear; the source scene remains
available to the authoring pipeline. Courts are split into local compounds.
"""
import bpy,json,hashlib,math,sys,os
from pathlib import Path
from collections import defaultdict
sys.path.insert(0,str(Path(__file__).resolve().parent))
from izma_authoring_paths import authoring_root,city_asset_name
ROOT=authoring_root();ASSETS=ROOT/'assets/blender'
sys.path.insert(0,str(ASSETS))
from colony_manifest_io import read_manifest,write_manifest,encoded,write_immutable
from izma_block_composition import read_composition,invalidate_blocks
from izma_street_frontages import triangle_altitude
from izma_collision_mesh import simplify_collision_candidates
from colony_collision_partition import merge_adjacent_frontages

plan=read_composition(ASSETS);source=ROOT/'src/worlds/generated/izmaColony.json';manifest=read_manifest(source)
scene=bpy.data.scenes['SW_izma_blocks'];scene.view_layers[0].update()
assert scene['owner']=='spinward-izma-complete-blocks-v1' and scene['plan_hash']==plan['planHash'],'Rebuild native complete blocks'
assert manifest['neighbourhoods']['blockComposition']=={'planHash':plan['planHash'],'omittedParcelIds':sorted(plan['retiredParcelIds'])},'Export the neighbourhood replacement composition first'
assert not set(plan['retiredParcelIds']) & {p['id'] for p in manifest['neighbourhoods']['parcels']}
for name in [city_asset_name('izma-land-use-layout.json'),city_asset_name('izma-street-frontages.json'),'izma-corner-blocks-plan.json']:
    dependencies=json.loads((ASSETS/name).read_text())['dependencies']
    assert dependencies.get('izma-block-parcels.json')==plan['planHash'],('Reauthor block reservations',name)
assert hashlib.sha256(json.dumps([manifest['base']['vertices'],manifest['base']['meshes']['earth']],separators=(',',':')).encode()).hexdigest()==plan['terrainHash']
blocks={b['id']:b for b in plan['blocks']};parcels={p['id']:p for b in blocks.values() for p in b['plots']}
geometry={b:[defaultdict(list) for _ in range(3)] for b in blocks};fixed=defaultdict(list);physical=defaultdict(list)
discarded=0
for obj in scene.objects:
    if obj.type!='MESH' or obj.get('block_id') not in blocks:continue
    bid=obj['block_id'];pid=obj['parcel_id'];lod=int(obj['lod']);mesh=obj.data;mesh.calc_loop_triangles()
    vertices=[]
    for v in mesh.vertices:
        p=obj.matrix_world@v.co;vertices.append(tuple(round(n,5) for n in (-p.y,p.x,p.z)))
    flags=mesh.attributes['ground_surface']
    for tri in mesh.loop_triangles:
        points=[vertices[i] for i in tri.vertices]
        if triangle_altitude(points)<=1e-6:discarded+=1;continue
        material='arch-'+mesh.materials[tri.material_index].name.removeprefix('SWB_')
        if lod>=0:geometry[bid][lod][material].extend(points)
        elif lod==-1:fixed[material].extend(points)
        if lod<=0 and flags.data[tri.polygon_index].value:
            key=pid if pid in parcels else bid+'-court'
            physical[key].extend(points)
maximum_error=0;removed=0
for key,points in list(physical.items()):
    if key in parcels:continue
    simplified,error=simplify_collision_candidates(points)
    removed+=(len(points)-len(simplified))//3;physical[key]=simplified;maximum_error=max(maximum_error,error)
addresses=[]
for block in blocks.values():
    for p in block['plots']:
        a,b=block['boundary'][p['edge']],block['boundary'][(p['edge']+1)%len(block['boundary'])]
        addresses.append({**p,'route':block['id']+'-edge-'+str(p['edge']),'yaw':math.atan2(b[1]-a[1],b[0]-a[0]),
            'frontage':p['entrance']['end'],'lot':{'placement':'block-frontage','width':math.dist(*p['front'])}})
physical=merge_adjacent_frontages(physical,addresses)


def pack(groups,surfaces=None):
    pool=[];lookup={}
    def indices(points):
        result=[]
        for p in points:
            p=tuple(p)
            if p not in lookup:lookup[p]=len(pool)//3;pool.extend(p)
            result.append(lookup[p])
        return result
    meshes={mat:indices(points) for mat,points in groups.items()};ss=[]
    for key,points in (surfaces or {}).items():
        assert len(points)*24<4*1024*1024,('Oversized block collision',key)
        ss.append({'indices':indices(points),'bounds':[min(p[0] for p in points),min(p[1] for p in points),max(p[0] for p in points),max(p[1] for p in points)]})
    return {'vertices':pool,'meshes':meshes,'surfaces':ss}


invalidate_blocks(manifest);files=[]
counts={'buildings':len(parcels),'blocks':len(blocks),'nearTriangles':0,'midTriangles':0,'farTriangles':0,
    'fixedTriangles':sum(len(v)//3 for v in fixed.values()),'collisionTriangles':sum(len(v)//3 for v in physical.values()),'surfaceGroups':len(physical)}
for bid,block in blocks.items():
    lods=geometry[bid];data=pack(lods[0]);data['mid']=pack(lods[1]);payload=encoded(data)
    assert len(payload)<4*1024*1024,('Block exceeds detail request budget',bid)
    ident='block-'+bid;filename=ident+'-'+hashlib.sha256(payload).hexdigest()[:12]+'.json'
    write_immutable(ROOT/'public/landscapes/izma'/filename,payload);files.append({'url':'/landscapes/izma/'+filename,'bytes':len(payload)})
    points=[p for values in lods[0].values() for p in values]
    manifest['tiles'].append({'id':ident,'url':files[-1]['url'],'band':block['band'],'districts':[block['district']],
        'bounds':[min(p[0] for p in points),min(p[1] for p in points),max(p[0] for p in points),max(p[1] for p in points)],
        'boxes':[],'proxyParts':[],'proxyMesh':pack(lods[2]),'architecture':True,'completeBlock':True})
    for lod,key in enumerate(['nearTriangles','midTriangles','farTriangles']):counts[key]+=sum(len(v)//3 for v in lods[lod].values())
    gate=block['gates'][0];a,b=gate['start'],gate['end'];shift=block['band']*math.tau*3200/3
    manifest['visits'][ident]={'band':block['band'],'position':[a[0]-shift,a[1]],'lookAt':[b[0]-shift,b[1]],'heightHint':min(p['floor'] for p in block['plots'])}
manifest['cityBlocks']={'version':1,'fixed':pack(fixed,physical),'planHash':plan['planHash'],
    'retiredParcelIds':plan['retiredParcelIds'],'counts':counts,'blocks':plan['blocks']}
result=write_manifest(source,manifest)
out=Path(os.environ.get('SPINWARD_BLOCK_EVIDENCE',str(ROOT/'qa/webxr/evidence/colony-block-replot-20260918')))
out.mkdir(parents=True,exist_ok=True)
(out/'export.json').write_text(json.dumps({'counts':counts,'files':files,'discardedDegenerateTriangles':discarded,
    'simplifiedCollisionTriangles':removed,'maximumSampledCollisionError':maximum_error,**result},indent=2)+'\n')
print(json.dumps({'counts':counts,**result}),flush=True)
