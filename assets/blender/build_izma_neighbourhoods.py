"""Infill the eighteen public-place catchments with authored frontage parcels.

The existing street graph, terrain, buildings and squares are reservations.
District use/history determines parcel dimensions, uses and catchment size;
the recipe runs offline and saves editable Blender meshes and explicit lots.
Run in an isolated Blender process against izma-colony.blend.
"""
import bpy, json, math, hashlib
from pathlib import Path

ROOT=Path(__file__).resolve().parents[2]
PUBLIC=json.loads((ROOT/'assets/blender/izma-public-spaces.json').read_text())
OLD=json.loads((ROOT/'assets/blender/izma-parcels.json').read_text())
CONFIG=json.loads((ROOT/'assets/blender/izma-neighbourhood-plan.json').read_text())
SPACING=math.tau*3200/3
source=ROOT/'assets/blender/build_izma_districts.py'
library={'__file__':str(source),'_DISTRICTS_LIBRARY':True}
exec(compile(source.read_text(),str(source),'exec'),library)
neighbourhoods=[]

def rectangle(x,y,yaw,w,d):
    c,s=math.cos(yaw),math.sin(yaw)
    return [(x+c*u-s*v,y+s*u+c*v)for u,v in [(-w/2,-d/2),(w/2,-d/2),(w/2,d/2),(-w/2,d/2)]]

def overlaps(a,b,margin=0):
    # Separating axes allow compact real frontage lots, without the large
    # empty corners imposed by circumscribed-circle parcel reservations.
    for polygon in [a,b]:
        for p,q in zip(polygon,polygon[1:]+polygon[:1]):
            dx,dy=q[0]-p[0],q[1]-p[1];length=math.hypot(dx,dy)
            if length<1e-8:continue
            nx,ny=-dy/length,dx/length
            aa=[x*nx+y*ny for x,y in a];bb=[x*nx+y*ny for x,y in b]
            if max(aa)+margin<min(bb)or max(bb)+margin<min(aa):return False
    return True

def corridor(a,b,width):
    return rectangle((a[0]+b[0])/2,(a[1]+b[1])/2,math.atan2(b[1]-a[1],b[0]-a[0]),math.dist(a[:2],b[:2]),width)

def plan(env):
    master=env['MASTER'];ground=env['ground'];site=env['site'];project=env['project'];seed=env['seed']
    reserved=[[]for _ in range(3)]
    for p in OLD['parcels']:
        reserved[p['band']].append(rectangle(*p['position'],p['yaw'],p['size'][0]+4,p['size'][1]+5))
        reserved[p['band']].append(corridor(p['access']['start'],p['access']['end'],5))
    for p in PUBLIC['places']:
        reserved[p['band']].append(rectangle(*p['position'],p['yaw'],p['size'][0]+4,p['size'][1]+4))
        reserved[p['band']].append(corridor(p['entry'],p['threshold'],7))
    routes=[[]for _ in range(3)]
    for band in range(3):
        for a,b,r in env['all_segments'][band]:
            aa=[a[0]+band*SPACING,a[1]];bb=[b[0]+band*SPACING,b[1]]
            routes[band].append((aa,bb,r,corridor(aa,bb,r['width']+5)))
    blocks=[]
    for district in master['districts']:
        p=next(q for q in PUBLIC['places']if q['id']==district['id'])
        band=district['band'];spec=CONFIG['districts'][p['id']];anchor=p['entry']
        radius=spec['radius'];candidates=[];rejected={}
        def reject(reason):rejected[reason]=rejected.get(reason,0)+1
        for a,b,r,_ in routes[band]:
            if r['kind']not in ['arterial','local']or r['id']not in env['profiles']:continue
            length=math.dist(a,b);yaw=math.atan2(b[1]-a[1],b[0]-a[0]);c,s=math.cos(yaw),math.sin(yaw)
            # Sampling only proposes sites; the saved contract fixes every
            # accepted lot. Existing branch/loop topology is not regridded.
            count=math.ceil(length/5)
            for k in range(1,count):
                t=k/count;rx=a[0]+(b[0]-a[0])*t;ry=a[1]+(b[1]-a[1])*t
                distance=math.hypot(rx-anchor[0],ry-anchor[1])
                if distance>radius:continue
                for side in [-1,1]:
                    candidates.append((distance,rx,ry,yaw+(math.pi if side<0 else 0),r))
        accepted=[]
        for distance,rx,ry,yaw,route in sorted(candidates,key=lambda q:q[0]):
            if len(accepted)>=spec['target']:break
            # A fixed sequence guarantees residential and workplace uses in
            # each catchment. The series reflects the district's land history.
            family=spec['families'][len(accepted)%len(spec['families'])]
            n=seed(f"{p['id']}:{round(rx)}:{round(ry)}:{family}")
            dims=CONFIG['families'][family];w=dims['width'][n%len(dims['width'])];d=dims['depth']
            floors=dims['floors'][n%len(dims['floors'])]
            c,s=math.cos(yaw),math.sin(yaw)
            setback=spec['setback']+((n//13)%3)*.7
            offset=route['width']/2+(2.15 if route['width']>=10 else 0)+setback+d/2
            x,y=rx-s*offset,ry+c*offset;lx=x-band*SPACING
            lot_w=w+spec['sideGap'];rear=spec['rearGarden'];lot_d=d+setback+rear
            centre=(x-s*(rear-setback)/2,y+c*(rear-setback)/2)
            lot=rectangle(*centre,yaw,lot_w,lot_d)
            if any(abs(q[0]-band*SPACING)>3200*math.pi/6-master['edgeReserve']or not district['axial'][0]<q[1]<district['axial'][1]for q in lot):reject('district-boundary');continue
            if band==0 and overlaps(lot,rectangle(0,0,0,700,860)):reject('study');continue
            water=master['water'][band]
            if any(math.hypot(x-band*SPACING-project(lx,y,aa,bb)[0],y-project(lx,y,aa,bb)[1])<math.hypot(lot_w,lot_d)/2+water['bankWidth']for aa,bb in zip(water['reach'],water['reach'][1:])):reject('water');continue
            if any(overlaps(lot,q,.5)for q in reserved[band]):reject('reserved');continue
            if any(rr['id']!=route['id']and overlaps(lot,shape,1)for aa,bb,rr,shape in routes[band]):reject('route');continue
            placement=site(band,lx,y,yaw,w,d,family)
            if not placement or placement['route']['id']!=route['id']:reject('frontage');continue
            if placement['stairs'] and family in ['warehouse','workshop']:reject('loading-grade');continue
            if max(placement['samples'])-min(placement['samples'])>1.7:reject('foundation');continue
            parcel_id=f"neighbourhood-{p['id']}-{len(accepted):03d}"
            lot_data={'polygon':[list(q)for q in lot],'width':lot_w,'depth':lot_d,'setback':setback,
                      'rearGarden':rear,'publicPlace':p['id'],'distance':distance,'street':route['id'],
                      'frontageUse':'shop'if family=='shop-house'else'yard'if family in ['warehouse','workshop']else'garden'if family in ['house','farmhouse','apartment']else'forecourt'}
            block={'id':parcel_id,'band':band,'district':p['id'],'family':family,'position':[lx,y,0],
                   'size':[w,d,floors*3.2],'yaw':yaw,'fixedSize':True,'lot':lot_data}
            blocks.append(block);accepted.append(block);reserved[band].append(lot)
        assert len(accepted)>=spec['minimum'],('Insufficient connected frontage',p['id'],len(accepted),rejected)
        neighbourhoods.append({'id':p['id'],'name':district['name'],'era':district['era'],'anchor':anchor,
            'radius':radius,'target':spec['target'],'parcels':[b['id']for b in accepted],
            'lotArea':sum(b['lot']['width']*b['lot']['depth']for b in accepted),
            'footprintArea':sum(b['size'][0]*b['size'][1]for b in accepted),'rejected':rejected})
    return blocks

config={'scene':'SW_izma_neighbourhoods','owner':'spinward-izma-neighbourhoods-v1',
        'stem':'izma-neighbourhoods','contract':'izma-neighbourhood-parcels.json','blocks':[],'plan':plan,
        # The lower shop awning covers the window head.
        'shopAwningBottom':2.50,
        'materials':{'garden':{'color':'#70805b','surface':'grass'},'court':{'color':'#9c9c90','surface':'paving'},
                     'lantern':{'color':'#e4d3ad','emission':{'color':'#ffd8a2','intensity':.22}}}}
built=library['build'](config)
# Save the lot grounds with the same parcel ID as their entrance and roof.
# They therefore share one local compound; streets/other layers stay intact.
lamps=[]
for p in built['parcels']:
    b=built['Builder']();c,s=math.cos(p['yaw']),math.sin(p['yaw']);x,y=p['position'];w,d,_=p['size']
    def world(u,v):return x+c*u-s*v,y+s*u+c*v
    def local(q):return c*(q[0]-x)+s*(q[1]-y),-s*(q[0]-x)+c*(q[1]-y)
    start_u,start_v=local(p['access']['start']);lot=p['lot'];half=lot['width']/2
    def patch(x0,x1,y0,y1,mat):
        if x1-x0<.05 or y1-y0<.05:return
        # Six-metre chords deviate by under 1.5 mm at this cylinder radius.
        # Extra tiny paving triangles have no visible or physical benefit.
        nx,ny=math.ceil((x1-x0)/6),math.ceil((y1-y0)/6)
        for i in range(nx):
            for j in range(ny):
                a=x0+(x1-x0)*i/nx;bb=x0+(x1-x0)*(i+1)/nx
                cc=y0+(y1-y0)*j/ny;dd=y0+(y1-y0)*(j+1)/ny
                points=[]
                for u,v in [(a,cc),(bb,cc),(bb,dd),(a,dd)]:
                    q=world(u,v);h=built['ground'](*q)+.035
                    # Meet the same drawn street/sidewalk at the full frontage.
                    if v<start_v+1:h=max(h,built['street_height'](*q)+.018)
                    points.append((u,v,h-p['floor']))
                b.face(points,mat,True)
    mat='garden'if lot['frontageUse']=='garden'else'court'
    # Leave the exact graded/stair entrance uncovered, and reserve its porch.
    patch(-half,start_u-1.2,start_v,-d/2-.4,mat)
    patch(start_u+1.2,half,start_v,-d/2-.4,mat)
    patch(-half,half,d/2+.4,d/2+lot['rearGarden'],'garden')
    b.finish(p['id']+'_lot',p,-1)
    # A supported light near the street edge, clear of the door's walk. Keep
    # at least 30 m between lamps; the runtime shares the existing six lights.
    u=-half+.6
    if abs(u-start_u)<2:u=half-.6
    v=start_v+1.2;lx,ly=world(u,v)
    if all(math.hypot(lx-q[0],ly-q[1])>30 for q in lamps):
        h=built['ground'](lx,ly)+.035;lamps.append((lx,ly))
        z=h-p['floor']
        for lod in [0,1]:
            lamp=built['Builder']()
            lamp.box(u,v,z,.16,.16,4.05,'metal')
            lamp.box(u,v-.3,z+3.9,.7,.95,.15,'metal')
            lamp.box(u,v-.47,z+3.88,.53,.55,.025,'lantern')
            lamp.finish(p['id']+f'_lamp{lod}',p,lod)
        p['solids'].append([u,v,z,.16,.16,4.05])
        p['proxyParts'].extend([[u,v,z,.16,.16,4.05,'metal','box'],[u,v-.3,z+3.9,.7,.95,.15,'metal','box']])
        data=bpy.data.lights.new(p['id']+'_street_light','POINT');data.energy=500
        obj=bpy.data.objects.new(data.name,data);built['scene'].collection.objects.link(obj)
        obj.location=(ly+(-c)*.47,-(lx+s*.47),h+3.84)
        obj['parcel_id']=p['id'];obj['color']='#ffdfa8';obj['intensity']=500;obj['distance']=32
built['scene'].view_layers[0].update()
bpy.data.libraries.write(str(ROOT/'assets/blender/izma-neighbourhoods.blend'),{built['scene']},fake_user=True,compress=True)
contract=ROOT/'assets/blender/izma-neighbourhood-parcels.json'
data=json.loads(contract.read_text())
data['parcels']=built['parcels']
data.update({'origin':'ai','created':'2026-09-18','neighbourhoods':neighbourhoods,
    'dependencies':{name:hashlib.sha256((ROOT/'assets/blender'/name).read_bytes()).hexdigest()
      for name in ['izma-parcels.json','izma-public-spaces.json','izma-neighbourhood-plan.json']}})
contract.write_text(json.dumps(data,separators=(',',':'))+'\n')
result=built['summary'];result['neighbourhoods']=[{'id':n['id'],'parcels':len(n['parcels']),'lotArea':n['lotArea']}for n in neighbourhoods]
result['blendBytes']=(ROOT/'assets/blender/izma-neighbourhoods.blend').stat().st_size
result['contractBytes']=contract.stat().st_size
result['streetLights']=len(lamps)
