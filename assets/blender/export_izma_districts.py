"""Export saved district meshes to bounded building tiles with three LODs.

The terrain/transport base is preserved byte-for-byte as parsed data. Near and
middle facades share each tile request; inexpensive roof/body primitives are
resident so the silhouette survives a missing tile. Ground/roof collision is
independent of detail requests. Run after export_izma_colony.py.
"""
import bpy, json, math, hashlib
from pathlib import Path
from mathutils import Vector

def export(config=None):
    config=config or {}
    ROOT=Path(__file__).resolve().parents[2];R=3200;SPACING=math.tau*R/3;TILE=512
    layer=config.get('layer','architecture')
    source=ROOT/'src/worlds/generated/izmaColony.json';manifest=json.loads(source.read_text())
    # Land use reserves all upstream lots, stations and routes. Re-author it
    # last, rather than leave planted ground across a moved building or entry.
    manifest.pop('landUse',None)
    manifest['tiles']=[t for t in manifest['tiles']if not t.get('landUse')]
    manifest['visits']={k:v for k,v in manifest['visits'].items()if not k.startswith('land-')}
    contract=json.loads((ROOT/'assets/blender'/config.get('contract','izma-parcels.json')).read_text())
    scene=bpy.data.scenes[config.get('scene','SW_izma_districts')];scene.view_layers[0].update()
    assert scene.get('owner')==config.get('owner','spinward-izma-districts-v1')
    terrain_hash=hashlib.sha256(json.dumps([manifest['base']['vertices'],manifest['base']['meshes']['earth']],separators=(',',':')).encode()).hexdigest()
    assert contract['terrainHash']==terrain_hash,'Rebuild districts against the current finished terrain'
    parcels={p['id']:p for p in contract['parcels']}
    tiles={};parcel_meshes={};floors={};fixed={};solid_boxes=[];counts=[0,0];geometry_bounds={}
    def key(p):return f"{p['band']}-{math.floor((p['position'][0]-p['band']*SPACING+R*math.pi/6)/TILE)}-{math.floor((p['position'][1]+20000)/TILE)}"
    def local_to_world(p,v):
        c,s=math.cos(p['yaw']),math.sin(p['yaw']);x,y=p['position']
        return (x+c*v[0]-s*v[1],y+s*v[0]+c*v[1],p['floor']+v[2])
    for p in parcels.values():
        tile=tiles.setdefault(key(p),{'band':p['band'],'districts':set(),'parcels':[],'boxes':[],'proxyParts':[]})
        tile['districts'].add(p['district']);tile['parcels'].append(p['id']);parcel_meshes[p['id']]=[{},{}]
        x,y=p['position'];w,d,h=p['size']
        tile['boxes'].append([x,y,p['floor'],w,d,h,p['yaw'],'arch-'+p['wall']])
        for u,v,z,pw,pd,ph,material,shape in p['proxyParts']:
            px,py,pz=local_to_world(p,[u,v,z]);tile['proxyParts'].append([px,py,pz,pw,pd,ph,p['yaw'],'arch-'+material,shape])
        body_volume_count=3 if p['family'] in ['office','civic'] else 2
        for solid_index,(u,v,z,pw,pd,ph) in enumerate(p['solids']):
            # Keep one physical mesh per parcel. Grouping distant roofs into a
            # 128 m bucket pulled unnecessary triangles into a nearby street's
            # collision window. The closed wall volumes join roofs and access
            # tops here; vertical faces do not become floors in radial sampling.
            vs=[local_to_world(p,[u+sx*pw/2,v+sy*pd/2,z+sz*ph])for sz in [0,1]for sy in [-1,1]for sx in [-1,1]]
            # Foundations close against the terrain; rail bottoms meet balcony
            # slabs. Building-volume tops lie under the real roof surfaces added
            # below. Keep only the exposed boundaries instead of duplicate caps.
            faces=[(0,1,5,4),(2,6,7,3),(0,4,6,2),(1,3,7,5)]
            if solid_index>=body_volume_count:faces.append((4,5,7,6))
            for face in faces:
                for j in range(1,len(face)-1):floors.setdefault(p['id'],[]).extend([vs[face[0]],vs[face[j]],vs[face[j+1]]])

        # Three overlapping guard boxes become one U boundary: the shared faces
        # inside their joints cannot collide with a body and need no triangles.
        for u,v,z,width,depth,height,t in p['balconyGuards']:
            x0,x1=u-width/2,u+width/2;y0,y1=v-depth/2,v+depth/2
            outline=[(x0,y0),(x1,y0),(x1,y1),(x1-t,y1),(x1-t,y0+t),(x0+t,y0+t),(x0+t,y1),(x0,y1)]
            faces=[]
            for a,b in zip(outline,outline[1:]+outline[:1]):faces.append([(a[0],a[1],z),(b[0],b[1],z),(b[0],b[1],z+height),(a[0],a[1],z+height)])
            for xa,xb,ya,yb in [(x0,x1,y0,y0+t),(x0,x0+t,y0+t,y1),(x1-t,x1,y0+t,y1)]:
                faces.append([(xa,ya,z+height),(xb,ya,z+height),(xb,yb,z+height),(xa,yb,z+height)])
            for face in faces:
                vs=[local_to_world(p,q)for q in face]
                for j in range(1,len(vs)-1):floors.setdefault(p['id'],[]).extend([vs[0],vs[j],vs[j+1]])

    for obj in scene.objects:
        if obj.type=='MESH' and 'urban_street_id' in obj:
            mesh=obj.data;mesh.calc_loop_triangles();vertices=[]
            for v in mesh.vertices:
                w=obj.matrix_world@v.co;vertices.append((-w.y,w.x,w.z))
            flags=mesh.attributes.get('ground_surface')
            for tri in mesh.loop_triangles:
                material='arch-'+mesh.materials[tri.material_index].name.removeprefix('SWD_')
                vs=[vertices[i] for i in tri.vertices];fixed.setdefault(material,[]).extend(vs)
                if flags and flags.data[tri.polygon_index].value:floors.setdefault(obj['urban_street_id'],[]).extend(vs)
            continue
        if obj.type!='MESH' or 'parcel_id' not in obj:continue
        p=parcels[obj['parcel_id']];lod=int(obj['lod']);mesh=obj.data;mesh.calc_loop_triangles()
        vertices=[]
        for v in mesh.vertices:
            w=obj.matrix_world@v.co;vertices.append((-w.y,w.x,w.z))
        if lod>=0:
            bounds=[min(v[0]for v in vertices),min(v[1]for v in vertices),min(v[2]for v in vertices),max(v[0]for v in vertices),max(v[1]for v in vertices),max(v[2]for v in vertices)]
            previous=geometry_bounds.setdefault(p['id'],{}).get(lod)
            geometry_bounds[p['id']][lod]=[min(bounds[i],previous[i])if i<3 else max(bounds[i],previous[i])for i in range(6)]if previous else bounds
        flags=mesh.attributes.get('ground_surface')
        for tri in mesh.loop_triangles:
            material='arch-'+mesh.materials[tri.material_index].name.removeprefix('SWD_')
            vs=[vertices[i] for i in tri.vertices]
            groups=fixed if lod<0 else parcel_meshes[p['id']][lod]
            groups.setdefault(material,[]).extend(vs)
            if lod>=0:counts[lod]+=1
            if lod<=0 and flags and flags.data[tri.polygon_index].value:
                floors.setdefault(p['id'],[]).extend(vs)

    def pack(groups,surfaces=None):
        pool=[];lookup={}
        def indices(vs):
            ids=[]
            for v in vs:
                p=tuple(round(n,5)for n in v)
                if p not in lookup:lookup[p]=len(pool)//3;pool.extend(p)
                ids.append(lookup[p])
            return ids
        meshes={m:indices(vs)for m,vs in groups.items()}
        ss=[]
        for vs in (surfaces or {}).values():
            xs=[v[0]for v in vs];ys=[v[1]for v in vs]
            ss.append({'indices':indices(vs),'bounds':[min(xs),min(ys),max(xs),max(ys)]})
        return {'vertices':pool,'meshes':meshes,'surfaces':ss}

    # Additional neighbourhoods reserve existing parcels/public spaces. Rebuilding
    # primary architecture invalidates dependent layers; an additive export only
    # replaces its own tiles, surfaces and visits.
    manifest.pop('railways',None)
    manifest['tiles']=[t for t in manifest['tiles']if not t.get('railway')]
    manifest['visits']={k:v for k,v in manifest['visits'].items()if not k.startswith('station-')}
    if layer=='architecture':
        manifest.pop('publicRealm',None);manifest.pop('neighbourhoods',None)
        manifest['visits']={k:v for k,v in manifest['visits'].items()if not k.startswith(('public-','neighbourhood-'))}
        manifest['palette']={k:v for k,v in manifest['palette'].items()if not k.startswith('public-')}
        manifest['materialDetails']={};manifest['tiles']=[]
    else:
        manifest['tiles']=[t for t in manifest['tiles']if not t.get('neighbourhood')]
    for name,definition in contract['materials'].items():
        manifest['palette']['arch-'+name]=definition['color']
        manifest['materialDetails']['arch-'+name]={k:v for k,v in definition.items()if k!='color'}
    file_bytes=0;largest=0;emitted=0
    def emit_tile(name,ids):
        nonlocal file_bytes,largest,emitted
        groups=[{},{}]
        for pid in ids:
            for lod in [0,1]:
                for material,vs in parcel_meshes[pid][lod].items():groups[lod].setdefault(material,[]).extend(vs)
        packed=pack(groups[0]);packed['mid']=pack(groups[1])
        encoded=json.dumps(packed,separators=(',',':'))+'\n'
        if len(encoded.encode())>=4*1024*1024:
            assert len(ids)>1,('One building exceeds the tile request budget',ids)
            ranges=[max(parcels[i]['position'][axis]for i in ids)-min(parcels[i]['position'][axis]for i in ids)for axis in [0,1]]
            axis=0 if ranges[0]>ranges[1]else 1
            ids=sorted(ids,key=lambda i:parcels[i]['position'][axis]);middle=len(ids)//2
            emit_tile(name+'-0',ids[:middle]);emit_tile(name+'-1',ids[middle:]);return
        emitted+=1;file_bytes+=len(encoded);largest=max(largest,len(encoded))
        digest=hashlib.sha256(encoded.encode()).hexdigest()[:12];filename=name+'-'+digest+'.json'
        (ROOT/'public/landscapes/izma'/filename).write_text(encoded)
        boxes=[];proxies=[];bounds=[]
        for pid in ids:
            p=parcels[pid];x,y=p['position'];w,d,h=p['size']
            boxes.append([x,y,p['floor'],w,d,h,p['yaw'],'arch-'+p['wall']])
            bounds.append(geometry_bounds[pid][0])
            for u,v,z,pw,pd,ph,material,shape in p['proxyParts']:
                px,py,pz=local_to_world(p,[u,v,z]);proxies.append([px,py,pz,pw,pd,ph,p['yaw'],'arch-'+material,shape])
        manifest['tiles'].append({'id':name,'url':'/landscapes/izma/'+filename,'band':parcels[ids[0]]['band'],
            'bounds':[min(b[0]for b in bounds),min(b[1]for b in bounds),max(b[3]for b in bounds),max(b[4]for b in bounds)],
            'districts':sorted(set(parcels[i]['district']for i in ids)),
            'boxes':boxes,'proxyParts':proxies,'architecture':True,**({'neighbourhood':True}if layer!='architecture'else{})})
    for name,tile in sorted(tiles.items()):emit_tile(('neighbourhood-'if layer!='architecture'else'')+name,tile['parcels'])
    manifest[layer]={'version':1,'fixed':pack(fixed,floors),'solids':solid_boxes,
        'parcels':[{k:p[k]for k in ['id','band','district','family','position','floor','size','yaw','floors','groundShop','doors','access']}for p in parcels.values()],
        'counts':{'buildings':len(parcels),'nearTriangles':counts[0],'midTriangles':counts[1],'fixedTriangles':sum(len(v)//3 for v in fixed.values()),'surfaceGroups':len(floors)}}
    if 'streets' in contract:manifest[layer]['streets']=contract['streets']
    if config.get('lightSources'):
        manifest[layer]['lights']=[]
        for obj in scene.objects:
            if obj.type!='LIGHT' or obj.get('parcel_id')not in parcels:continue
            w=obj.matrix_world.translation
            manifest[layer]['lights'].append({'position':[-w.y,w.x,w.z],
                'color':obj['color'],'intensity':obj['intensity'],'distance':obj['distance']})
    if 'visits' in config:manifest['visits'].update(config['visits'])
    if 'baseTransform' in config:manifest['base']=config['baseTransform'](manifest['base'])
    source.write_text(json.dumps(manifest,separators=(',',':'))+'\n')
    out=ROOT/config.get('evidence','qa/webxr/evidence/colony-architecture-20260918');out.mkdir(parents=True,exist_ok=True)
    result={'counts':manifest[layer]['counts'],'tiles':emitted,'totalTileBytes':file_bytes,'largestTileBytes':largest,'manifestBytes':source.stat().st_size,
        'terrainHash':terrain_hash,'scope':'exported saved near/middle meshes and primitive silhouettes; interiors remain closed'}
    (out/'export.json').write_text(json.dumps(result,indent=2)+'\n')
    (out/'building-bounds.json').write_text(json.dumps(geometry_bounds,separators=(',',':'))+'\n')

    return result

if not globals().get("_DISTRICTS_LIBRARY",False):
    result=export()
