"""Author continuous urban pavements around saved streets and parcel access.

Run in an isolated Blender CLI. Existing buildings, roads, garden grounds and
graded entrance triangles remain upstream; only a separate native scene is saved.
"""
import bpy
import hashlib
import json
import math
import sys
from pathlib import Path
from collections import defaultdict

ROOT=Path(__file__).resolve().parents[2]
ASSETS=ROOT/'assets/blender'
sys.path.insert(0,str(ASSETS))
from colony_manifest_io import read_manifest
from izma_ground_patches import GroundPatches,area
from izma_mesh_builder import BuildingMeshBuilder
from izma_street_frontages import PavementPlan,ribbons,clean,covers
from plan_izma_urban import rectangle,corridor,project,ReservationIndex,SPACING
from izma_block_composition import read_composition

manifest=read_manifest(ROOT/'src/worlds/generated/izmaColony.json')
neighbours=json.loads((ASSETS/'izma-neighbourhood-parcels.json').read_text())
composition=read_composition(ASSETS);retired=set(composition['retiredParcelIds'])
neighbours['parcels']=[p for p in neighbours['parcels'] if p['id'] not in retired]
primary=json.loads((ASSETS/'izma-parcels.json').read_text())
specs=json.loads((ASSETS/'izma-urban-plan.json').read_text())
master=json.loads((ASSETS/'izma-colony-plan.json').read_text())
transport=json.loads((ASSETS/'izma-transport.json').read_text())
public=json.loads((ASSETS/'izma-public-spaces.json').read_text())
urban={name for name,spec in specs['districts'].items() if spec['character']!='groves'}
paths=[{'id':s['id'],'district':s['district'],'band':s['band'],'width':s['width'],'profile':s['profile']}
       for s in neighbours['streets'] if s['district'] in urban]

# Ground-level primary streets also carry addressable frontages. Limit each
# district's stretch to its actual parcels; do not pave the whole rural band.
routes={r['id']:r for r in master['routes']}
profiles={p['id']:p['points'] for p in transport['profiles']}
groups=defaultdict(list)
for parcel in neighbours['parcels']:
    route=routes.get(parcel['route'])
    if parcel['district'] in urban and route and route['kind']=='local' and route['width']<10:
        groups[(parcel['district'],parcel['route'],parcel['band'])].append(parcel)
for (district,route_id,band),parcels in groups.items():
    points=[[p[0]+band*SPACING,p[1],p[2]] for p in profiles[route_id]]
    lengths=[0]
    for a,b in zip(points,points[1:]):lengths.append(lengths[-1]+math.dist(a[:2],b[:2]))
    stations=[]
    for p in parcels:
        choices=[]
        for i,(a,b) in enumerate(zip(points,points[1:])):
            x,y,t=project(*p['frontage'][:2],a,b)
            choices.append((math.dist([x,y],p['frontage'][:2]),lengths[i]+t*(lengths[i+1]-lengths[i])))
        stations.append(min(choices)[1])
    lo,hi=max(0,min(stations)-15),min(lengths[-1],max(stations)+15)
    section=[]
    for i,(a,b) in enumerate(zip(points,points[1:])):
        if lengths[i+1]-lengths[i]<1e-8:continue
        if lengths[i+1]<lo or lengths[i]>hi:continue
        for value in [max(lo,lengths[i]),min(hi,lengths[i+1])]:
            t=(value-lengths[i])/(lengths[i+1]-lengths[i])
            q=[a[k]+(b[k]-a[k])*t for k in range(3)]
            if not section or math.dist(section[-1][:2],q[:2])>1e-6:section.append(q)
    if len(section)>1:paths.append({'id':route_id+'-frontage-'+district,'district':district,'band':band,'width':routes[route_id]['width'],'profile':section})

reserved=[[] for _ in range(3)]
for block in composition['blocks']:reserved[block['band']].extend(block['sectors'])
for p in primary['parcels']+neighbours['parcels']:
    band=p['band']
    # Keep the full existing foundation envelope and the graded entrance.
    reserved[band].append(rectangle(*p['position'],p['yaw'],p['size'][0]+.54,p['size'][1]+.54))
    a,b=p['access']['start'],p['access']['end']
    reserved[band].append(corridor(a,b,p['access']['width']+.015))
for p in public['places']:
    reserved[p['band']].append(rectangle(*p['position'],p['yaw'],p['size'][0]+.1,p['size'][1]+.1))
    reserved[p['band']].append(corridor(p['entry'],p['threshold'],5))
for station in manifest['railways']['stations']:
    for a,b in zip(station['approach'],station['approach'][1:]):reserved[station['band']].append(corridor(a,b,4.5))
supports=[ReservationIndex() for _ in range(3)]
for band,polygons in enumerate(reserved):
    for polygon in polygons:supports[band].append(clean(polygon))

# Actual drawn carriageway triangles, rather than ideal centreline rectangles,
# preserve the mitres and crossing aprons already authored in the road meshes.
for packed,names in [(manifest['base'],['local','arterial','walk','water']),
                     (manifest['neighbourhoods']['fixed'],['arch-lane'])]:
    pool=packed['vertices']
    for name in names:
        ids=packed['meshes'].get(name,[])
        for i in range(0,len(ids),3):
            polygon=clean([pool[k*3:k*3+2] for k in ids[i:i+3]])
            if not polygon:continue
            band=round(sum(p[0] for p in polygon)/len(polygon)/SPACING)
            if 0<=band<3:
                reserved[band].append(polygon)
                if name!='water':supports[band].append(polygon)

scene=bpy.data.scenes.new('SW_izma_street_frontages')
scene['owner']='spinward-izma-street-frontages-v1'
scene.unit_settings.system='METRIC'
material=bpy.data.materials.new('SWF_paving')
material.diffuse_color=(.61,.61,.565,1)
materials={'paving':material,'edge':bpy.data.materials.new('SWF_edge')}
materials['edge'].diffuse_color=(.43,.45,.42,1)
materials['rail']=bpy.data.materials.new('SWF_rail')
materials['rail'].diffuse_color=(.28,.32,.30,1)
ground=GroundPatches(manifest['base'])
planners=[PavementPlan([],r) for r in reserved]
builders={}
boundary_edges={}
reports=[]
max_lift=0

for path in sorted(paths,key=lambda p:(p['district'],p['id'])):
    profile=path['profile'];pavement_width=1.8 if path['width']>=5 else 1.45
    plan=planners[path['band']];total=0
    def road_height(x,y):
        best=(math.inf,0)
        for a,b in zip(profile,profile[1:]):
            qx,qy,t=project(x,y,a,b);dist=(x-qx)**2+(y-qy)**2
            if dist<best[0]:best=(dist,a[2]+(b[2]-a[2])*t)
        return best[1]
    for polygon in ribbons(profile,path['width'],pavement_width):
        for piece in plan.add(polygon):
            for patch in ground.split(piece):
                # Ground ridges are exact; the road profile keeps the inner edge
                # at the existing grade. A slight paving offset avoids coplanar
                # grass/lot surfaces while staying below a normal door threshold.
                top=[(x,y,max(h+.055,road_height(x,y)+.045)) for x,y,h in patch]
                if len(top)<3:continue
                max_lift=max(max_lift,max(p[2]-q[2] for p,q in zip(top,patch)))
                cx=sum(p[0] for p in top)/len(top);cy=sum(p[1] for p in top)/len(top)
                key=(path['district'],math.floor(cx/64),math.floor(cy/64))
                builder=builders.setdefault(key,BuildingMeshBuilder(scene,materials))
                builder.face(top,'paving',True)
                # Cancel shared boundaries before drawing retaining faces.
                # Internal skirts add no visible or physical value.
                for i,(a,b) in enumerate(zip(top,top[1:]+top[:1])):
                    low_a,low_b=patch[i],patch[(i+1)%len(patch)]
                    edge=tuple(sorted(tuple(round(v,5) for v in q) for q in [a,b]))
                    if edge in boundary_edges:del boundary_edges[edge]
                    else:boundary_edges[edge]=(builder,path['band'],[a,b,(b[0],b[1],low_b[2]-.01),(a[0],a[1],low_a[2]-.01)])
                total+=abs(area([p[:2] for p in top]))
    reports.append({'id':path['id'],'district':path['district'],'band':path['band'],
                    'width':pavement_width,'length':sum(math.dist(a[:2],b[:2]) for a,b in zip(profile,profile[1:])),
                    'pavingArea':total})
    print(json.dumps(reports[-1]),flush=True)

guard_length=0
for builder,band,vertices in boundary_edges.values():
    a,b,low_b,low_a=vertices;length=math.dist(a[:2],b[:2])
    if length<.001:continue
    # Shared edges with different subdivisions survive the exact-key pass.
    # Probe the actual union before retaining or guarding an exterior edge.
    nx,ny=(b[1]-a[1])/length,-(b[0]-a[0])/length
    count=max(1,math.ceil(length/4))
    def lerp(a,b,t):return tuple(a[k]+(b[k]-a[k])*t for k in range(3))
    for i in range(count):
        p,q=lerp(a,b,i/count),lerp(a,b,(i+1)/count)
        lo,hi=lerp(low_a,low_b,i/count),lerp(low_a,low_b,(i+1)/count)
        outside=((p[0]+q[0])/2+nx*.012,(p[1]+q[1])/2+ny*.012)
        if covers(planners[band].accepted,outside) or covers(supports[band],outside):continue
        builder.face([p,q,hi,lo],'edge')
        if min(p[2]-lo[2],q[2]-hi[2])<.8:continue
        # Exposed raised footways have a solid 14 cm parapet, including physical
        # side and top faces, independently of streamed building LOD.
        p=(p[0]-nx*.08,p[1]-ny*.08,p[2]);q=(q[0]-nx*.08,q[1]-ny*.08,q[2])
        inside_p=(p[0]-nx*.14,p[1]-ny*.14,p[2]);inside_q=(q[0]-nx*.14,q[1]-ny*.14,q[2])
        ring=[p,q,inside_q,inside_p];top=[(x,y,h+1.05) for x,y,h in ring]
        for j in range(4):builder.face([ring[j],ring[(j+1)%4],top[(j+1)%4],top[j]],'rail',True)
        builder.face(top,'rail',True)
        guard_length+=math.dist(p[:2],q[:2])
for (district,x,y),builder in builders.items():
    ident=f'frontage-{district}-{x}-{y}'
    obj=builder.finish(ident,{'id':ident,'position':[0,0],'floor':0,'yaw':0,'district':district,'family':'pavement'},-1)
    obj['frontage_id']=ident
    obj['band']=next(p['band'] for p in paths if p['district']==district)
scene.view_layers[0].update()
dependencies={name:hashlib.sha256((ASSETS/name).read_bytes()).hexdigest() for name in [
    'izma-neighbourhood-parcels.json','izma-parcels.json','izma-urban-plan.json',
    'izma-colony-plan.json','izma-transport.json','izma-public-spaces.json','izma-rail.json','izma-block-parcels.json']}
contract={'origin':'ai','created':'2026-09-18','version':1,'dependencies':dependencies,
          'terrainHash':hashlib.sha256(json.dumps([manifest['base']['vertices'],manifest['base']['meshes']['earth']],separators=(',',':')).encode()).hexdigest(),
          'paths':reports,'maximumRaiseAboveTerrain':max_lift,'guardLength':guard_length,
          'materials':{'paving':{'color':'#9c9c90','surface':'paving'},'edge':{'color':'#6e736b','surface':'paving'},
                       'rail':{'color':'#48524c','surface':'metal'}}}
assert {p['district'] for p in reports if p['pavingArea']>1}==urban,'Every urban district needs actual pavement'
bpy.data.libraries.write(str(ASSETS/'izma-street-frontages.blend'),{scene},fake_user=True,compress=True)
(ASSETS/'izma-street-frontages.json').write_text(json.dumps(contract,separators=(',',':'))+'\n')
print(json.dumps({'paths':len(reports),'districts':len(urban),'pavingArea':sum(p['pavingArea'] for p in reports),'objects':len(builders),'maximumRaiseAboveTerrain':max_lift}),flush=True)
