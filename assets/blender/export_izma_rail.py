"""Export saved track/station/vehicle meshes, preserving all existing districts."""
import bpy,json,hashlib,math
from pathlib import Path
import sys
sys.path.insert(0,str(Path(__file__).resolve().parent))
from colony_manifest_io import read_manifest, write_manifest
ROOT=Path(__file__).resolve().parents[2]
contract=json.loads((ROOT/'assets/blender/izma-rail.json').read_text())
for name,digest in contract['dependencies'].items():
    assert hashlib.sha256((ROOT/'assets/blender'/name).read_bytes()).hexdigest()==digest,('Rebuild rail after changed reservation',name)
scene=bpy.data.scenes['SW_izma_rail'];assert scene.get('owner')=='spinward-izma-rail-v1';scene.view_layers[0].update()
path=ROOT/'src/worlds/generated/izmaColony.json';manifest=read_manifest(path)
manifest.pop('landUse',None)
manifest.pop('streetFrontages',None)
manifest.pop('cornerBlocks',None)
manifest['tiles']=[t for t in manifest['tiles'] if not t.get('cornerBlock')]
manifest['visits']={k:v for k,v in manifest['visits'].items() if not k.startswith('corner-')}
manifest['tiles']=[t for t in manifest['tiles']if not t.get('landUse')]
manifest['visits']={k:v for k,v in manifest['visits'].items()if not k.startswith('land-')}
assert hashlib.sha256(json.dumps(manifest['base'],sort_keys=True,separators=(',',':')).encode()).hexdigest()==contract['baseDigest'],'Rebuild rail after terrain changes'
stations={s['id']:s for s in contract['stations']};tiles={};fixed={};physics={};vehicles={};tile_bands={}
def pack(groups,surfaces=None):
    vertices=[];lookup={}
    def indices(points):
        result=[]
        for p in points:
            q=tuple(round(n,5)for n in p)
            if q not in lookup:lookup[q]=len(vertices)//3;vertices.extend(q)
            result.append(lookup[q])
        return result
    meshes={m:indices(v)for m,v in groups.items()};ss=[]
    for points in (surfaces or {}).values():
        xs=[p[0]for p in points];ys=[p[1]for p in points]
        ss.append({'indices':indices(points),'bounds':[min(xs),min(ys),max(xs),max(ys)]})
    return {'vertices':vertices,'meshes':meshes,'surfaces':ss}
for obj in scene.objects:
    if obj.type!='MESH' or 'rail_id'not in obj:continue
    id=obj['rail_id'];lod=int(obj['lod']);kind=obj['kind'];station=None
    if kind=='station':station=next(s for s in stations if id.startswith('station-'+s))
    tile_id='station-'+station if station else id
    tile_bands[tile_id]=int(obj['band'])
    mesh=obj.data;mesh.calc_loop_triangles();points=[]
    for v in mesh.vertices:
        q=obj.matrix_world@v.co;points.append((-q.y,q.x,q.z))
    groups=vehicles.setdefault(id,[{},{}])[lod]if kind=='vehicle'else fixed if lod<0 else tiles.setdefault(tile_id,[{},{}])[lod]
    flags=mesh.attributes.get('physical')
    for tri in mesh.loop_triangles:
        mat='rail-'+mesh.materials[tri.material_index].name.removeprefix('SWR_');vs=[points[i]for i in tri.vertices]
        groups.setdefault(mat,[]).extend(vs)
        if kind=='station'and lod<=0 and flags and flags.data[tri.polygon_index].value:
            physics.setdefault(station,[]).extend(vs)
manifest['tiles']=[t for t in manifest['tiles']if not t.get('railway')]
manifest['visits']={k:v for k,v in manifest['visits'].items()if not k.startswith('station-')}
for name,definition in contract['materials'].items():
    manifest['palette']['rail-'+name]=definition['color']
    manifest['materialDetails']['rail-'+name]={k:v for k,v in definition.items()if k!='color'}
files=[]
for id,lods in sorted(tiles.items()):
    data=pack(lods[0]);data['mid']=pack(lods[1]);encoded=json.dumps(data,separators=(',',':'))+'\n'
    assert len(encoded.encode())<4*1024*1024,(id,len(encoded))
    filename=id+'-'+hashlib.sha256(encoded.encode()).hexdigest()[:12]+'.json'
    (ROOT/'public/landscapes/izma'/filename).write_text(encoded)
    vs=[p for points in lods[0].values()for p in points];proxies=[]
    station=stations.get(id.removeprefix('station-'))
    band=tile_bands[id]
    if station:
        x,y,z=station['platform'];roof_length=station['roofLength']
        proxies.append([x,y,z+2.6,3.2,roof_length,.16,station['yaw'],'rail-roof','box'])
    manifest['tiles'].append({'id':id,'url':'/landscapes/izma/'+filename,'band':band,'bounds':[min(p[0]for p in vs),min(p[1]for p in vs),max(p[0]for p in vs),max(p[1]for p in vs)],
        'districts':[station['id']]if station else [],'boxes':[],'proxyParts':proxies,'architecture':True,'railway':True})
    files.append({'url':'/landscapes/izma/'+filename,'bytes':len(encoded.encode())})
for station in stations.values():
    a=station['entry'];b=station['platform'];offset=station['band']*math.tau*3200/3
    manifest['visits']['station-'+station['id']]={'band':station['band'],'position':[a[0]-offset,a[1]],'lookAt':[b[0]-offset,b[1]],'heightHint':a[2]}
lights=[];vehicle_light=None
for obj in scene.objects:
    if obj.type=='LIGHT'and 'rail_id'in obj:
        q=obj.matrix_world.translation;light={'position':[-q.y,q.x,q.z],'color':obj['color'],'intensity':obj['intensity'],'distance':obj['distance']}
        if obj.get('kind')=='vehicle':vehicle_light=light
        else:lights.append(light)
manifest['railways']={'version':1,'configuration':contract['configuration'],'lines':contract['lines'],'stations':contract['stations'],
    'fixed':pack(fixed,physics),'lights':lights,'vehicleLight':vehicle_light,'vehicle':{id:{**pack(lods[0]),'mid':pack(lods[1])}for id,lods in vehicles.items()}}
write_manifest(path, manifest)
out=ROOT/'qa/webxr/evidence/colony-rail-20260918';out.mkdir(parents=True,exist_ok=True)
result={'stations':len(stations),'lines':len(contract['lines']),'tiles':len(files),'totalTileBytes':sum(f['bytes']for f in files),'largestTileBytes':max(f['bytes']for f in files),
    'fixedTriangles':sum(len(v)//3 for v in fixed.values()),'collisionTriangles':sum(len(v)//3 for v in physics.values()),'vehicleParts':len(vehicles),'files':files}
(out/'export.json').write_text(json.dumps(result,indent=2)+'\n')
