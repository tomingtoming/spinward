"""Site end galleries and their approaches against the saved native terrain.

Run in an isolated Blender with an explicit candidate root. This first stage
builds the general-traffic end rings; motorway and central connections remain
separate reservations. Existing city and longitudinal profiles are untouched.
"""
import argparse
import hashlib
import heapq
import json
import math
from pathlib import Path
import sys

ASSETS = Path(__file__).resolve().parent
ROOT = ASSETS.parents[1]
sys.path.insert(0, str(ASSETS))
from colony_manifest_io import encoded, read_manifest


def grade_envelope(points, maximum, closed=False):
    """Least upward-only correction satisfying adjacent grade limits."""
    heights = [p[2] for p in points]
    queue = [(-h, i) for i, h in enumerate(heights)]
    heapq.heapify(queue)
    while queue:
        negative, i = heapq.heappop(queue)
        if -negative < heights[i] - 1e-9:
            continue
        neighbours = [i-1, i+1]
        for j in neighbours:
            if closed:
                j %= len(points)
            elif not 0 <= j < len(points):
                continue
            distance = math.dist(points[i][:2], points[j][:2])
            if closed and abs(i-j) > 1:
                distance = math.dist(points[0][:2], points[1][:2])
            wanted = heights[i] - maximum * distance
            if heights[j] < wanted - 1e-9:
                heights[j] = wanted
                heapq.heappush(queue, (-wanted, j))
    return [[p[0], p[1], heights[i]] for i, p in enumerate(points)]


def plan_interband(candidate):
    from mathutils.bvhtree import BVHTree
    if not candidate.is_absolute() or candidate.resolve() == ROOT:
        raise ValueError('Use a separate absolute candidate root')
    master = json.loads((ASSETS / 'izma-colony-plan.json').read_text())
    transport = json.loads((ASSETS / 'izma-transport.json').read_text())
    document = ROOT / 'src/worlds/generated/izmaColony.json'
    source = read_manifest(document)
    radius = master['radius']; circumference = math.tau * radius
    spacing = circumference / 3; half_land = radius * master['landArcRadians'] / 2
    base = source['base']; points = []
    earth = [base['vertices'][i*3:i*3+3] for i in base['meshes']['earth']]
    for x, y, h in earth:
        points.append((math.cos(x/radius)*(radius-h), y, math.sin(x/radius)*(radius-h)))
    tree = BVHTree.FromPolygons(points, [tuple(range(i, i+3)) for i in range(0,len(points),3)], all_triangles=True)
    cache = {}

    def ground(x, y):
        key = (round(x,6),round(y,6))
        if key not in cache:
            hit = tree.ray_cast((0,y,0),(math.cos(x/radius),0,math.sin(x/radius)))[0]
            cache[key] = radius - math.hypot(hit.x,hit.z) if hit else None
        return cache[key]

    def supporting_height(x, y):
        h = ground(x, y)
        if h is not None:
            return h
        # Across a light strip interpolate the neighbouring land edges. The
        # physical supports below use the structural shell, never fictitious soil.
        band = math.floor(x / spacing)
        left, right = band * spacing + half_land - .05, (band+1)*spacing-half_land+.05
        if not left < x < right:
            raise ValueError(('Missing authored land', x,y,left,right))
        a,b = ground(left,y),ground(right,y)
        if a is None or b is None:
            raise ValueError(('Missing light-strip anchors',x,y,a,b))
        return a+(b-a)*(x-left)/(right-left)

    nodes = {n['id']: n for n in master['nodes']}
    rings, approaches = [], []
    count = math.ceil(circumference/8); step = circumference/count
    x_start = -half_land
    for index, sign in [(0,-1),(2,1)]:
        axial = sign * 19600
        raw = []
        for i in range(count):
            x=x_start+i*step
            h=max(supporting_height(x,axial+dy) for dy in [-14,0,14])+1.6
            raw.append([x,axial,h])
        profile = grade_envelope(raw,.05,True)
        profile.append([x_start+circumference,axial,profile[0][2]])
        ident = 'end-'+('minus' if sign<0 else 'plus')

        def ring_height(x):
            u=((x-x_start)%circumference)/step
            i=min(count-1,math.floor(u)); t=u-i
            return profile[i][2]*(1-t)+profile[i+1][2]*t

        gates=[]
        for band in range(3):
            node=nodes[f'band-{band}-transfer-{index}']
            x=node['xy'][0]+band*spacing; y=node['xy'][1]
            original=next(p for p in transport['profiles'] if p['id']==f'band-{band}-transfer-access-{index}')
            at=min(original['points'],key=lambda p:math.dist(p[:2],node['xy']))
            assert math.dist(at[:2],node['xy'])<1e-6
            start=[x,y,at[2]]; end=[x,axial-sign*8,ring_height(x)]
            # This short raised driveway crosses the old 14 cm pavement edge.
            # Its ramp is explicit and remains subject to live-body traversal.
            length=abs(end[1]-y); n=math.ceil(length/8); approach=[]
            for j in range(n+1):
                t=j/n; ay=y+(end[1]-y)*t; distance=abs(ay-y)
                soil=max(supporting_height(x+dx,ay) for dx in [-12.2,0,12.2])
                h=max(soil+.16,at[2]*(1-t)+end[2]*t)
                if distance<24:
                    h=max(h,at[2]+.02+.16*min(1,distance/8))
                if j==0:h=at[2]+.02
                if j==n:h=end[2]
                approach.append([x,ay,h])
            graded=grade_envelope(approach,.06)
            if abs(graded[0][2]-approach[0][2])>.002:
                raise ValueError(('Approach needs a longer alignment',ident,band,graded[0],graded[-1],start,end))
            # A transverse junction needs one surface shared with the ring.
            # Ring slope is held flat across its 24.4 m-wide mouth below.
            gate={'id':f'{ident}-band-{band}','band':band,'x':x,'start':start,
                  'profile':graded,'width':20,'footway':2.2,'road':original['id']}
            approaches.append(gate);gates.append(gate['id'])
        rings.append({'id':ident,'sign':sign,'axial':axial,'profile':profile,'gates':gates,
                      'roadWidth':16,'footway':5.4,'maximumGrade':.05,'deckThickness':1.2})

    # Flatten each T-junction mouth and blend its neighbours through the same
    # upward grade envelope. Then resample approach termini from that final ring.
    for ring in rings:
        profile=ring['profile'][:-1]
        for gate in [a for a in approaches if a['id'] in ring['gates']]:
            ids=[i for i,p in enumerate(profile) if abs(p[0]-gate['x'])<24]
            h=max(max(p[2] for p in gate['profile'][-4:]),max(profile[i][2] for i in ids))
            for i in ids:profile[i][2]=h
        profile=grade_envelope(profile,.05,True)
        profile.append([x_start+circumference,ring['axial'],profile[0][2]])
        ring['profile']=profile
        for gate in [a for a in approaches if a['id'] in ring['gates']]:
            u=(gate['x']-x_start)/step;i=math.floor(u);t=u-i
            target=profile[i][2]*(1-t)+profile[i+1][2]*t
            original=gate['profile'];length=abs(original[-1][1]-original[0][1])
            for p in original:
                p[2]=max(p[2],target-.06*abs(original[-1][1]-p[1]))
                if abs(original[-1][1]-p[1])<24:p[2]=target
            original[-1][2]=target
            gate['profile']=grade_envelope(original,.06)
            assert abs(gate['profile'][0][2]-gate['start'][2]-.02)<.002
        ring['maximumGrade']=max(abs(b[2]-a[2])/math.dist(a[:2],b[:2]) for a,b in zip(profile,profile[1:]))
    for gate in approaches:
        gate['maximumGrade']=max(abs(b[2]-a[2])/math.dist(a[:2],b[:2]) for a,b in zip(gate['profile'],gate['profile'][1:]))

    supports=[]
    for route in [*rings,*approaches]:
        ring='axial' in route
        for i,p in enumerate(route['profile'][4:-4:8]):
            x,y,h=p
            # Twin columns on the light strip bear on the hull at h=0. On
            # land their footings use the actual saved soil at all four corners.
            for side in [-1,1]:
                px,py=(x,y+side*10.5) if ring else (x+side*8,y)
                soil=[ground(px+dx,py+dy) for dx in [-1,1] for dy in [-1,1]]
                available=[v for v in soil if v is not None]
                floor=min(available)-.25 if available else -.15
                top=h-1.2
                if top-floor>.1:
                    supports.append({'route':route['id'],'position':[px,py,floor],
                                     'height':top-floor,'onHull':not available})

    result={'version':1,'origin':'ai','created':'2026-09-20','radius':radius,'span':master['span'],
            'sourceSha256':json.loads(document.read_text())['sourceSha256'],
            'earthSha256':hashlib.sha256(encoded(earth)).hexdigest(),
            'dependencies':{name:hashlib.sha256((ASSETS/name).read_bytes()).hexdigest()
                            for name in ['izma-colony-plan.json','izma-transport.json']},
            'rings':rings,'approaches':approaches,'supports':supports,
            'deferred':['independent motorway end rings and IC/JCT ramps','central interband crossing','scheduled cross-band transport service'],
            'status':'candidate general-traffic end galleries; surface/clearance/runtime checks pending'}
    path=candidate/'assets/blender/izma-interband-plan.json';path.parent.mkdir(parents=True,exist_ok=True)
    path.write_bytes(encoded(result))
    print(json.dumps({'rings':len(rings),'approaches':len(approaches),'ringGrades':[r['maximumGrade'] for r in rings],
                      'approachGrades':[a['maximumGrade'] for a in approaches],'candidate':str(candidate)}),flush=True)


if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--candidate-root',type=Path,required=True)
    args=parser.parse_args(sys.argv[sys.argv.index('--')+1:]);plan_interband(args.candidate_root)
