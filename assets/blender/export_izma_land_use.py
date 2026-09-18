"""Export the saved land-use scene without regenerating other city layers."""
import bpy,json,math,hashlib
from pathlib import Path
import sys
sys.path.insert(0,str(Path(__file__).resolve().parent))
from colony_manifest_io import read_manifest, write_manifest
from izma_block_composition import invalidate_blocks
ROOT=Path(__file__).resolve().parents[2];ASSETS=ROOT/'assets/blender'
source=ROOT/'src/worlds/generated/izmaColony.json';manifest=read_manifest(source)
contract=json.loads((ASSETS/'izma-land-use.json').read_text());scene=bpy.data.scenes['SW_izma_land_use']
assert scene.get('owner')=='spinward-izma-land-use-v1'
for name,digest in contract['dependencies'].items():assert hashlib.sha256((ASSETS/name).read_bytes()).hexdigest()==digest,('Rebuild land use',name)
assert hashlib.sha256((ASSETS/'izma-land-use-layout.json').read_bytes()).hexdigest()==contract['layoutHash']
assert hashlib.sha256(json.dumps([manifest['base']['vertices'],manifest['base']['meshes']['earth']],separators=(',',':')).encode()).hexdigest()==contract['terrainHash']
scene.view_layers[0].update();fixed={};physical={};tiles={}
for obj in scene.objects:
    if obj.type!='MESH' or 'tile'not in obj:continue
    tile=tiles.setdefault(obj['tile'],{'band':int(obj['band']),'districts':set(),'lods':[{},{}]})
    tile['districts'].update(json.loads(obj['districts']));lod=int(obj['lod'])
    mesh=obj.data;mesh.calc_loop_triangles();vs=[]
    for v in mesh.vertices:
        w=obj.matrix_world@v.co;vs.append((-w.y,w.x,w.z))
    flags=mesh.attributes['physical']
    for tri in mesh.loop_triangles:
        points=[vs[i]for i in tri.vertices];name='land-'+mesh.materials[tri.material_index].name.removeprefix('SWL_')
        target=fixed if lod<0 else tile['lods'][lod];target.setdefault(name,[]).extend(points)
        if lod<=0 and flags.data[tri.polygon_index].value:
            # Trees/fixtures and ramps are local physical compounds. Ground
            # colour overlays reuse the existing native terrain's collision.
            x=sum(p[0]for p in points)/3;y=sum(p[1]for p in points)/3
            key=(math.floor(x/64),math.floor(y/64));physical.setdefault(key,[]).extend(points)

def pack(groups,surfaces=None):
    pool=[];lookup={}
    def ids(vs):
        out=[]
        for v in vs:
            p=tuple(round(n,5)for n in v)
            if p not in lookup:lookup[p]=len(pool)//3;pool.extend(p)
            out.append(lookup[p])
        return out
    meshes={k:ids(v)for k,v in groups.items()};ss=[]
    for vs in (surfaces or {}).values():
        ss.append({'indices':ids(vs),'bounds':[min(p[0]for p in vs),min(p[1]for p in vs),max(p[0]for p in vs),max(p[1]for p in vs)]})
    return {'vertices':pool,'meshes':meshes,'surfaces':ss}
manifest.pop('cornerBlocks',None)
invalidate_blocks(manifest)
manifest['tiles']=[t for t in manifest['tiles'] if not t.get('cornerBlock')]
manifest['visits']={k:v for k,v in manifest['visits'].items() if not k.startswith('corner-')}
manifest['tiles']=[t for t in manifest['tiles']if not t.get('landUse')]
manifest['visits']={k:v for k,v in manifest['visits'].items()if not k.startswith('land-')}
for name,d in contract['materials'].items():
    manifest['palette']['land-'+name]=d['color'];manifest['materialDetails']['land-'+name]={k:v for k,v in d.items()if k!='color'}
files=[];counts={'zones':len(contract['zones']),'fixtures':len(contract['fixtures']),'nearTriangles':0,'midTriangles':0,'fixedTriangles':sum(len(v)//3 for v in fixed.values()),'collisionTriangles':sum(len(v)//3 for v in physical.values())}
for name,tile in sorted(tiles.items()):
    if not tile['lods'][0]:continue
    data=pack(tile['lods'][0]);data['mid']=pack(tile['lods'][1]);encoded=json.dumps(data,separators=(',',':'))+'\n'
    assert len(encoded.encode())<4*1024*1024,('Land-use tile exceeds request bound',name)
    digest=hashlib.sha256(encoded.encode()).hexdigest()[:12];filename=f'land-{name}-{digest}.json'
    (ROOT/'public/landscapes/izma'/filename).write_text(encoded);files.append({'url':'/landscapes/izma/'+filename,'bytes':len(encoded.encode())})
    vs=[p for group in tile['lods'][0].values()for p in group]
    for lod,key in [(0,'nearTriangles'),(1,'midTriangles')]:counts[key]+=sum(len(v)//3 for v in tile['lods'][lod].values())
    manifest['tiles'].append({'id':'land-'+name,'url':files[-1]['url'],'band':tile['band'],'districts':sorted(tile['districts']),
        'bounds':[min(p[0]for p in vs),min(p[1]for p in vs),max(p[0]for p in vs),max(p[1]for p in vs)],
        'boxes':[],'proxyParts':contract['proxies'].get(name,[]),'landUse':True,'architecture':True})
for z in contract['zones']:
    if not z['access']:continue
    a=z['access']['profile'][0];b=z['access']['profile'][-1];offset=z['band']*math.tau*3200/3
    manifest['visits']['land-'+z['id']]={'band':z['band'],'position':[a[0]-offset,a[1]],'lookAt':[b[0]-offset,b[1]],'heightHint':a[2]}
manifest['landUse']={'version':1,'fixed':pack(fixed,physical),'counts':counts,
    'zones':[{k:z[k]for k in ['id','district','band','use','area','access','accessRejected','fixtures']}for z in contract['zones']]}
write_manifest(source, manifest)
out=ROOT/'qa/webxr/evidence/colony-land-use-20260918';out.mkdir(parents=True,exist_ok=True)
result={'counts':counts,'files':files,'manifestBytes':source.stat().st_size,'sourceHash':hashlib.sha256((ASSETS/'izma-land-use.blend').read_bytes()).hexdigest()}
(out/'export.json').write_text(json.dumps(result,indent=2)+'\n')
