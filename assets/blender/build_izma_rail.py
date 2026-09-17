"""Saved native-metre tram tracks, eighteen stations and a shared vehicle kit.

Run with isolated Blender MCP against izma-colony.blend. Existing city assets
are reservations. Heights are sampled from the actual drawn transport surface.
"""
import bpy, json, math, hashlib, bisect
from pathlib import Path
from mathutils import Vector
from mathutils.bvhtree import BVHTree

ROOT=Path(__file__).resolve().parents[2]
PLAN=json.loads((ROOT/'assets/blender/izma-rail-plan.json').read_text())
MASTER=json.loads((ROOT/'assets/blender/izma-colony-plan.json').read_text())
TRANSPORT=json.loads((ROOT/'assets/blender/izma-transport.json').read_text())
BASE=json.loads((ROOT/'src/worlds/generated/izmaColony.json').read_text())
R=3200;SPACING=math.tau*R/3;OWNER='spinward-izma-rail-v1'
scene=bpy.data.scenes.get('SW_izma_rail')
if scene:
    assert scene.get('owner')==OWNER
    for o in list(scene.objects):bpy.data.objects.remove(o,do_unlink=True)
    bpy.data.scenes.remove(scene)
scene=bpy.data.scenes.new('SW_izma_rail');scene['owner']=OWNER
scene.unit_settings.system='METRIC';scene.unit_settings.scale_length=1
bpy.context.window.scene=scene
definitions={
    'platform':{'color':'#aaa99d','surface':'paving'}, 'wall':{'color':'#83887f'},
    'rail':{'color':'#8d999c'}, 'sleeper':{'color':'#74766f'}, 'crossing':{'color':'#4e5755'},
    'tactile':{'color':'#c4ae6e'}, 'steel':{'color':'#475557'}, 'roof':{'color':'#5d6968'},
    'wood':{'color':'#927654'}, 'sign':{'color':'#e2e2d8'}, 'letter':{'color':'#233c3e'},
    'glass':{'color':'#668183','opacity':.18}, 'body':{'color':'#d0d2c7'}, 'floor':{'color':'#606d6c'},
    'seat':{'color':'#677e80'}, 'lamp':{'color':'#edddbb','emission':{'color':'#ffe5b9','intensity':.35}}
}
for line in PLAN['lines']:definitions[line['id']]={'color':line['color']}
materials={}
for name,d in definitions.items():
    m=bpy.data.materials.new('SWR_'+name);m['definition']=json.dumps(d)
    m.diffuse_color=tuple(int(d['color'][i:i+2],16)/255 for i in [1,3,5])+(1,);materials[name]=m

class Mesh:
    def __init__(self):self.vertices=[];self.faces=[];self.materials=[];self.physical=[]
    def face(self,points,mat,physical=False):
        n=len(self.vertices);self.vertices.extend(points);self.faces.append(tuple(range(n,n+len(points))))
        self.materials.append(mat);self.physical.append(physical)
    def box(self,x,y,z,w,d,h,mat,physical=False):
        a,b=x-w/2,x+w/2;c,e=y-d/2,y+d/2;t=z+h
        for q in [[(a,c,z),(b,c,z),(b,c,t),(a,c,t)],[(b,e,z),(a,e,z),(a,e,t),(b,e,t)],
                  [(a,e,z),(a,c,z),(a,c,t),(a,e,t)],[(b,c,z),(b,e,z),(b,e,t),(b,c,t)],
                  [(a,c,t),(b,c,t),(b,e,t),(a,e,t)],[(a,e,z),(b,e,z),(b,c,z),(a,c,z)]]:
            self.face(q,mat,physical)
    def save(self,id,lod,kind,transform=lambda p:p):
        me=bpy.data.meshes.new(id+'_'+str(lod));points=[transform(p)for p in self.vertices]
        me.from_pydata([(y,-x,z)for x,y,z in points],[],self.faces);me.update()
        keys=list(materials)
        for key in keys:me.materials.append(materials[key])
        for poly,key in zip(me.polygons,self.materials):poly.material_index=keys.index(key)
        attr=me.attributes.new(name='physical',type='BOOLEAN',domain='FACE')
        for item,value in zip(attr.data,self.physical):item.value=value
        o=bpy.data.objects.new(id+'_'+str(lod),me);scene.collection.objects.link(o)
        o['rail_id']=id;o['lod']=lod;o['kind']=kind;o['band']=band;o.hide_render=lod==1
        return o

pool=BASE['base']['vertices'];bvhs={}
for category,names in [('bed',['ballast']),('road',['local','arterial','walk']),('earth',['earth'])]:
    vs=[]
    for name in names:
        for i in BASE['base']['meshes'].get(name,[]):
            x,y,h=pool[i*3:i*3+3];a=x/R;vs.append((math.cos(a)*(R-h),y,math.sin(a)*(R-h)))
    bvhs[category]=BVHTree.FromPolygons(vs,[tuple(range(i,i+3))for i in range(0,len(vs),3)],all_triangles=True)
def height(kind,x,y):
    a=x/R;p=bvhs[kind].ray_cast(Vector((0,y,0)),Vector((math.cos(a),0,math.sin(a))))[0]
    return None if p is None else R-math.hypot(p.x,p.z)
def floor(x,y):
    return max(h for kind in ['bed','road','earth']if (h:=height(kind,x,y))is not None)

nodes={n['id']:n for n in MASTER['nodes']};profiles={p['id']:p for p in TRANSPORT['profiles']}
lines=[];stations=[];tile_count=0
for band in range(3):
    raw=[];distances=[];length=0
    for p in profiles[f'band-{band}-rail']['points']:
        if raw:
            delta=math.dist(p[:2],raw[-1][:2])
            if delta<1e-5:continue
            length+=delta
        raw.append(p[:3]);distances.append(length)
    def raw_at(s):
        s=max(0,min(length,s));i=min(len(raw)-2,max(0,bisect.bisect_right(distances,s)-1))
        t=(s-distances[i])/(distances[i+1]-distances[i]);return [a+(b-a)*t for a,b in zip(raw[i],raw[i+1])]
    node_s={}
    for node in MASTER['nodes']:
        if node['band']==band and node['role']in ['station','transfer']:
            node_s[node['id']]=distances[min(range(len(raw)),key=lambda i:math.dist(raw[i][:2],node['xy']))]
    def centre(s):
        # Round only the small alignment corners, within the reserved ballast.
        for corner in node_s.values():
            if 16<corner<length-16 and abs(s-corner)<16:
                t=(s-corner+16)/32;a=raw_at(corner-16);b=raw_at(corner);c=raw_at(corner+16)
                return [(1-t)**2*a[i]+2*t*(1-t)*b[i]+t*t*c[i]for i in range(3)]
        return raw_at(s)
    def point(s,u=0,z=0):
        p=centre(s);a=centre(max(0,s-.25));b=centre(min(length,s+.25));dx,dy=b[0]-a[0],b[1]-a[1];l=math.hypot(dx,dy)
        x=p[0]+dy/l*u+band*SPACING;y=p[1]-dx/l*u
        h=height('bed',x,y)
        if h is None:h=floor(x,y)
        return x,y,h+z
    # Source samples carry the same height as the drawn bed. Runtime poses
    # interpolate these authored samples; they do not regenerate a new route.
    line={**PLAN['lines'][band],'band':band,'length':length,'points':[],'stations':[]}
    for i in range(math.ceil(length/4)+1):
        s=min(i*4,length);p=point(s);line['points'].append([s,*p])
    for start in range(0,math.ceil(length),1024):
        id=f'rail-track-{band}-{start//1024}';tile_count+=1
        for lod,step in [(0,4),(1,16)]:
            mesh=Mesh();ends=[start+i*step for i in range(math.ceil((min(start+1024,length)-start)/step)+1)]
            ends[-1]=min(start+1024,length)
            for a,b in zip(ends,ends[1:]):
                for track in [-PLAN['trackCentres'],PLAN['trackCentres']]:
                    for side in [-1,1]:
                        u=track+side*PLAN['gauge']/2
                        mesh.face([point(a,u-.038,.075),point(a,u+.038,.075),point(b,u+.038,.075),point(b,u-.038,.075)],'rail')
                    if lod==0:
                        mesh.face([point(a,track-1,.035),point(a+.2,track-1,.035),point(a+.2,track+1,.035),point(a,track+1,.035)],'sleeper')
            mesh.save(id,lod,'track')
    for index,district in enumerate(d for d in MASTER['districts']if d['band']==band):
        id=district['id'];s0=node_s[id+'-station'];stop=s0+PLAN['stopOffset'];w=PLAN['platformWidth'];ph=PLAN['platformHeight']
        station={'id':id,'band':band,'number':index+1,'name':PLAN['stations'][id],'line':line['id'],'s':stop,
                 'position':point(stop),'platformHeight':ph,'platformWidth':w,'platformLength':PLAN['platformLength']}
        fixed=Mesh();half=PLAN['platformLength']/2;first=stop-half;last=stop+half;ramp=first-PLAN['rampLength']
        for a,b in zip([ramp,first,first+4,first+8,first+12,first+16],[first,first+4,first+8,first+12,first+16,last]):
            za=.05 if a==ramp else ph
            top=[point(a,-w/2,za),point(a,w/2,za),point(b,w/2,ph),point(b,-w/2,ph)]
            fixed.face(top,'platform',True)
            for side in [-1,1]:
                fixed.face([point(a,side*w/2,-.1),point(b,side*w/2,-.1),point(b,side*w/2,ph),point(a,side*w/2,za)],'wall',True)
        # Rail-side end stays closed. The south ramp is the clear entrance.
        fixed.face([point(last,-w/2,-.1),point(last,w/2,-.1),point(last,w/2,ph),point(last,-w/2,ph)],'wall',True)
        incoming=1 if district['centre'][0]>nodes[id+'-station']['xy'][0]else-1
        road_point=nodes[id+'-station']['xy'];entry=(road_point[0]+band*SPACING+incoming*20,road_point[1]-7.1)
        crossing=point(s0-12,0,.09);end=point(ramp,0,.05)
        path=[[*entry,floor(*entry)+.025],crossing,end]
        rows=[]
        for a,b in zip(path,path[1:]):
            length2=math.dist(a[:2],b[:2]);steps=math.ceil(length2)
            for i in range(steps):
                t=i/steps;rows.append([a[j]+(b[j]-a[j])*t for j in range(3)])
        rows.append(list(path[-1]));edges=[]
        for i,p in enumerate(rows):
            a=rows[max(0,i-1)];b=rows[min(len(rows)-1,i+1)]
            dx,dy=b[0]-a[0],b[1]-a[1];length2=math.hypot(dx,dy)
            edge=[(p[0]-dy/length2*side*1.05,p[1]+dx/length2*side*1.05)for side in [-1,1]]
            p[2]=max(p[2],floor(p[0],p[1])+.025,*(floor(x,y)+.025 for x,y in edge));edges.append(edge)
        # The deck bridges the embankment shoulder. Its minimum envelope clears
        # every actual road/ballast vertex without copying their abrupt steps.
        for order in [range(1,len(rows)),range(len(rows)-2,-1,-1)]:
            for i in order:
                j=i-1 if order.step==1 else i+1
                rows[i][2]=max(rows[i][2],rows[j][2]-.075*math.dist(rows[i][:2],rows[j][:2]))
        for i in range(len(rows)-1):
            quad=[(*edges[j][side],rows[j][2])for j,side in [(i,0),(i,1),(i+1,1),(i+1,0)]]
            fixed.face(quad,'platform',True)
            for j,k in [(0,3),(2,1)]:
                q,r=quad[j],quad[k]
                fixed.face([q,r,(r[0],r[1],floor(r[0],r[1])-.05),(q[0],q[1],floor(q[0],q[1])-.05)],'wall',True)
        station['entry']=rows[0];station['approach']=rows+[point(first,0,ph),point(first+1,-1.3,ph),point(stop,-1.3,ph)]
        station['platform']=point(stop,0,ph);station['boarding']=[point(stop,u,ph)for u in [-1.3,1.3]]
        fixed.save('station-'+id,-1,'station')
        # Local frame follows the track's slope; shelters stay visibly supported.
        c=point(stop);f=point(stop+1);b=point(stop-1);fx,fy=f[0]-b[0],f[1]-b[1];ln=math.hypot(fx,fy);fx/=ln;fy/=ln
        def transform(q):
            u,v,z=q;x=c[0]+fy*u+fx*v;y=c[1]-fx*u+fy*v;return x,y,floor(x,y)+z
        rural=district['use']in ['park','farming'];roof_length=9 if rural else 15
        station['roofLength']=roof_length
        for lod in [0,1]:
            detail=Mesh()
            for side in [-1,1]:
                for i in range(5):
                    a=first+i*4;b=min(last,a+4)
                    detail.face([point(a,side*(w/2-.08),ph+.012),point(a,side*(w/2-.35),ph+.012),point(b,side*(w/2-.35),ph+.012),point(b,side*(w/2-.08),ph+.012)],'tactile')
            detail.save('station-'+id+'-edge',lod,'station')
            shelter=Mesh()
            for v in [-roof_length/2+1,roof_length/2-1]:shelter.box(0,v,ph,.14,.14,2.6,'wood'if rural else'steel',True)
            shelter.box(0,0,ph+2.6,3.2,roof_length,.16,'roof',True)
            shelter.box(0,0,ph+.42,.48,3,.1,'wood',True)
            for v in [-1.2,1.2]:shelter.box(0,v,ph,.11,.11,.42,'steel',True)
            shelter.box(0,0,ph+2.58,.28,roof_length-1,.025,'lamp')
            shelter.box(0,-roof_length/2+.6,ph+1.7,.20,2,.48,'sign',True)
            shelter.box(0,-roof_length/2+.6,ph+1.6,.205,2,.09,line['id'])
            shelter.save('station-'+id+'-shelter',lod,'station',transform)
        for side in [-1,1]:
            curve=bpy.data.curves.new('Station name '+id,'FONT');curve.body=f"{chr(65+band)}{index+1:02d}  {station['name']}"
            curve.align_x='CENTER';curve.align_y='CENTER';curve.size=min(.13,2.5/max(1,len(curve.body)))
            curve.extrude=.001;curve.resolution_u=2
            obj=bpy.data.objects.new('Station name '+id,curve);scene.collection.objects.link(obj)
            for selected in list(bpy.context.selected_objects):selected.select_set(False)
            obj.select_set(True);bpy.context.view_layer.objects.active=obj;bpy.ops.object.convert(target='MESH')
            for vertex in obj.data.vertices:
                p=vertex.co;x,y,z=transform((side*(.109+p.z),-roof_length/2+.6+side*p.x,ph+1.94+p.y));vertex.co=(y,-x,z)
            obj.data.materials.append(materials['letter']);obj['rail_id']='station-'+id+'-letters-'+str(side)
            obj['lod']=0;obj['kind']='station';obj['band']=band
        station['yaw']=math.atan2(fy,fx)-math.pi/2
        line['stations'].append(station['id']);stations.append(station)
        light=bpy.data.lights.new('station-'+id+'-light','POINT');light.energy=70
        o=bpy.data.objects.new(light.name,light);scene.collection.objects.link(o);x,y,z=point(stop,0,ph+2.45);o.location=(y,-x,z)
        o['rail_id']='station-'+id;o['kind']='station';o['color']='#ffe5b9';o['intensity']=70;o['distance']=24
    # Terminal crossovers follow the same eased lateral shift as the service.
    for terminal,direction in [(stations[-6],1),(stations[-1],-1)]:
        for lod,step in [(0,4),(1,12)]:
            mesh=Mesh()
            for d in range(0,150,step):
                ends=[]
                for q in [d,min(d+step,150)]:
                    t=q/150;u=direction*PLAN['trackCentres']*(1-2*t*t*(3-2*t))
                    ends.append((terminal['s']+direction*q,u))
                for side in [-1,1]:
                    a,u=ends[0];b,v=ends[1];g=side*PLAN['gauge']/2
                    mesh.face([point(a,u+g-.038,.09),point(a,u+g+.038,.09),point(b,v+g+.038,.09),point(b,v+g-.038,.09)],'rail')
            mesh.save(f"rail-crossover-{terminal['id']}",lod,'track')
    lines.append(line)

# Shared double-ended low-floor car. Openings are actual holes; glass can be
# seen through from the standing passenger aisle. Sliding leaves stay separate.
for lod in [0,1]:
    car=Mesh();length=PLAN['carLength'];width=PLAN['carWidth'];h=PLAN['carFloor']
    car.box(0,0,h-.12,width,length,.12,'floor')
    car.box(0,0,h+2.38,width,length,.16,'body')
    car.box(0,0,h+2.35,.32,10,.03,'lamp')
    for side in [-1,1]:
        u=side*(width/2-.045)
        car.box(u,0,h+2.15,.09,1.6,.23,'body')
        for v,d in [(-3.4,5.2),(3.4,5.2)]:
            car.box(u,v,h,.09,d,.78,'body')
            car.box(u,v,h+.8,.035,d,1.35,'glass')
            car.box(u,v,h+2.15,.09,d,.23,'body')
            car.box(u+side*.01,v,h+.38,.1,d-.02,.16,'rail-a')
        for v in [-5.8,-3.2,-.78,.78,3.2,5.8]:car.box(u,v,h+.78,.08,.075,1.6,'body')
        car.box(0,side*(length/2-.08),h,width,.16,.75,'body')
        car.box(0,side*(length/2-.045),h+.77,width-.25,.04,1.35,'glass')
        car.box(0,side*(length/2-.08),h+2.15,width,.16,.23,'body')
        if lod==0:
            for v in [-3.3,3.3]:
                car.box(side*.93,v,h+.42,.48,3.8,.12,'seat')
                car.box(side*1.15,v,h+.5,.09,3.8,.5,'seat')
            for v in [-4.2,4.2]:car.box(side*.85,v,.18,.28,1.15,.28,'steel')
    car.save('tram-body',lod,'vehicle')
    for side in [-1,1]:
        for leaf in [-1,1]:
            door=Mesh();u=side*(width/2+.025);v=leaf*.375
            door.box(u,v,h,.045,.735,.78,'body')
            door.box(u,v,h+.8,.028,.735,1.35,'glass')
            door.box(u,v,h+2.15,.045,.735,.23,'body')
            door.save(f'tram-door-{side}-{leaf}',lod,'vehicle')
light=bpy.data.lights.new('Tram ceiling light','POINT');light.energy=22
obj=bpy.data.objects.new(light.name,light);scene.collection.objects.link(obj);obj.location=(0,0,PLAN['carFloor']+2.2)
obj['rail_id']='tram-light';obj['kind']='vehicle';obj['color']='#ffe9c6';obj['intensity']=22;obj['distance']=9

scene['station_count']=len(stations);scene['line_count']=len(lines)
scene.view_layers[0].update()
target=ROOT/'assets/blender/izma-rail.blend';bpy.data.libraries.write(str(target),{scene},fake_user=True,compress=True)
contract={'origin':'ai','created':'2026-09-18','version':1,'configuration':PLAN,'materials':definitions,'lines':lines,'stations':stations,
          'baseDigest':hashlib.sha256(json.dumps(BASE['base'],sort_keys=True,separators=(',',':')).encode()).hexdigest(),
          'dependencies':{n:hashlib.sha256((ROOT/'assets/blender'/n).read_bytes()).hexdigest()for n in ['izma-rail-plan.json','izma-colony-plan.json','izma-transport.json','izma-parcels.json','izma-public-spaces.json','izma-neighbourhood-parcels.json']}}
(ROOT/'assets/blender/izma-rail.json').write_text(json.dumps(contract,separators=(',',':'))+'\n')
result={'stations':len(stations),'lines':len(lines),'trackTiles':tile_count,'objects':len(scene.objects),'blendBytes':target.stat().st_size}
