"""Export saved public-space meshes after district architecture.

Only this owner's tiles/materials/visits/publicRealm are replaced. Terrain,
transport and building geometry are preserved. Tiny ground meshes stay
resident; furniture/vegetation use the existing bounded near/mid tile cache.
"""
import bpy, json, math, hashlib
from pathlib import Path

ROOT=Path(__file__).resolve().parents[2];R=3200;SPACING=math.tau*R/3
source=ROOT/'src/worlds/generated/izmaColony.json'
manifest=json.loads(source.read_text())
contract=json.loads((ROOT/'assets/blender/izma-public-spaces.json').read_text())
scene=bpy.data.scenes['SW_izma_public'];scene.view_layers[0].update()
assert scene.get('owner')=='spinward-izma-public-v1'
terrain_hash=hashlib.sha256(json.dumps([manifest['base']['vertices'],manifest['base']['meshes']['earth']],separators=(',',':')).encode()).hexdigest()
assert contract['terrainHash']==terrain_hash
assert contract['parcelsHash']==hashlib.sha256((ROOT/'assets/blender/izma-parcels.json').read_bytes()).hexdigest()
places={p['id']:p for p in contract['places']}
fixed={};physics={};meshes={pid:[{},{}]for pid in places}
for obj in scene.objects:
    if obj.type!='MESH' or 'place_id' not in obj:continue
    pid=obj['place_id'];lod=int(obj['lod']);mesh=obj.data;mesh.calc_loop_triangles()
    vertices=[]
    for v in mesh.vertices:
        w=obj.matrix_world@v.co;vertices.append((-w.y,w.x,w.z))
    physical=mesh.attributes['physical']
    for tri in mesh.loop_triangles:
        material='public-'+mesh.materials[tri.material_index].name.removeprefix('SWP_')
        vs=[vertices[i]for i in tri.vertices]
        groups=fixed if lod<0 else meshes[pid][lod]
        groups.setdefault(material,[]).extend(vs)
        if lod<=0 and physical.data[tri.polygon_index].value:
            physics.setdefault(pid,[]).extend(vs)

def pack(groups,surfaces=None):
    pool=[];lookup={}
    def indices(vs):
        ids=[]
        for v in vs:
            p=tuple(round(n,5)for n in v)
            if p not in lookup:lookup[p]=len(pool)//3;pool.extend(p)
            ids.append(lookup[p])
        return ids
    drawing={m:indices(vs)for m,vs in groups.items()};ss=[]
    for vs in (surfaces or {}).values():
        xs=[v[0]for v in vs];ys=[v[1]for v in vs]
        ss.append({'indices':indices(vs),'bounds':[min(xs),min(ys),max(xs),max(ys)]})
    return {'vertices':pool,'meshes':drawing,'surfaces':ss}

# Neighbourhood lots reserve this public-space contract. Re-export them after
# the square layer, so moving a square cannot leave intersecting stale houses.
manifest.pop('neighbourhoods',None)
manifest['visits']={k:v for k,v in manifest['visits'].items()if not k.startswith('neighbourhood-')}
manifest['tiles']=[t for t in manifest['tiles']if not t.get('publicRealm')and not t.get('neighbourhood')]
manifest.setdefault('materialDetails',{})
for name,definition in contract['materials'].items():
    manifest['palette']['public-'+name]=definition['color']
    manifest['materialDetails']['public-'+name]={k:v for k,v in definition.items()if k!='color'}
counts={'places':len(places),'trees':sum(p['trees']for p in places.values()),'nearTriangles':0,'midTriangles':0,
        'fixedTriangles':sum(len(v)//3 for v in fixed.values()),'collisionTriangles':sum(len(v)//3 for v in physics.values())}
files=[]
for pid,p in places.items():
    data=pack(meshes[pid][0]);data['mid']=pack(meshes[pid][1])
    for lod,key in [(0,'nearTriangles'),(1,'midTriangles')]:counts[key]+=sum(len(v)//3 for v in meshes[pid][lod].values())
    encoded=json.dumps(data,separators=(',',':'))+'\n'
    assert len(encoded.encode())<4*1024*1024
    name='public-'+pid;digest=hashlib.sha256(encoded.encode()).hexdigest()[:12];filename=name+'-'+digest+'.json'
    (ROOT/'public/landscapes/izma'/filename).write_text(encoded)
    files.append({'url':'/landscapes/izma/'+filename,'bytes':len(encoded.encode())})
    proxies=[];x,y=p['position'];c,s=math.cos(p['yaw']),math.sin(p['yaw'])
    for u,v,z,w,d,h,material,shape in p['proxyParts']:
        proxies.append([x+c*u-s*v,y+s*u+c*v,z,w,d,h,p['yaw'],'public-'+material,shape])
    vs=[v for group in meshes[pid][0].values()for v in group]
    manifest['tiles'].append({'id':name,'url':files[-1]['url'],'band':p['band'],
        'bounds':[min(v[0]for v in vs),min(v[1]for v in vs),max(v[0]for v in vs),max(v[1]for v in vs)],
        'districts':[pid],'boxes':[],'proxyParts':proxies,'architecture':True,'publicRealm':True})
    manifest['visits']['public-'+pid]={'band':p['band'],
        'position':[p['entry'][0]-p['band']*SPACING,p['entry'][1]],
        'lookAt':[p['target'][0]-p['band']*SPACING,p['target'][1]],'heightHint':p['entry'][2]}
manifest['publicRealm']={'version':1,'fixed':pack(fixed,physics),'counts':counts,
    'places':[{k:p[k]for k in ['id','band','name','layout','entry','target']}for p in places.values()]}
manifest['publicRealm']['lights']=[]
for obj in scene.objects:
    if obj.type!='LIGHT' or 'place_id' not in obj:continue
    w=obj.matrix_world.translation
    manifest['publicRealm']['lights'].append({'position':[-w.y,w.x,w.z],
        'color':obj['color'],'intensity':obj['intensity'],'distance':obj['distance']})
source.write_text(json.dumps(manifest,separators=(',',':'))+'\n')
out=ROOT/'qa/webxr/evidence/colony-public-20260918';out.mkdir(parents=True,exist_ok=True)
result={'counts':counts,'files':files,'terrainHash':terrain_hash,'manifestBytes':source.stat().st_size,
        'sourceHash':hashlib.sha256((ROOT/'assets/blender/izma-public-spaces.blend').read_bytes()).hexdigest()}
(out/'export.json').write_text(json.dumps(result,indent=2)+'\n')
