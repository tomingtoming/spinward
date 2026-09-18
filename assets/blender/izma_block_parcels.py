"""Partition an authored, star-shaped street block into fronts and an open court.

Each edge owns a triangle to the court centre. All plots are clipped inside
that triangle, so oblique neighbours meet without overlapping rectangles.
The small plot gaps and explicit gates remain part of the connected court.
"""
import math
from izma_ground_patches import area, clip
from izma_street_frontages import clean, half_plane, subtract
from plan_izma_urban import project, corridor


def return_path(points, start, end):
    def locate(p):
        return min((math.dist(project(*p,a,b)[:2],p),i,project(*p,a,b)[2])
                   for i,(a,b) in enumerate(zip(points,points[1:])))
    ds,si,st=locate(start);de,ei,et=locate(end)
    assert max(ds,de)<.001, 'Block ends must meet the saved parent street'
    if (si,st)>(ei,et):return list(reversed(return_path(points,end,start)))
    return [start,*points[si+1:ei+1],end]


def block_boundary(outer,parent):
    back=return_path(parent['points'],outer['points'][-1],outer['points'][0])
    polygon=outer['points']+back[1:-1]
    widths=[outer['width']]*(len(outer['points'])-1)+[parent['width']]*(len(back)-1)
    if area(polygon)<0:
        polygon=list(reversed(polygon));widths=list(reversed(widths[:-1]))+[widths[-1]]
    return polygon,widths


def restrict(polygon,origin,axis,minimum,maximum):
    # An oriented slab. Its boundary directions keep increasing dot products.
    for limit,sign in [(minimum,1),(maximum,-1)]:
        a=(origin[0]+axis[0]*limit,origin[1]+axis[1]*limit)
        b=(a[0]+axis[1]*sign,a[1]-axis[0]*sign)
        polygon=half_plane(polygon,a,b,True)
    return polygon


def bevel_acute(polygon):
    """Leave a buildable end wall instead of a repeated needle-shaped room."""
    original=polygon[:]
    for i,p in enumerate(original):
        a,b=original[i-1],original[(i+1)%len(original)]
        la,lb=math.dist(p,a),math.dist(p,b)
        if min(la,lb)<1e-7:continue
        u=[(a[k]-p[k])/la for k in range(2)];v=[(b[k]-p[k])/lb for k in range(2)]
        angle=math.acos(max(-1,min(1,sum(u[k]*v[k] for k in range(2)))))
        if angle>=math.radians(55):continue
        distance=min(3,min(la,lb)*.22)
        q=[p[k]+u[k]*distance for k in range(2)];r=[p[k]+v[k]*distance for k in range(2)]
        polygon=half_plane(polygon,q,r,True)
    return polygon


def partition(polygon,widths,spec):
    centre=tuple(sum(p[k] for p in polygon)/len(polygon) for k in range(2))
    # A centre outside the visibility kernel would let a sector cross a road.
    for a,b in zip(polygon,polygon[1:]+polygon[:1]):
        assert (b[0]-a[0])*(centre[1]-a[1])-(b[1]-a[1])*(centre[0]-a[0])>0,'Author a centre visible from every edge'
    plots=[];courts=[];gates=[];sectors=[]
    for edge,(a,b,width) in enumerate(zip(polygon,polygon[1:]+polygon[:1],widths)):
        length=math.dist(a,b);t=((b[0]-a[0])/length,(b[1]-a[1])/length);n=(-t[1],t[0])
        verge=width/2+spec['setback'];depth=spec['depths'][edge%len(spec['depths'])]
        sector=restrict(clean([a,b,centre]),a,n,width/2+.25,10000)
        sectors.append(sector)
        ribbon=restrict(sector,a,n,verge,verge+depth)
        front=[p for p in ribbon if abs((p[0]-a[0])*n[0]+(p[1]-a[1])*n[1]-verge)<1e-5]
        if len(front)<2:continue
        lo,hi=sorted((p[0]-a[0])*t[0]+(p[1]-a[1])*t[1] for p in front)[::len(front)-1]
        intervals=[(lo,hi)]
        if edge in spec['gateEdges']:
            middle=(lo+hi)/2;half=spec['gateWidth']/2
            intervals=[(lo,middle-half),(middle+half,hi)]
            road=[a[k]+t[k]*middle+n[k]*(width/2+.3) for k in range(2)]
            inner=[a[k]+t[k]*middle+n[k]*(verge+depth+2) for k in range(2)]
            gates.append({'edge':edge,'start':road,'end':inner,'width':spec['gateWidth']})
        for begin,end in intervals:
            cursor=begin;address=0
            while end-cursor>=4.2:
                desired=spec['frontWidths'][(edge+address)%len(spec['frontWidths'])]
                remaining=end-cursor
                span=remaining if remaining<desired+4.2 else desired
                gap=spec['gap'];piece=restrict(ribbon,a,t,cursor+gap/2,cursor+span-gap/2)
                fa=[p for p in piece if abs((p[0]-a[0])*n[0]+(p[1]-a[1])*n[1]-verge)<1e-5]
                if len(fa)==2 and math.dist(*fa)>=3.5 and abs(area(piece))>=24:
                    front_mid=[(fa[0][k]+fa[1][k])/2 for k in range(2)]
                    start=[front_mid[k]-n[k]*spec['setback'] for k in range(2)]
                    plots.append({'outline':piece,'edge':edge,'front':fa,'entry':front_mid,'approach':start,
                        'family':spec['families'][(edge+address)%len(spec['families'])],
                        'floors':spec['storeys'][(edge*2+address)%len(spec['storeys'])],
                        'area':abs(area(piece))})
                cursor+=span;address+=1
    roads=[clean(corridor(a,b,w+.5)) for a,b,w in zip(polygon,polygon[1:]+polygon[:1],widths)]
    # The court still reaches the kerb. Buildings must also clear footways on
    # adjoining edges, not just the street their front door faces.
    footways=[clean(corridor(a,b,w+2*spec['setback']))
              for a,b,w in zip(polygon,polygon[1:]+polygon[:1],widths)]
    passages=[clean(corridor(a,b,g['width'])) for g in gates
              for a,b in [(g['start'],g['end']),(g['end'],centre)]]
    accepted=[]
    for plot in plots:
        pieces=[plot['outline']]
        for reserved in footways+passages:
            pieces=[q for p in pieces for q in subtract(p,reserved)]
        a,b=plot['front'];dx,dy=b[0]-a[0],b[1]-a[1];length=math.hypot(dx,dy)
        choices=[]
        for piece in pieces:
            piece=bevel_acute(piece)
            front=[p for p in piece if abs(dx*(p[1]-a[1])-dy*(p[0]-a[0]))/length<1e-5]
            if len(front)!=2 or math.dist(*front)<3.5 or abs(area(piece))<24:continue
            choices.append((abs(area(piece)),piece,front))
        if not choices:continue
        size,piece,front=max(choices,key=lambda c:c[0]);entry=[sum(q[k] for q in front)/2 for k in range(2)]
        delta=[entry[k]-plot['entry'][k] for k in range(2)]
        accepted.append({**plot,'outline':piece,'front':front,'area':size,'entry':entry,
                         'approach':[plot['approach'][k]+delta[k] for k in range(2)]})
    legal=[]
    for sector in sectors:
        pieces=[sector]
        for road in roads:pieces=[q for p in pieces for q in subtract(p,road)]
        legal.extend(pieces)
    courts=legal
    for plot in accepted:courts=[q for p in courts for q in subtract(p,plot['outline'])]
    return {'centre':centre,'plots':accepted,'courtPieces':courts,'gates':gates,'sectors':legal}


def intersection_area(a,b):
    return abs(area(clip(a,clean(b))))


def faces_close_neighbour(a,b,neighbours,clearance=2):
    """A side wall is blank only when another parcel screens its whole span."""
    length=math.dist(a,b);normal=((b[1]-a[1])/length,-(b[0]-a[0])/length)
    ray=(normal[0]*clearance,normal[1]*clearance)
    def cross(u,v):return u[0]*v[1]-u[1]*v[0]
    def blocked(fraction):
        p=tuple(a[k]+(b[k]-a[k])*fraction for k in range(2))
        for polygon in neighbours:
            for q,z in zip(polygon,polygon[1:]+polygon[:1]):
                edge=(z[0]-q[0],z[1]-q[1]);den=cross(ray,edge)
                if abs(den)<1e-9:continue
                delta=(q[0]-p[0],q[1]-p[1])
                t,u=cross(delta,edge)/den,cross(delta,ray)/den
                if 1e-5<t<=1 and 0<=u<=1:return True
        return False
    return all(blocked(f) for f in [.15,.5,.85])
