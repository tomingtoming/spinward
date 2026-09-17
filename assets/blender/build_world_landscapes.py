"""Author three independent landscape studies in metric, unrolled coordinates.

Run with Blender MCP's execute_blender_code_for_cli in an isolated process.
Only SWL_ scenes owned by this script are replaced. The saved .blend is the
editable source: curves retain road alignments; named terrain tiles, building
masses and palettes can be edited before running export_world_landscapes.py.
These are original study layouts, not reconstructions of film geography.
"""
import bpy
import math
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
OWNER = 'spinward-world-landscapes-v1'
W, D, STEP = 640, 800, 16
TERRAIN_INDEX = {}


def smooth(a, b, v):
    t = max(0, min(1, (v-a)/(b-a)))
    return t*t*(3-2*t)


def curve_x(y):
    # A deliberately drawn river, independent of a rectangular road lattice.
    anchors = [(-400, -85), (-230, -65), (-80, 12), (100, 38), (270, -18), (400, -35)]
    for (ay, ax), (by, bx) in zip(anchors, anchors[1:]):
        if y <= by:
            return ax + (bx-ax)*smooth(ay, by, y)
    return anchors[-1][1]


def raw_height(world, x, y):
    edge = smooth(0, 58, min(W/2-abs(x), D/2-abs(y)))
    if world == 'izma':
        d = abs(x-curve_x(y))
        bank = .7 + 2.1*smooth(15, 28, d) + 5.2*smooth(43, 59, d)
        # Close the reach into its own basin before the terrain boundary.
        bank = max(bank, 8*smooth(310, 362, abs(y)))
        hill = 12*math.exp(-((x+215)/100)**2-((y-175)/145)**2)
        return .03 + edge*(bank + hill)
    if world == 'cooper':
        hill = 10*math.exp(-((x-230)/150)**2-((y-200)/200)**2)
        return .03 + edge*(5 + hill)
    hill = 30*math.exp(-((x-175)/145)**2-((y-160)/220)**2)
    hill += 17*math.exp(-((x+205)/100)**2-((y+160)/155)**2)
    pond = smooth(60, 92, math.hypot(x+60, (y-60)*.8))
    return .03 + edge*(1.2 + pond*(5+hill))


def river_columns(y):
    c=curve_x(y)
    return [-320,(-320+c-145)/2]+[c+d for d in [-145,-122,-95,-81,-67,-59,-43,-38,-32,-28,-16,0,16,28,32,38,43,59,67,81,95,122,145]]+[(320+c+145)/2,320]


def ground(world, x, y):
    # Match the exported LOD0 triangles exactly, including the diagonal.
    ix = min(int(W/STEP)-1, max(0, math.floor((x+W/2)/STEP)))
    iy = min(int(D/STEP)-1, max(0, math.floor((y+D/2)/STEP)))
    x0, y0 = -W/2+ix*STEP, -D/2+iy*STEP
    if world=='izma':
        lo,hi=river_columns(y0),river_columns(y0+STEP)
        for j in range(len(lo)-1):
            quad=[(lo[j],y0),(lo[j+1],y0),(hi[j+1],y0+STEP),(hi[j],y0+STEP)]
            for ids in [(0,1,2),(0,2,3)]:
                (ax,ay),(bx,by),(cx,cy)=[quad[k] for k in ids]
                den=(by-cy)*(ax-cx)+(cx-bx)*(ay-cy)
                a=((by-cy)*(x-cx)+(cx-bx)*(y-cy))/den
                b=((cy-ay)*(x-cx)+(ax-cx)*(y-cy))/den
                if min(a,b,1-a-b)>=-1e-7:
                    return a*raw_height(world,ax,ay)+b*raw_height(world,bx,by)+(1-a-b)*raw_height(world,cx,cy)
        return raw_height(world,x,y)
    u, v = (x-x0)/STEP, (y-y0)/STEP
    a,b,c,d = [raw_height(world, px, py) for px,py in [(x0,y0),(x0+STEP,y0),(x0+STEP,y0+STEP),(x0,y0+STEP)]]
    return a+(b-a)*u+(c-b)*v if u>=v else a+(c-d)*u+(d-a)*v


PALETTE = {
    'earth':'#71835c', 'road':'#4c5250', 'walk':'#b8b5a5', 'stone':'#a3a18c',
    'water':'#456f70', 'wall':'#c5bca8', 'cream':'#d9d1bb', 'brick':'#9a7360',
    'roof':'#666e70', 'tile':'#8c6854', 'glass':'#607d83', 'leaf':'#506b43',
    'trunk':'#766550', 'sand':'#c4a578', 'white':'#e2ddc9',
    'plaster':'#c7c8bb', 'ochre':'#bca781', 'sage':'#6e847b',
    'awning':'#7e5950', 'timber':'#896f54', 'dark':'#414943'
}


def new_scene(world):
    name = 'SWL_'+world
    old = bpy.data.scenes.get(name)
    if old:
        if old.get('owner') != OWNER:
            raise RuntimeError('Unowned scene: '+name)
        for obj in list(old.objects):
            bpy.data.objects.remove(obj, do_unlink=True)
        bpy.data.scenes.remove(old)
    scene = bpy.data.scenes.new(name)
    scene['owner'], scene['world'], scene['extent'] = OWNER, world, [W,D]
    scene.unit_settings.system = 'METRIC'
    scene.unit_settings.scale_length = 1
    return scene


def mesh(scene, name, vertices, faces, material, lod=-1, collision=False):
    data = bpy.data.meshes.new(name)
    data.from_pydata(vertices, [], faces)
    data.update()
    obj = bpy.data.objects.new(name, data)
    scene.collection.objects.link(obj)
    obj.data.materials.append(bpy.data.materials['SWL_'+material])
    obj['material'], obj['lod'], obj['surface'] = material, lod, collision
    return obj


def box(scene, name, x, y, z, w, d, h, material, yaw=0, solid=True):
    vertices = [(sx*w/2,sy*d/2,sz*h) for sz in [0,1] for sy in [-1,1] for sx in [-1,1]]
    faces = [(0,2,3,1),(4,5,7,6),(0,1,5,4),(2,6,7,3),(0,4,6,2),(1,3,7,5)]
    obj = mesh(scene,name,vertices,faces,material)
    obj.location = (x,y,z); obj.rotation_euler.z = yaw
    if solid:
        obj['solid'] = [w,d,h]
    return obj


def terrain(scene, world):
    for lod, step in enumerate([16,32,64]):
        xs = list(range(-W//2,W//2,step))+[W//2]
        ys = list(range(-D//2,D//2,step))+[D//2]
        if world=='izma':xs=river_columns(0)
        vs = [(x,y,raw_height(world,x,y)) for y in ys for x in (river_columns(y) if world=='izma' else xs)]
        fs = []
        for j in range(len(ys)-1):
            for i in range(len(xs)-1):
                a=j*len(xs)+i;b=a+1;d=a+len(xs);c=d+1
                fs.extend([(a,b,c),(a,c,d)])
        if world=='izma' and lod==0:
            # Limit the chord error when this unrolled terrain is wrapped onto
            # a cylinder. Long outer river cells otherwise rise through roads.
            pending=fs;fs=[]
            while pending:
                face=pending.pop()
                edges=[(face[i],face[(i+1)%3],face[(i+2)%3]) for i in range(3)]
                a,b,c=max(edges,key=lambda e:math.dist(vs[e[0]][:2],vs[e[1]][:2]))
                if math.dist(vs[a][:2],vs[b][:2])<=24:fs.append(face);continue
                m=len(vs);vs.append(tuple((vs[a][k]+vs[b][k])/2 for k in range(3)))
                pending.extend([(a,m,c),(m,b,c)])
        obj=mesh(scene,'Terrain_LOD'+str(lod),vs,fs,'earth',lod,lod==0)
        obj.hide_render = lod != 0
        obj.hide_viewport = lod != 0
        if lod==0:
            index={}
            for face in fs:
                tri=[vs[i] for i in face]
                for bx in range(math.floor(min(p[0] for p in tri)/32),math.floor(max(p[0] for p in tri)/32)+1):
                    for by in range(math.floor(min(p[1] for p in tri)/32),math.floor(max(p[1] for p in tri)/32)+1):index.setdefault((bx,by),[]).append(tri)
            TERRAIN_INDEX[world]=index


def drape(world, vertices, faces, lift):
    """Intersect each ribbon triangle with terrain triangles before lifting.
    Sampling only the ribbon edges misses crests inside a wide road face.
    """
    out=[];result=[]
    def cross(a,b,p):return (b[0]-a[0])*(p[1]-a[1])-(b[1]-a[1])*(p[0]-a[0])
    for face in faces:
        polygon=[vertices[i][:2] for i in face]
        candidates={}
        for bx in range(math.floor(min(p[0] for p in polygon)/32),math.floor(max(p[0] for p in polygon)/32)+1):
            for by in range(math.floor(min(p[1] for p in polygon)/32),math.floor(max(p[1] for p in polygon)/32)+1):
                for tri in TERRAIN_INDEX[world].get((bx,by),[]):candidates[id(tri)]=tri
        for tri in candidates.values():
            clipped=polygon
            for a,b in zip(tri,tri[1:]+tri[:1]):
                source=clipped;clipped=[]
                if not source:break
                for p,q in zip(source,source[1:]+source[:1]):
                    dp,dq=cross(a,b,p),cross(a,b,q)
                    if dp>=-1e-8:clipped.append(p)
                    if (dp<0<dq) or (dq<0<dp):
                        t=dp/(dp-dq);clipped.append((p[0]+t*(q[0]-p[0]),p[1]+t*(q[1]-p[1])))
            if len(clipped)<3:continue
            a,b,c=tri;den=cross(a,b,c)
            start=len(out)
            for x,y in clipped:
                u=cross(b,c,(x,y))/den;v=cross(c,a,(x,y))/den
                out.append((x,y,u*a[2]+v*b[2]+(1-u-v)*c[2]+lift))
            for i in range(1,len(clipped)-1):
                face=(start,start+i,start+i+1)
                if abs(cross(*(out[k] for k in face)))>1e-7:result.append(face)
    return out,result


def ribbon(scene, world, name, points, width, material='road', lift=.08, fixed_height=None):
    # Editable polyline plus its explicitly sampled deck, in the same .blend.
    curve = bpy.data.curves.new(name+'_alignment','CURVE');curve.dimensions='3D'
    spline=curve.splines.new('POLY');spline.points.add(len(points)-1)
    for p,(x,y) in zip(spline.points,points):p.co=(x,y,ground(world,x,y)+lift,1)
    guide=bpy.data.objects.new(name+'_alignment',curve);scene.collection.objects.link(guide)
    guide['width']=width;guide['route']=True;guide.hide_render=True
    sampled=[]
    for a,b in zip(points,points[1:]):
        n=max(1,math.ceil(math.dist(a,b)/4))
        sampled.extend([(a[0]+(b[0]-a[0])*i/n,a[1]+(b[1]-a[1])*i/n) for i in range(n)])
    sampled.append(points[-1]);vertices=[];faces=[]
    for i,(x,y) in enumerate(sampled):
        prev=sampled[max(0,i-1)];nxt=sampled[min(len(sampled)-1,i+1)]
        dx,dy=nxt[0]-prev[0],nxt[1]-prev[1];length=math.hypot(dx,dy)
        nx,ny=-dy/length*width/2,dx/length*width/2
        for sign in [-1,1]:
            px,py=x+sign*nx,y+sign*ny
            h=ground(world,px,py)+lift if fixed_height is None else fixed_height
            vertices.append((px,py,h))
        if i:
            a=(i-1)*2;faces.extend([(a,a+2,a+3),(a,a+3,a+1)])
    if fixed_height is None:vertices,faces=drape(world,vertices,faces,lift)
    return mesh(scene,name,vertices,faces,material,collision=material!='water')


def disk(scene,world,name,x,y,r,material,z=None,n=48,sx=1,sy=1):
    centre=(x,y,ground(world,x,y)+.09 if z is None else z)
    vs=[centre]
    for i in range(n):
        a=math.tau*i/n;px=x+math.cos(a)*r*sx;py=y+math.sin(a)*r*sy
        vs.append((px,py,ground(world,px,py)+.09 if z is None else z))
    return mesh(scene,name,vs,[(0,1+i,1+(i+1)%n) for i in range(n)],material)


def house(scene,world,name,x,y,w,d,h,yaw=0,roof=True,colour='cream'):
    c,s=math.cos(yaw),math.sin(yaw)
    corners=[ground(world,x+c*dx-s*dy,y+s*dx+c*dy) for dx in [-w/2,w/2] for dy in [-d/2,d/2]]
    bottom,top=min(corners),max(corners)
    box(scene,name+'_foundation',x,y,bottom,w+.4,d+.4,top-bottom+.25,'stone',yaw)
    box(scene,name,x,y,top+.25,w,d,h,colour,yaw)
    if roof:
        vs=[(-w/2,-d/2,0),(w/2,-d/2,0),(-w/2,d/2,0),(w/2,d/2,0),(0,-d/2,2.8),(0,d/2,2.8)]
        obj=mesh(scene,name+'_roof',vs,[(0,2,5,4),(1,4,5,3),(0,4,1),(2,3,5)],'tile',collision=True)
        obj.location=(x,y,top+.25+h);obj.rotation_euler.z=yaw
    # Window bands are inset visually by frame mass; no emissive placeholders.
    for side in [-1,1]:
        for floor in range(max(1,int(h/3.2))):
            local_y=side*(d/2+.015)
            box(scene,name+'_windows',x-s*local_y,y+c*local_y,top+1.25+floor*3.2,w*.66,.04,1.1,'glass',yaw,False)


def tree(scene,world,x,y,h=9):
    z=ground(world,x,y)
    box(scene,'Tree_trunk',x,y,z,.45,.45,h*.6,'trunk')
    n=7;vs=[(x,y,z+h),(x,y,z+h*.36)]
    vs.extend((x+math.cos(i*math.tau/n)*h*.29,y+math.sin(i*math.tau/n)*h*.29,z+h*.64) for i in range(n))
    mesh(scene,'Tree_crown',vs,[(0,2+i,2+(i+1)%n) for i in range(n)]+[(1,2+(i+1)%n,2+i) for i in range(n)],'leaf')


def build(world):
    scene=new_scene(world);terrain(scene,world)
    if world=='izma':
        scene['label']='River terraces'
        water=[(curve_x(y),y) for y in range(-310,311,10)]
        ribbon(scene,world,'River',water,29,'water',fixed_height=1.5)
        for side in [-1,1]:
            ribbon(scene,world,'Lower_river_walk',[(curve_x(y)+side*35,y) for y in range(-290,291,10)],5,'walk')
            ribbon(scene,world,'Quayside_street',[(curve_x(y)+side*81,y) for y in range(-280,281,10)],12)
            ribbon(scene,world,'Upper_footway',[(curve_x(y)+side*69,y) for y in range(-280,281,10)],4,'walk')
        bridge_y=-80;bridge_x=curve_x(bridge_y)
        ribbon(scene,world,'Bridge',[(bridge_x-86,bridge_y),(bridge_x+86,bridge_y)],14,'walk',fixed_height=8.2)
        for side in [-1,1]:
            for i in range(22):
                box(scene,'Bridge_parapet',bridge_x-86+(i+.5)*172/22,bridge_y+side*6.8,8.2,172/22,.35,1.05,'stone')
        for side in [-1,1]:
            # Broad sloping approaches connect lower and upper river walks.
            ribbon(scene,world,'Bank_ramp',[(curve_x(150)+side*35,150),(curve_x(210)+side*52,210),(curve_x(265)+side*69,265)],4,'walk',lift=.12)
            for i,y in enumerate([-220,-158,-15,53,120,205]):
                if side == -1 and y in [-15,53,120]:continue
                x=curve_x(y)+side*(113 if i%2 else 122)
                house(scene,world,'Quay_building',x,y,26 if i%3 else 35,24,9.6 if i%2 else 16,roof=i%3==0,colour=['wall','cream','brick'][i%3])
            for i,y in enumerate([-260,-160,-40,80,195,270]):
                if side == -1 and y in [-40,80,195]:continue
                house(scene,world,'Hillside_home',side*230,y,20,22,6.2,roof=True,colour='cream')
        ribbon(scene,world,'West_hillside_lane',[(-215,-285),(-210,-100),(-225,45),(-207,205),(-165,285)],7)
        for y in [-240,-180,15,90,180,275]:
            for side in [-1,1]:tree(scene,world,curve_x(y)+side*55,y,8)
        exec(compile((ROOT/'assets/blender/izma_river_neighborhood.py').read_text(),
                     str(ROOT/'assets/blender/izma_river_neighborhood.py'),'exec'),globals())
        build_river_neighborhood(scene)
        scene['spawn']=[bridge_x+46,bridge_y,8.2];scene['look_at']=[bridge_x-115,bridge_y+5,10]
    elif world=='cooper':
        scene['label']='Ballpark neighbourhood'
        loop=[(-190,-260),(-155,-125),(-164,85),(-145,260),(15,305),(175,235),(212,65),(174,-100),(145,-265),(-25,-302),(-190,-260)]
        ribbon(scene,world,'Neighbourhood_drive',loop,11)
        ribbon(scene,world,'Commons_walk',[(-150,-125),(-75,-90),(30,-60),(95,70),(175,235)],4,'walk')
        # The diamond is a deliberate open centre, with houses outside it.
        diamond=[(-45,4),(2,51),(-45,98),(-92,51),(-45,4)]
        ribbon(scene,world,'Diamond',diamond,8,'sand')
        field=[(-45+math.sin(a)*140,4+math.cos(a)*140) for a in [(-45+i*3)*math.pi/180 for i in range(31)]]
        ribbon(scene,world,'Outfield_arc',field,.65,'white',lift=.13)
        for end in [field[0],field[-1]]:ribbon(scene,world,'Foul_line',[(-45,4),end],.5,'white',lift=.14)
        for x,y in diamond[:-1]:box(scene,'Base',x,y,ground(world,x,y)+.11,1.1,1.1,.06,'white',math.pi/4,False)
        disk(scene,world,'Pitchers_mound',-45,51,4,'sand')
        for side in [-1,1]:
            for i,y in enumerate([-225,-150,-75,5,85,165,235]):
                x=side*(221 if side<0 else 263)
                house(scene,world,'Detached_home',x,y,21+(i%2)*4,22,5.8,roof=True,colour=['cream','brick','wall'][i%3])
                # Paths meet the loop without turning lawns into parking lots.
                near=min(loop[:-1],key=lambda p:abs(p[1]-y)) if side<0 else None
                rx=(-165 if y<150 else -145) if side<0 else (190 if y<180 else 175)
                ribbon(scene,world,'House_walk',[(x-side*12,y),(rx,y)],2.4,'walk')
        for x in [-110,-30,55,120]:house(scene,world,'North_home',x,340,23,21,6,roof=True)
        for x,y in [(-123,-190),(-112,-15),(-114,160),(-105,240),(100,-220),(135,-80),(158,85),(115,220),(20,265)]:tree(scene,world,x,y,12)
        scene['spawn']=[-118,-104,ground(world,-118,-104)+.08];scene['look_at']=[-45,65,7]
    else:
        scene['label']='Hillside gardens'
        ribbon(scene,world,'Garden_avenue',[(-225,-310),(-130,-245),(10,-215),(135,-130),(195,20),(195,190),(100,300),(-90,295),(-210,205)],10)
        ribbon(scene,world,'Lakeside_walk',[(-210,205),(-150,143),(-135,15),(-90,-70),(5,-65),(100,10),(108,140),(58,200),(-80,210)],4.5,'walk')
        disk(scene,world,'Garden_lake',-60,60,58,'water',z=2.2,n=64,sx=1,sy=1.15)
        estates=[(-220,-180,0),(-130,-315,.18),(70,-280,-.16),(210,-175,.34),(255,70,.2),(205,280,-.4),(-15,315,0),(-225,195,.1)]
        for i,(x,y,yaw) in enumerate(estates):
            house(scene,world,'Garden_estate',x,y,42,30,7.6,yaw,roof=i%3==0,colour='cream')
            # Large gardens, low wings and terraces define the estate scale.
            house(scene,world,'Estate_wing',x-20,y-23,22,14,4.2,yaw,roof=False,colour='wall')
            disk(scene,world,'Estate_garden',x,y+32,19,'earth')
        for x,y in [(-170,-95),(-150,5),(-160,110),(-145,225),(-70,-140),(0,-160),(115,-70),(145,75),(140,200),(30,250)]:tree(scene,world,x,y,13)
        scene['spawn']=[-145,-8,ground(world,-145,-8)+.08];scene['look_at']=[70,100,18]
    return scene


for key,colour in PALETTE.items():
    mat=bpy.data.materials.get('SWL_'+key) or bpy.data.materials.new('SWL_'+key)
    rgb=[int(colour[i:i+2],16)/255 for i in (1,3,5)]
    mat.diffuse_color=(*rgb,1);mat['srgb']=colour

rebuild_worlds=globals().get('SWL_REBUILD_WORLDS',['izma','cooper','elysium'])
scenes={build(world) for world in rebuild_worlds}
plans=json.loads((ROOT/'assets/blender/world-plans.json').read_text())
for world,plan in plans.items():
    if world not in rebuild_worlds:continue
    scene=new_scene('plan_'+world)
    width=math.pi*plan['radius']/3 if world=='izma' else math.tau*plan['radius']
    scene['extent']=[width,plan['span']]
    scene['label']='Master plan — design proposal, not a canonical map'
    outline=bpy.data.curves.new('Habitable_surface','CURVE');outline.dimensions='3D'
    spline=outline.splines.new('POLY');spline.points.add(4)
    for p,(x,y) in zip(spline.points,[(-width/2,-plan['span']/2),(width/2,-plan['span']/2),(width/2,plan['span']/2),(-width/2,plan['span']/2),(-width/2,-plan['span']/2)]):p.co=(x,y,0,1)
    obj=bpy.data.objects.new('Habitable_surface',outline);scene.collection.objects.link(obj)
    for region in plan['regions']:
        x,y=region['centre'];w,d=region['extent']
        material={'urban':'brick','residential':'cream','garden':'earth','industry':'roof','water':'water'}[region['use']]
        obj=mesh(scene,region['name'],[(x-w/2,y-d/2,0),(x+w/2,y-d/2,0),(x+w/2,y+d/2,0),(x-w/2,y+d/2,0)],[(0,1,2,3)],material)
        obj['land_use']=region['use'];obj['design_status']='proposed extent'
    mesh(scene,'Playable_study_640x800',[(-320,-400,1),(320,-400,1),(320,400,1),(-320,400,1)],[(0,1,2,3)],'white')
    scenes.add(scene)
scenes.update(s for s in bpy.data.scenes if s.name.startswith('SWL_') and s.get('owner')==OWNER)
bpy.context.view_layer.update()
bpy.data.libraries.write(str(ROOT/'assets/blender/world-landscapes.blend'),scenes,fake_user=True,compress=True)
exec(compile((ROOT/'assets/blender/export_world_landscapes.py').read_text(),str(ROOT/'assets/blender/export_world_landscapes.py'),'exec'))
