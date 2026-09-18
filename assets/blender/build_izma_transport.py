"""Replace planning ribbons with terrain-following streets and supported decks.

Run after the base colony export. The terrain source is the exported Blender
earth mesh, including the preserved study's collar, not an analytic heightmap.
New meshes are saved in both existing editable scenes; planning alignments
remain hidden as a reference. IC lane geometry and inter-strip spans follow.
"""
import bpy
import math
import json
import hashlib
import heapq
from pathlib import Path
import sys
sys.path.insert(0,str(Path(__file__).resolve().parent))
from colony_manifest_io import read_manifest
from mathutils import Vector
from mathutils.bvhtree import BVHTree

ROOT=Path(__file__).resolve().parents[2]
PLAN=json.loads((ROOT/'assets/blender/izma-colony-plan.json').read_text())
SOURCE=read_manifest(ROOT/'src/worlds/generated/izmaColony.json')
R=PLAN['radius'];SPACING=math.tau*R/3
OWNER='spinward-izma-transport-v1'
SCENES=[bpy.data.scenes['SWC_izma_unrolled'],bpy.data.scenes['SWC_izma_cylinder']]
NODES={n['id']:n for n in PLAN['nodes']}
ROUTE_IDS={r['id'] for r in PLAN['routes']}
OUT=ROOT/'qa/webxr/evidence/colony-transport-20260917'
OUT.mkdir(parents=True,exist_ok=True)

# The input faces are precisely the application's existing earth. The model
# remains editable in Blender and exports through the same geometry pipeline.
packed=SOURCE['base'];pool=packed['vertices'];indices=packed['meshes']['earth']
earth=[]
for i in indices:
    x,y,h=pool[i*3:i*3+3];a=x/R
    earth.append((math.cos(a)*(R-h),y,math.sin(a)*(R-h)))
tree=BVHTree.FromPolygons(earth,[(i,i+1,i+2) for i in range(0,len(earth),3)],all_triangles=True)
terrain_hash=hashlib.sha256(json.dumps(earth,separators=(',',':')).encode()).hexdigest()
ground_cache={}
def ground(band,x,y):
    key=(band,round(x,5),round(y,5))
    if key not in ground_cache:
        a=band*math.tau/3+x/R
        hit=tree.ray_cast(Vector((0,y,0)),Vector((math.cos(a),0,math.sin(a))))
        ground_cache[key]=R-math.hypot(hit[0].x,hit[0].z) if hit[0] else .03
    return ground_cache[key]

def water(band,y):
    reach=PLAN['water'][band]['reach']
    for a,b in zip(reach,reach[1:]):
        if y<=b[1]:
            t=max(0,min(1,(y-a[1])/(b[1]-a[1])))
            return (a[0]+(b[0]-a[0])*t,a[2]+(b[2]-a[2])*t+.15)
    return reach[-1][0],reach[-1][2]+.15

def smooth(t):
    t=max(0,min(1,t));return t*t*(3-2*t)

def inside_study(band,x,y,margin=0):
    return band==0 and abs(x)<320+margin and abs(y)<400+margin

for scene in SCENES:
    for obj in list(scene.objects):
        if obj.get('transport_owner')==OWNER:
            bpy.data.objects.remove(obj,do_unlink=True)
        elif obj.type=='MESH' and obj.get('source_id','').split(':')[0] in ROUTE_IDS:
            obj.hide_render=True;obj.hide_viewport=True;obj['runtime_replaced']=True
    scene['transport_version']=1

for name,color in {'structure':'#8b8d82','ballast':'#77766e','kerb':'#c2bdab','parapet':'#b3b6ae','walk':'#ada992','verge':'#76816a'}.items():
    mat=bpy.data.materials.get('SWC_'+name) or bpy.data.materials.new('SWC_'+name)
    mat.diffuse_color=tuple(int(color[i:i+2],16)/255 for i in (1,3,5))+(1,)
    mat['srgb']=color

groups={}
solids={}
road_areas=[];pending_walks=[];pending_guards=[];pending_walls=[];current_route_id=''
def triangles(band,material,vs,faces,surface=False):
    key=(band,material,surface)
    target=groups.setdefault(key,[])
    for face in faces:
        for i in range(1,len(face)-1):target.extend([vs[face[0]],vs[face[i]],vs[face[i+1]]])

def box(band,x,y,z,w,d,h,yaw,material,solid=True):
    if h<=.01 or inside_study(band,x,y,max(w,d)/2):return
    vs=[];c=math.cos(yaw);s=math.sin(yaw)
    for sz in [0,1]:
        for sy in [-1,1]:
            for sx in [-1,1]:
                px,py=sx*w/2,sy*d/2
                vs.append((x+px*c-py*s,y+px*s+py*c,z+sz*h))
    triangles(band,material,vs,[(0,2,3,1),(4,5,7,6),(0,1,5,4),(2,6,7,3),(0,4,6,2),(1,3,7,5)])
    if solid:solids.setdefault(band,[]).append([x,y,z,w,d,h,yaw])

def edge_wall(band,a,b,bottom_a,bottom_b,material):
    pending_walls.append((band,current_route_id,a,b,bottom_a,bottom_b,material))

def clip(poly,axis,bound,less):
    result=[]
    for a,b in zip(poly,poly[1:]+poly[:1]):
        da=a[axis]-bound;db=b[axis]-bound
        ia=da<=1e-8 if less else da>=-1e-8
        ib=db<=1e-8 if less else db>=-1e-8
        if ia:result.append(a)
        if ia!=ib:
            t=da/(da-db);result.append(tuple(a[k]+(b[k]-a[k])*t for k in range(3)))
    return result

def outside(band,poly):
    if band!=0:return [poly]
    result=[];remaining=poly
    for axis,bound,less in [(0,-320,True),(0,320,False),(1,-400,True),(1,400,False)]:
        part=clip(remaining,axis,bound,less)
        if len(part)>2:result.append(part)
        remaining=clip(remaining,axis,bound,not less)
        if len(remaining)<3:break
    return result

def surface(band,material,poly):
    for p in outside(band,poly):
        if material in ['walk','verge']:pending_walks.append((band,material,p));continue
        if material in ['local','arterial','expressway']:
            road_areas.append((band,current_route_id,p));continue
        triangles(band,material,p,[tuple(range(len(p)))],True)

def halfplane(poly,a,b,inside):
    result=[]
    def signed(p):return (b[0]-a[0])*(p[1]-a[1])-(b[1]-a[1])*(p[0]-a[0])
    for p,q in zip(poly,poly[1:]+poly[:1]):
        dp,dq=signed(p),signed(q);ip=dp>=-1e-8 if inside else dp<=1e-8;iq=dq>=-1e-8 if inside else dq<=1e-8
        if ip:result.append(p)
        if ip!=iq:
            t=dp/(dp-dq);result.append(tuple(p[k]+(q[k]-p[k])*t for k in range(3)))
    return result

def subtract(poly,cutter):
    if max(p[0] for p in poly)<=min(p[0] for p in cutter)+1e-7 or min(p[0] for p in poly)>=max(p[0] for p in cutter)-1e-7 or max(p[1] for p in poly)<=min(p[1] for p in cutter)+1e-7 or min(p[1] for p in poly)>=max(p[1] for p in cutter)-1e-7:return [poly]
    area=sum(a[0]*b[1]-b[0]*a[1] for a,b in zip(cutter,cutter[1:]+cutter[:1]))
    if area<0:cutter=list(reversed(cutter))
    pieces=[];remaining=poly
    for a,b in zip(cutter,cutter[1:]+cutter[:1]):
        outside_piece=halfplane(remaining,a,b,False)
        if len(outside_piece)>2 and abs(sum(a[0]*b[1]-b[0]*a[1] for a,b in zip(outside_piece,outside_piece[1:]+outside_piece[:1])))>1e-5:pieces.append(outside_piece)
        remaining=halfplane(remaining,a,b,True)
        if len(remaining)<3 or abs(sum(a[0]*b[1]-b[0]*a[1] for a,b in zip(remaining,remaining[1:]+remaining[:1])))<1e-5:break
    return pieces

general_segments=[]
for route in PLAN['routes']:
    ns=[NODES[n] for n in route['nodes']]
    if route['kind'] not in ['local','arterial'] or len({n['band'] for n in ns})!=1:continue
    for a,b in zip(ns,ns[1:]):general_segments.append((a['band'],a['xy'],b['xy'],route['width']))

def on_general_road(band,x,y):
    for rb,a,b,w in general_segments:
        if rb!=band or x<min(a[0],b[0])-w-6 or x>max(a[0],b[0])+w+6 or y<min(a[1],b[1])-w-6 or y>max(a[1],b[1])+w+6:continue
        dx,dy=b[0]-a[0],b[1]-a[1]
        t=max(0,min(1,((x-a[0])*dx+(y-a[1])*dy)/(dx*dx+dy*dy)))
        if math.hypot(x-a[0]-t*dx,y-a[1]-t*dy)<w/2+5:return True
    return False

def initial_height(route,band,x,y,dx,dy):
    kind=route['kind'];w=route['width']/2+(2.2 if kind in ['arterial','local'] and route['width']>=10 else 0)
    g=max(ground(band,x,y),ground(band,x-dy*w,y+dx*w),ground(band,x+dy*w,y-dx*w))
    if kind=='expressway':return g+18
    river,wh=water(band,y);clearance=6 if kind=='rail' else 5.5
    bank=PLAN['water'][band]['width']/2+12
    h=max(g+(.45 if kind=='rail' else .16),wh+clearance-.04*max(0,abs(x-river)-bank))
    if kind=='arterial':
        for node in [NODES[n] for n in route['nodes'] if NODES[n]['role']=='interchange']:
            nx,ny=node['xy'];d=math.hypot(x-nx,y-ny)
            if d<600:h=max(h,g+.16+17.84*smooth(1-d/600))
    return h

# Find interior crossings before sampling. Ordinary streets share a junction;
# the rail crossing is a separate bridge with a directed clearance constraint.
segments=[];insertions={};crossings=[]
for route in PLAN['routes']:
    ns=[NODES[n] for n in route['nodes']]
    if len({n['band'] for n in ns})!=1:continue
    for si,(a,b) in enumerate(zip(ns,ns[1:])):
        segments.append((route,si,a,b))
for i,(ra,sa,aa,ab) in enumerate(segments):
    if ra['kind'] not in ['local','arterial','rail']:continue
    for rb,sb,ba,bb in segments[i+1:]:
        if ra['id']==rb['id'] or aa['band']!=ba['band'] or rb['kind'] not in ['local','arterial','rail']:continue
        if ra['kind']==rb['kind']=='rail':continue
        a,b,c,d=aa['xy'],ab['xy'],ba['xy'],bb['xy']
        u=(b[0]-a[0],b[1]-a[1]);v=(d[0]-c[0],d[1]-c[1]);den=u[0]*v[1]-u[1]*v[0]
        if abs(den)<1e-8:continue
        q=(c[0]-a[0],c[1]-a[1]);ta=(q[0]*v[1]-q[1]*v[0])/den;tb=(q[0]*u[1]-q[1]*u[0])/den
        if not (1e-7<ta<1-1e-7 and 1e-7<tb<1-1e-7):continue
        x,y=a[0]+u[0]*ta,a[1]+u[1]*ta;grade_separated='rail' in [ra['kind'],rb['kind']]
        key=f'cross:{aa["band"]}:{x:.5f}:{y:.5f}'
        ka=key+(':rail' if ra['kind']=='rail' else ':road') if grade_separated else key
        kb=key+(':rail' if rb['kind']=='rail' else ':road') if grade_separated else key
        insertions.setdefault((ra['id'],sa),[]).append((ta,ka));insertions.setdefault((rb['id'],sb),[]).append((tb,kb))
        crossings.append({'id':key,'band':aa['band'],'xy':[x,y],'routes':[ra['id'],rb['id']],
                          'keys':[ka,kb],'separated':grade_separated,'radius':max(ra['width'],rb['width'])/2+3})

# The smallest raised profile satisfying every adjacent grade constraint.
# Shared graph nodes get one height, so an independently generated approach
# cannot stop below a station or motorway deck. Never lower a road into earth.
heights={};edges={};samples={};junctions={}
for node in NODES.values():
    incident=[r for r in PLAN['routes'] if node['id'] in r['nodes'] and r['kind'] in ['local','arterial','expressway']]
    if any(r['kind'] in ['local','arterial'] for r in incident):
        junctions['node:'+node['id']]={'band':node['band'],'xy':node['xy'],'routes':[r['id'] for r in incident],
                                     'radius':max(r['width'] for r in incident)/2+3}
for crossing in crossings:
    if not crossing['separated']:junctions[crossing['id']]=crossing
for route in PLAN['routes']:
    ns=[NODES[n] for n in route['nodes']]
    if len({n['band'] for n in ns})!=1:continue
    band=ns[0]['band'];kind=route['kind'];previous=None
    step=32 if kind=='expressway' else 16 if kind=='rail' else 8
    grade=.04 if kind=='expressway' else .025 if kind=='rail' else .06
    for segment,(na,nb) in enumerate(zip(ns,ns[1:])):
        a,b=na['xy'],nb['xy'];length=math.dist(a,b);count=max(1,math.ceil(length/step))
        dx,dy=(b[0]-a[0])/length,(b[1]-a[1])/length
        points=[(i/count,'node:'+na['id'] if i==0 else 'node:'+nb['id'] if i==count else f'{route["id"]}:{segment}:{i}') for i in range(count+1)]
        for t,key in insertions.get((route['id'],segment),[]):
            points=[p for p in points if abs(p[0]-t)>1e-8];points.append((t,key))
        # Explicit plateau boundaries are necessary even when the flat patch
        # is shorter than the regular sampling interval. Otherwise a terminal
        # cap can be level while its adjoining deck is still sloping below it.
        for t,key in list(points):
            junction=junctions.get(key)
            if not junction:continue
            for sign in [-1,1]:
                boundary=t+sign*junction['radius']/length
                if 1e-8<boundary<1-1e-8 and not any(abs(p[0]-boundary)<1e-8 for p in points):
                    points.append((boundary,f'plateau:{route["id"]}:{segment}:{key}:{sign}'))
        points.sort();sampled=[]
        for i,(t,key) in enumerate(points):
            x=a[0]+(b[0]-a[0])*t;y=a[1]+(b[1]-a[1])*t
            sampled.append((t,key,x,y))
            heights[key]=max(heights.get(key,-math.inf),initial_height(route,band,x,y,dx,dy));edges.setdefault(key,[])
            if i:
                cost=grade*length*(t-points[i-1][0])
                edges[key].append((previous,cost));edges[previous].append((key,cost))
            previous=key
        samples[(route['id'],segment)]=sampled
        # A crossing has one flat turning area, not just one equal centre point.
        for _,centre,cx,cy in sampled:
            junction=junctions.get(centre)
            if not junction:continue
            for _,key,x,y in sampled:
                if key!=centre and math.hypot(x-cx,y-cy)<=junction['radius']+1e-5:
                    edges[key].append((centre,0));edges[centre].append((key,0))
for crossing in crossings:
    if crossing['separated']:
        rail=next(k for k in crossing['keys'] if k.endswith(':rail'));road=next(k for k in crossing['keys'] if k.endswith(':road'))
        # 6.2 m under the 0.9 m rail deck; allow crossfall/chord rounding.
        edges[road].append((rail,-7.2))
for key,junction in junctions.items():
    x,y=junction['xy'];radius=junction['radius']-2.75
    # A terminal extends beyond the alignment's end. Sample its full perimeter,
    # including the uphill half that no longitudinal road sample visits.
    heights[key]=max(heights[key],max(ground(junction['band'],x+math.cos(i*math.tau/16)*radius,
                                           y+math.sin(i*math.tau/16)*radius)+.16 for i in range(16)))
queue=[(-h,key) for key,h in heights.items()];heapq.heapify(queue)
while queue:
    negative,key=heapq.heappop(queue);h=-negative
    if h<heights[key]-1e-7:continue
    for other,cost in edges[key]:
        if heights[other]<h-cost-1e-7:
            heights[other]=h-cost;heapq.heappush(queue,(-heights[other],other))

profiles=[];bridges=[];piers=0;guardrails=0
for route in PLAN['routes']:
    ns=[NODES[n] for n in route['nodes']]
    if len({n['band'] for n in ns})!=1:continue
    band=ns[0]['band'];kind=route['kind'];width=route['width']
    if kind not in ['arterial','local','rail','expressway']:continue
    current_route_id=route['id']
    route_profile=[];along=0;last_pier=-100
    for segment,(na,nb) in enumerate(zip(ns,ns[1:])):
        a,b=na['xy'],nb['xy'];length=math.dist(a,b)
        dx,dy=(b[0]-a[0])/length,(b[1]-a[1])/length
        tangent=math.atan2(dy,dx)
        sections=[]
        for t,key,x,y in samples[(route['id'],segment)]:
            h=heights[key];g=ground(band,x,y);river,wh=water(band,y)
            over_water=abs(x-river)<PLAN['water'][band]['width']/2+12
            over_road=kind=='rail' and any(c['separated'] and route['id'] in c['routes'] and math.dist(c['xy'],[x,y])<45 for c in crossings)
            viaduct=kind=='expressway' or (h-g>1.4 and (over_water or over_road))
            deck=[]
            for side in [-1,1]:
                px,py=x-dy*width/2*side,y+dx*width/2*side
                deck.append((px,py,h))
            sections.append((deck,viaduct))
            route_profile.append([x,y,h,g])
            station=along+length*t
            if kind=='expressway' and station-last_pier>=48 and not over_water and not on_general_road(band,x,y):
                base=min(ground(band,x-dy*7,y+dx*7),ground(band,x+dy*7,y-dx*7))-.3
                for side in [-1,1]:box(band,x-dy*7*side,y+dx*7*side,base,2.4,2.4,h-2.4-base,tangent,'structure')
                piers+=2;last_pier=station
            if viaduct and over_water:bridges.append({'route':route['id'],'band':band,'position':[x,y,h],'water':wh,'clearance':h-wh})
        for i in range(len(sections)-1):
            a,av=sections[i];b,bv=sections[i+1];elevated=av or bv
            surface(band,'ballast' if kind=='rail' else kind,[a[0],a[1],b[1],b[0]])
            thickness=2.4 if kind=='expressway' else .9
            for side in [0,1]:
                pa,pb=a[side],b[side]
                ba=pa[2]-thickness if elevated else ground(band,pa[0],pa[1])-.03
                bb=pb[2]-thickness if elevated else ground(band,pb[0],pb[1])-.03
                if not (inside_study(band,*pa[:2],2) or inside_study(band,*pb[:2],2)):
                    edge_wall(band,pa,pb,ba,bb,'structure')
                # Pavements on larger ordinary streets. Narrow local lanes
                # remain shared streets rather than inheriting avenue width.
                if kind in ['local','arterial'] and width>=10:
                    sign=-1 if side==0 else 1
                    oa=(pa[0]-dy*2.2*sign,pa[1]+dx*2.2*sign,0)
                    ob=(pb[0]-dy*2.2*sign,pb[1]+dx*2.2*sign,0)
                    oa=(*oa[:2],pa[2]+.14);ob=(*ob[:2],pb[2]+.14)
                    surface(band,'walk',[(pa[0],pa[1],pa[2]+.14),oa,ob,(pb[0],pb[1],pb[2]+.14)])
                elif kind=='local' and not elevated:
                    # Shared narrow streets blend into the verge. A raised
                    # cut edge, even below 30 cm, can deflect the physical
                    # walking sphere instead of allowing a cross-street walk.
                    sign=-1 if side==0 else 1
                    oa=(pa[0]-dy*1.5*sign,pa[1]+dx*1.5*sign)
                    ob=(pb[0]-dy*1.5*sign,pb[1]+dx*1.5*sign)
                    surface(band,'verge',[pa,(*oa,ground(band,*oa)+.015),(*ob,ground(band,*ob)+.015),pb])
                if elevated and not (inside_study(band,*pa[:2],3) or inside_study(band,*pb[:2],3)):
                    # Resolve openings after all junction footprints exist.
                    # Follow the slope rather than using a horizontal box.
                    pending_guards.append((band,route['id'],pa,pb))
            if elevated:
                bottom=[(p[0],p[1],p[2]-thickness) for p in [a[0],a[1],b[1],b[0]]]
                for p in outside(band,bottom):triangles(band,'structure',p,[tuple(range(len(p)))])
                if kind!='expressway':
                    for end,transition in [(a,not av),(b,not bv)]:
                        if not transition:continue
                        x,y=(end[0][0]+end[1][0])/2,(end[0][1]+end[1][1])/2
                        base=min(ground(band,*p[:2]) for p in end)-.4
                        top=min(p[2] for p in end)-thickness
                        box(band,x,y,base,2.8,width,top-base,tangent,'structure')
        along+=length
    max_grade=max((abs(b[2]-a[2])/max(.01,math.dist(a[:2],b[:2])) for a,b in zip(route_profile,route_profile[1:])),default=0)
    profiles.append({'id':route['id'],'band':band,'kind':kind,'length':along,'maximumGrade':max_grade,'points':route_profile})

# One level junction/terminal cap per shared road node closes the outer turn
# wedges and gives an arrival point interior support instead of a fragile edge.
for key,node in junctions.items():
    x,y=node['xy'];band=node['band'];h=heights[key]
    radius=node['radius']-2.75
    polygon=[(x+math.cos(i*math.tau/16)*radius,y+math.sin(i*math.tau/16)*radius,h) for i in range(16)]
    current_route_id='junction:'+key;surface(band,'arterial',polygon)
    for a,b in zip(polygon,polygon[1:]+polygon[:1]):
        if not inside_study(band,*a[:2],2) and not inside_study(band,*b[:2],2):
            edge_wall(band,a,b,ground(band,*a[:2])-.03,ground(band,*b[:2])-.03,'structure')

# Clip every pavement against nearby carriageways at its level. This removes
# the crossing strips that otherwise obstruct a junction with raised paving.
road_grid={}
for band,rid,poly in road_areas:
    xs=[p[0] for p in poly];ys=[p[1] for p in poly]
    for ix in range(math.floor(min(xs)/64),math.floor(max(xs)/64)+1):
        for iy in range(math.floor(min(ys)/64),math.floor(max(ys)/64)+1):road_grid.setdefault((band,ix,iy),[]).append((rid,poly))

# One visible carriageway layer. Coincident unrolled polygons become slightly
# different chord planes on the cylinder, leaving dotted intersections unless
# the overlap is removed before projection. Junction caps own their footprint.
ordered=sorted(road_areas,key=lambda item:0 if item[1].startswith('junction:') else 1)
priority={id(poly):i for i,(_,_,poly) in enumerate(ordered)}
route_material={r['id']:r['kind'] for r in PLAN['routes']}
for band,rid,poly in ordered:
    xs=[p[0] for p in poly];ys=[p[1] for p in poly];near={}
    for ix in range(math.floor(min(xs)/64),math.floor(max(xs)/64)+1):
        for iy in range(math.floor(min(ys)/64),math.floor(max(ys)/64)+1):
            for other,cutter in road_grid.get((band,ix,iy),[]):
                if priority[id(cutter)]<priority[id(poly)]:near[id(cutter)]=cutter
    pieces=[poly]
    for cutter in near.values():
        if min(p[2] for p in poly)>max(p[2] for p in cutter)+.3 or max(p[2] for p in poly)<min(p[2] for p in cutter)-.3:continue
        pieces=[part for piece in pieces for part in subtract(piece,cutter)]
        if not pieces:break
    material='arterial' if rid.startswith('junction:') else route_material[rid]
    for p in pieces:triangles(band,material,p,[tuple(range(len(p)))],True)

for band,material,poly in pending_walks:
    xs=[p[0] for p in poly];ys=[p[1] for p in poly];near={}
    for ix in range(math.floor(min(xs)/64),math.floor(max(xs)/64)+1):
        for iy in range(math.floor(min(ys)/64),math.floor(max(ys)/64)+1):
            for rid,cutter in road_grid.get((band,ix,iy),[]):near[id(cutter)]=cutter
    pieces=[poly]
    for cutter in near.values():
        if min(p[2] for p in poly)>max(p[2] for p in cutter)+1 or max(p[2] for p in poly)<min(p[2] for p in cutter)-.3:continue
        pieces=[part for piece in pieces for part in subtract(piece,cutter)]
        if not pieces:break
    for p in pieces:triangles(band,material,p,[tuple(range(len(p)))],True)

def guard_span(a,b,poly,margin=.25):
    area=sum(p[0]*q[1]-q[0]*p[1] for p,q in zip(poly,poly[1:]+poly[:1]))
    if area<0:poly=list(reversed(poly))
    low,high=0.,1.
    for p,q in zip(poly,poly[1:]+poly[:1]):
        dx,dy=q[0]-p[0],q[1]-p[1]
        # Give the 32 cm wall width and small edge rounding an open margin.
        pad=margin*math.hypot(dx,dy)
        da=dx*(a[1]-p[1])-dy*(a[0]-p[0])+pad
        db=dx*(b[1]-p[1])-dy*(b[0]-p[0])+pad
        if da<0 and db<0:return None
        if da<0:low=max(low,da/(da-db))
        if db<0:high=min(high,da/(da-db))
        if low>=high:return None
    return low,high

for band,rid,a,b in pending_guards:
    near={}
    for ix in range(math.floor((min(a[0],b[0])-.3)/64),math.floor((max(a[0],b[0])+.3)/64)+1):
        for iy in range(math.floor((min(a[1],b[1])-.3)/64),math.floor((max(a[1],b[1])+.3)/64)+1):
            for other,poly in road_grid.get((band,ix,iy),[]):
                if other==rid or (other.startswith('junction:') and rid in junctions[other[len('junction:'):]]['routes']):continue
                near[id(poly)]=poly
    spans=[(0.,1.)]
    for poly in near.values():
        if min(a[2],b[2])>max(p[2] for p in poly)+.6 or max(a[2],b[2])<min(p[2] for p in poly)-.6:continue
        cut=guard_span(a,b,poly)
        if not cut:continue
        lo,hi=cut
        spans=[part for start,end in spans for part in [(start,min(end,lo)),(max(start,hi),end)] if part[1]-part[0]>1e-6]
    dx,dy=b[0]-a[0],b[1]-a[1];length=math.hypot(dx,dy)
    for lo,hi in spans:
        if (hi-lo)*length<.05:continue
        vs=[]
        for t in [lo,hi]:
            p=tuple(a[k]+(b[k]-a[k])*t for k in range(3))
            for z in [0,1.05]:
                for s in [-1,1]:vs.append((p[0]-dy/length*.16*s,p[1]+dx/length*.16*s,p[2]+z))
        triangles(band,'parapet',vs,[(0,1,3,2),(4,6,7,5),(0,4,5,1),(2,3,7,6),(0,2,6,4),(1,5,7,3)])
        guardrails+=1

# Retaining walls belong only to the outside of the road union. Internal
# junction/crossing walls otherwise reach through the neighbouring curved
# deck and show their pale top edges as dotted lines across the carriageway.
for band,rid,a,b,bottom_a,bottom_b,material in pending_walls:
    near={}
    for ix in range(math.floor(min(a[0],b[0])/64),math.floor(max(a[0],b[0])/64)+1):
        for iy in range(math.floor(min(a[1],b[1])/64),math.floor(max(a[1],b[1])/64)+1):
            for other,poly in road_grid.get((band,ix,iy),[]):
                if other!=rid:near[id(poly)]=poly
    spans=[(0.,1.)]
    for poly in near.values():
        if min(a[2],b[2])>max(p[2] for p in poly)+.3 or max(a[2],b[2])<min(p[2] for p in poly)-.3:continue
        cut=guard_span(a,b,poly,.002)
        if not cut:continue
        lo,hi=cut
        spans=[part for start,end in spans for part in [(start,min(end,lo)),(max(start,hi),end)] if part[1]-part[0]>1e-6]
    for lo,hi in spans:
        if (hi-lo)*math.dist(a[:2],b[:2])<.02:continue
        p=tuple(a[k]+(b[k]-a[k])*lo for k in range(3));q=tuple(a[k]+(b[k]-a[k])*hi for k in range(3))
        z0=bottom_a+(bottom_b-bottom_a)*lo;z1=bottom_a+(bottom_b-bottom_a)*hi
        triangles(band,material,[p,q,(q[0],q[1],z1),(p[0],p[1],z0)],[(0,1,2,3)])

# Bank abutments carry ordinary bridges: no piers are put in the watercourse.
for (band,material,is_surface),vs in groups.items():
    name=f'TR_{band}_{material}_{"floor" if is_surface else "body"}'
    for scene,wrapped in zip(SCENES,[False,True]):
        vertices=[]
        for x,y,h in vs:
            a=band*math.tau/3+x/R
            vertices.append((math.cos(a)*(R-h),y,math.sin(a)*(R-h)) if wrapped else (y,-band*SPACING-x,h))
        mesh=bpy.data.meshes.new(name);mesh.from_pydata(vertices,[],[(i,i+1,i+2) for i in range(0,len(vertices),3)]);mesh.update()
        obj=bpy.data.objects.new(name,mesh);scene.collection.objects.link(obj)
        mesh.materials.append(bpy.data.materials['SWC_'+material])
        obj['band']=band;obj['material']=material;obj['source_id']=name
        obj['transport_owner']=OWNER;obj['runtime_transport']=True;obj['runtime_surface']=is_surface
        if material=='structure' and not is_surface:obj['collider_boxes']=json.dumps(solids.get(band,[]),separators=(',',':'))

metadata={'version':1,'terrainHash':terrain_hash,'profiles':profiles,'piers':piers,'parapets':guardrails,
          'crossings':[{**c,'heights':[heights[k] for k in c['keys']]} for c in crossings],
          'bridgeSamples':bridges,'status':'terrain-following streets, filled approaches and supported longitudinal motorway; IC/JCT lane geometry and inter-strip spans pending'}
(ROOT/'assets/blender/izma-transport.json').write_text(json.dumps(metadata,separators=(',',':'))+'\n')
(OUT/'model.json').write_text(json.dumps({k:v for k,v in metadata.items() if k not in ['profiles','bridgeSamples']},indent=2)+'\n')
bpy.data.libraries.write(str(ROOT/'assets/blender/izma-colony.blend'),set(SCENES),fake_user=True,compress=True)
result={k:v for k,v in metadata.items() if k not in ['profiles','bridgeSamples']}
result['routes']=len(profiles);result['triangles']=sum(len(v)//3 for v in groups.values());result['worstGrades']=sorted([{'id':p['id'],'grade':p['maximumGrade']} for p in profiles],key=lambda p:-p['grade'])[:8]
