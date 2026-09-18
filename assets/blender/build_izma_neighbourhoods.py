"""Replot the eighteen neighbourhoods around saved station and back-street layouts.

Run in isolated Blender against izma-colony.blend. The original architecture,
public spaces, river reservations and study remain upstream reservations.
"""
import bpy, json, math, hashlib, sys
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2]
sys.path.insert(0,str(ROOT/'assets/blender'))
from izma_urban_fabric import UrbanFabric
PUBLIC=json.loads((ROOT/'assets/blender/izma-public-spaces.json').read_text())
OLD=json.loads((ROOT/'assets/blender/izma-parcels.json').read_text())
CONFIG=json.loads((ROOT/'assets/blender/izma-neighbourhood-plan.json').read_text())
URBAN=json.loads((ROOT/'assets/blender/izma-urban-plan.json').read_text())
STREETS=json.loads((ROOT/'assets/blender/izma-urban-streets.json').read_text())
RAIL=json.loads((ROOT/'assets/blender/izma-rail.json').read_text())
for name,digest in STREETS['dependencies'].items():
    assert hashlib.sha256((ROOT/'assets/blender'/name).read_bytes()).hexdigest()==digest,('Reauthor urban streets after reservation changes',name)
assert hashlib.sha256(json.dumps(RAIL['stations'],sort_keys=True,separators=(',',':')).encode()).hexdigest()==STREETS['railStationDigest']
fabric=UrbanFabric(STREETS,URBAN,CONFIG,OLD,PUBLIC,RAIL)
source=ROOT/'assets/blender/build_izma_districts.py'
library={'__file__':str(source),'_DISTRICTS_LIBRARY':True}
exec(compile(source.read_text(),str(source),'exec'),library)

config={'scene':'SW_izma_neighbourhoods','owner':'spinward-izma-neighbourhoods-v1',
        'stem':'izma-neighbourhoods','contract':'izma-neighbourhood-parcels.json','blocks':[],'plan':fabric.plan,'extraStreetHeight':fabric.height,'minimumApproach':.85,
        # The lower shop awning covers the window head.
        'shopAwningBottom':2.50,
        'materials':{'lane':{'color':'#686c66','surface':'asphalt'},'garden':{'color':'#70805b','surface':'grass'},'court':{'color':'#9c9c90','surface':'paving'},
                     'lantern':{'color':'#e4d3ad','emission':{'color':'#ffd8a2','intensity':.22}}}}
built=library['build'](config)
neighbourhoods=fabric.neighbourhoods
fabric.save_streets(built)
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
    # Tight old-town/shop streets use a paved frontage, including residences.
    # Gardens remain behind those houses and on the greener housing/farm sites.
    mat='garden'if lot['frontageUse']=='garden' and URBAN['districts'][p['district']]['character']!='lanes'else'court'
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
data.update({'origin':'ai','created':'2026-09-18','neighbourhoods':neighbourhoods,'streets':fabric.profiles,'rejectedStreets':fabric.rejected_streets,
    'dependencies':{name:hashlib.sha256((ROOT/'assets/blender'/name).read_bytes()).hexdigest()
      for name in ['izma-parcels.json','izma-public-spaces.json','izma-neighbourhood-plan.json','izma-urban-plan.json','izma-urban-streets.json']}})
contract.write_text(json.dumps(data,separators=(',',':'))+'\n')
result=built['summary'];result['neighbourhoods']=[{'id':n['id'],'parcels':len(n['parcels']),'lotArea':n['lotArea']}for n in neighbourhoods]
result['blendBytes']=(ROOT/'assets/blender/izma-neighbourhoods.blend').stat().st_size
result['contractBytes']=contract.stat().st_size
result['streetLights']=len(lamps)
result['streets']=len(fabric.profiles);result['rejectedStreets']=fabric.rejected_streets
