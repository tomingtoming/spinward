"""Export the saved corner footprints, physical shells and all three LODs."""
import bpy
import hashlib
import json
import math
import sys
from collections import defaultdict
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parent))
from izma_authoring_paths import authoring_root
ROOT=authoring_root();ASSETS=ROOT/'assets/blender'
sys.path.insert(0,str(ASSETS))
from colony_manifest_io import read_manifest,write_manifest,encoded,write_immutable
from izma_street_frontages import triangle_altitude

contract=json.loads((ASSETS/'izma-corner-blocks.json').read_text())
assert hashlib.sha256((ASSETS/'izma-corner-blocks-plan.json').read_bytes()).hexdigest()==contract['planHash']
for name,digest in contract['dependencies'].items():
    assert hashlib.sha256((ASSETS/name).read_bytes()).hexdigest()==digest,('Reauthor corners',name)
source=ROOT/'src/worlds/generated/izmaColony.json';manifest=read_manifest(source)
assert hashlib.sha256(json.dumps([manifest['base']['vertices'],manifest['base']['meshes']['earth']],separators=(',',':')).encode()).hexdigest()==contract['terrainHash']
scene=bpy.data.scenes['SW_izma_corner_blocks'];assert scene['owner']=='spinward-izma-corner-blocks-v1'
scene.view_layers[0].update()
parcels={p['id']:p for p in contract['parcels']};geometry={pid:[defaultdict(list) for _ in range(3)] for pid in parcels}
physical=defaultdict(list);fixed=defaultdict(list)
for obj in scene.objects:
    if obj.type!='MESH' or 'corner_id' not in obj:continue
    pid=obj['corner_id'];lod=int(obj['lod']);mesh=obj.data;mesh.calc_loop_triangles()
    vertices=[]
    for v in mesh.vertices:
        w=obj.matrix_world@v.co;vertices.append(tuple(round(n,5) for n in (-w.y,w.x,w.z)))
    flags=mesh.attributes['ground_surface']
    for tri in mesh.loop_triangles:
        points=[vertices[i] for i in tri.vertices]
        if triangle_altitude(points)<=1e-6:continue
        material='arch-'+mesh.materials[tri.material_index].name.removeprefix('SWC_')
        if lod>=0:geometry[pid][lod][material].extend(points)
        elif lod==-1:fixed[material].extend(points)
        if lod<=0 and flags.data[tri.polygon_index].value:physical[pid].extend(points)


def pack(groups,surfaces=None):
    pool=[];lookup={}
    def indices(points):
        result=[]
        for p in points:
            if p not in lookup:lookup[p]=len(pool)//3;pool.extend(p)
            result.append(lookup[p])
        return result
    meshes={mat:indices(points) for mat,points in groups.items()};floor=[]
    for pid,points in (surfaces or {}).items():
        assert len(points)*3*8<4*1024*1024,('Oversized corner collision',pid)
        floor.append({'indices':indices(points),'bounds':[min(p[0] for p in points),min(p[1] for p in points),max(p[0] for p in points),max(p[1] for p in points)]})
    return {'vertices':pool,'meshes':meshes,'surfaces':floor}


manifest['tiles']=[t for t in manifest['tiles'] if not t.get('cornerBlock')]
manifest['visits']={k:v for k,v in manifest['visits'].items() if not k.startswith('corner-')}
tiles=defaultdict(list)
for p in parcels.values():
    x=sum(q[0] for q in p['outline'])/len(p['outline']);y=sum(q[1] for q in p['outline'])/len(p['outline'])
    tiles[(p['band'],math.floor((x-p['band']*math.tau*3200/3+math.pi*3200/6)/512),math.floor((y+20000)/512))].append(p['id'])
counts={'buildings':len(parcels),'districts':len({p['district'] for p in parcels.values()}),'nearTriangles':0,'midTriangles':0,'farTriangles':0,
        'fixedTriangles':sum(len(v)//3 for v in fixed.values()),'collisionTriangles':sum(len(v)//3 for v in physical.values()),'surfaceGroups':len(physical)}
files=[]
for cell,ids in sorted(tiles.items()):
    groups=[defaultdict(list) for _ in range(3)]
    for pid in ids:
        for lod in range(3):
            for mat,points in geometry[pid][lod].items():groups[lod][mat].extend(points)
    data=pack(groups[0]);data['mid']=pack(groups[1]);payload=encoded(data)
    assert len(payload)<4*1024*1024
    name='corner-'+'-'.join(map(str,cell));filename=name+'-'+hashlib.sha256(payload).hexdigest()[:12]+'.json'
    write_immutable(ROOT/'public/landscapes/izma'/filename,payload);files.append({'url':'/landscapes/izma/'+filename,'bytes':len(payload)})
    points=[p for values in groups[0].values() for p in values]
    manifest['tiles'].append({'id':name,'url':files[-1]['url'],'band':cell[0],'districts':sorted({parcels[i]['district'] for i in ids}),
        'bounds':[min(p[0] for p in points),min(p[1] for p in points),max(p[0] for p in points),max(p[1] for p in points)],
        'boxes':[],'proxyParts':[],'proxyMesh':pack(groups[2]),'architecture':True,'cornerBlock':True})
    for lod,name in enumerate(['nearTriangles','midTriangles','farTriangles']):counts[name]+=sum(len(v)//3 for v in groups[lod].values())
for p in parcels.values():
    a,b=p['entrance']['start'],p['entrance']['end'];offset=p['band']*math.tau*3200/3
    manifest['visits'][p['id']]={'band':p['band'],'position':[a[0]-offset,a[1]],'lookAt':[b[0]-offset,b[1]],'heightHint':a[2]}
manifest['cornerBlocks']={'version':1,'fixed':pack(fixed,physical),'counts':counts,'parcels':contract['parcels']}
result=write_manifest(source,manifest)
out=ROOT/'qa/webxr/evidence/colony-corner-buildings-20260918'
out.mkdir(parents=True,exist_ok=True)
(out/'export.json').write_text(json.dumps({'counts':counts,'files':files,**result},indent=2)+'\n')
print(json.dumps({'counts':counts,**result}),flush=True)
