"""Place explicit local street blocks between the saved stations and centres.

This is an offline authoring pass. It preserves occupied land, water, transport
and the study. The resulting points are saved as editable Blender source next.
"""
import json, math, hashlib
from pathlib import Path

ROOT=Path(__file__).resolve().parents[2]
ASSETS=ROOT/'assets/blender'
SPACING=math.tau*3200/3

def rectangle(x,y,yaw,w,d):
    c,s=math.cos(yaw),math.sin(yaw)
    return [(x+c*u-s*v,y+s*u+c*v) for u,v in [(-w/2,-d/2),(w/2,-d/2),(w/2,d/2),(-w/2,d/2)]]

def overlaps(a,b,margin=0):
    for poly in [a,b]:
        for p,q in zip(poly,poly[1:]+poly[:1]):
            dx,dy=q[0]-p[0],q[1]-p[1];length=math.hypot(dx,dy)
            if length<1e-8:continue
            nx,ny=-dy/length,dx/length
            aa=[x*nx+y*ny for x,y in a];bb=[x*nx+y*ny for x,y in b]
            if max(aa)+margin<min(bb) or max(bb)+margin<min(aa):return False
    return True

def corridor(a,b,width):
    return rectangle((a[0]+b[0])/2,(a[1]+b[1])/2,math.atan2(b[1]-a[1],b[0]-a[0]),math.dist(a[:2],b[:2]),width)

def project(x,y,a,b):
    dx,dy=b[0]-a[0],b[1]-a[1]
    t=max(0,min(1,((x-a[0])*dx+(y-a[1])*dy)/max(.0001,dx*dx+dy*dy)))
    return a[0]+dx*t,a[1]+dy*t,t

class ReservationIndex:
    """Broad-phase cells only; the final predicate remains the polygon SAT."""
    def __init__(self):self.shapes=[];self.cells={}
    def keys(self,poly,margin=0):
        xs=[p[0] for p in poly];ys=[p[1] for p in poly]
        for x in range(math.floor((min(xs)-margin)/128),math.floor((max(xs)+margin)/128)+1):
            for y in range(math.floor((min(ys)-margin)/128),math.floor((max(ys)+margin)/128)+1):yield x,y
    def append(self,poly,tag=None):
        index=len(self.shapes);self.shapes.append((poly,tag))
        for key in self.keys(poly):self.cells.setdefault(key,[]).append(index)
    def intersects(self,poly,margin=0,exclude=None):
        ids={i for key in self.keys(poly,margin) for i in self.cells.get(key,[])}
        return any(tag!=exclude and overlaps(poly,shape,margin) for i in ids for shape,tag in [self.shapes[i]]) if exclude is not None else any(overlaps(poly,self.shapes[i][0],margin) for i in ids)

def author():
    master=json.loads((ASSETS/'izma-colony-plan.json').read_text())
    plan=json.loads((ASSETS/'izma-urban-plan.json').read_text())
    # The previous loose infill is replotted after these streets. Reserving
    # those plots first would lock the new neighbourhood to the sparse layout.
    parcels=json.loads((ASSETS/'izma-parcels.json').read_text())['parcels']
    public=json.loads((ASSETS/'izma-public-spaces.json').read_text())['places']
    rail=json.loads((ASSETS/'izma-rail.json').read_text())
    nodes={n['id']:n for n in master['nodes']}
    reservations=[[] for _ in range(3)]
    for p in parcels:
        reservations[p['band']].append(p.get('lot',{}).get('polygon') or rectangle(*p['position'],p['yaw'],p['size'][0]+2,p['size'][1]+3))
        reservations[p['band']].append(corridor(p['access']['start'],p['access']['end'],3.5))
    for p in public:
        reservations[p['band']].append(rectangle(*p['position'],p['yaw'],p['size'][0]+3,p['size'][1]+3))
        reservations[p['band']].append(corridor(p['entry'],p['threshold'],5))
    for station in rail['stations']:
        for a,b in zip(station['approach'],station['approach'][1:]):reservations[station['band']].append(corridor(a,b,5))
    reservations[0].append(rectangle(0,0,0,700,860))
    roads=[[] for _ in range(3)]
    for r in master['routes']:
        for aid,bid in zip(r['nodes'],r['nodes'][1:]):
            a,b=nodes[aid],nodes[bid]
            if a['band']!=b['band']:continue
            band=a['band'];shift=band*SPACING
            roads[band].append((r,[a['xy'][0]+shift,a['xy'][1]],[b['xy'][0]+shift,b['xy'][1]]))
    streets=[];districts=[]
    for district in master['districts']:
        id=district['id'];band=district['band'];spec=plan['districts'][id]
        station=nodes[id+'-station']['xy'];centre=district['centre'];length=math.dist(station,centre)
        dx,dy=(centre[0]-station[0])/length,(centre[1]-station[1])/length
        def xy(s,v):return [station[0]+band*SPACING+dx*s-dy*v,station[1]+dy*s+dx*v]
        water=master['water'][band]
        water_shapes=[corridor([a[0]+band*SPACING,a[1]],[b[0]+band*SPACING,b[1]],water['bankWidth']*2+8)
            for a,b in zip(water['reach'],water['reach'][1:])]
        accepted=[];rejected={}
        reach=min(length-38,spec.get('stationReach',length));block=spec['blockLength']
        for side,depth in enumerate(spec['depths']):
            starts=list(range(45,math.floor(reach-70),block))
            for index,start in enumerate(starts):
                span=min(block-15,reach-start)
                if span<70:continue
                found=False
                # A small set of explicit site alternatives relocates the block
                # around reservations; it does not perturb a pre-existing grid.
                for slide in [0,18,-18,35]:
                    for factor in [1,.8,1.2]:
                        a=max(40,start+slide);b=min(reach,a+span)
                        if b-a<65:continue
                        span2=b-a;dep=depth*factor
                        if spec['character']=='lanes':sketch=[(0,0),(.13,.72),(.56,1),(.84,.8),(1,0)]
                        elif spec['character']=='courts':sketch=[(0,0),(.24,.8),(.68,1),(1,0)]
                        elif spec['character']=='works':sketch=[(0,0),(.08,1),(.83,1),(1,0)]
                        else:sketch=[(0,0),(.4,.65),(.76,1)]
                        points=[xy(a+t*span2,v*dep) for t,v in sketch]
                        width=6.5 if spec['character']=='works' else 5.5 if spec['character']=='courts' else 4.5
                        shapes=[corridor(p,q,width+2) for p,q in zip(points,points[1:])]
                        reason=None
                        if any(overlaps(shape,p) for shape in shapes for p in reservations[band]):reason='occupied'
                        elif any(overlaps(shape,p) for shape in shapes for p in water_shapes):reason='water'
                        elif any(overlaps(shape,corridor(p,q,r['width']+3)) for shape in shapes for r,p,q in roads[band] if r['id']!=id+'-station-road'):reason='transport'
                        if reason:
                            rejected[reason]=rejected.get(reason,0)+1;continue
                        street={'id':f'urban-{id}-{side}-{index}','district':id,'band':band,'kind':'local','width':width,
                            'points':points,'connections':[id+'-station-road']*(1 if spec['character']=='groves' else 2),
                            'character':spec['character']}
                        streets.append(street);accepted.append(street['id']);reservations[band].extend(shapes)
                        found=True;break
                    if found:break
        districts.append({'id':id,'station':xy(0,0),'centre':xy(length,0),'reach':reach,'streets':accepted,'rejected':rejected,
            'landUse':'small settlement in landscape' if 'stationReach' in spec else 'continuous urban frontage with back streets'})
    dependencies={p:hashlib.sha256((ASSETS/p).read_bytes()).hexdigest() for p in [
        'izma-colony-plan.json','izma-urban-plan.json','izma-parcels.json','izma-public-spaces.json','izma-rail-plan.json','izma-transport.json']}
    # Rail service meshes depend on the final infill contract; only its station
    # reservations are upstream here, avoiding a cyclic file-hash dependency.
    reservation_digest=hashlib.sha256(json.dumps(rail['stations'],sort_keys=True,separators=(',',':')).encode()).hexdigest()
    result={'origin':'ai','created':'2026-09-18','version':1,'districts':districts,'streets':streets,
        'railStationDigest':reservation_digest,'dependencies':dependencies}
    (ASSETS/'izma-urban-streets.json').write_text(json.dumps(result,indent=2)+'\n')
    return result

if __name__=='__main__':
    result=author()
    print(json.dumps({'streets':len(result['streets']),'length':sum(math.dist(a,b) for s in result['streets'] for a,b in zip(s['points'],s['points'][1:])),
        'districts':[{k:d[k] for k in ['id','streets','rejected']} for d in result['districts']]},indent=2))
