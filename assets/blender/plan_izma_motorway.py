"""Grade all 18 district ICs against saved native earth in an isolated candidate.

Run with Blender --background --factory-startup. The existing motorway is a
fixed height constraint. These profiles are authoring inputs, not installed
roads: removal of the old T junctions and native clearance checks must follow.
"""
import argparse
import bisect
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


def stations(points):
    result = [0.]
    for a, b in zip(points, points[1:]):
        result.append(result[-1] + math.dist(a[:2], b[:2]))
    return result


def sample(points, along, distance):
    i = min(len(points)-2, max(0, bisect.bisect_right(along, distance)-1))
    a, b = points[i:i+2]
    t = max(0., min(1., (distance-along[i])/(along[i+1]-along[i])))
    return [a[k]+(b[k]-a[k])*t for k in range(len(a))]


def densify(points, extra=()):
    points = [p for i,p in enumerate(points) if i==0 or math.dist(p[:2],points[i-1][:2])>1e-7]
    along = stations(points)
    breaks = set(along) | {min(along[-1],max(0,d)) for d in extra}
    for a, b in zip(along, along[1:]):
        count = max(1, math.ceil((b-a)/6))
        breaks.update(a+(b-a)*i/count for i in range(1, count))
    ordered = []
    for d in sorted(breaks):
        if not ordered or d-ordered[-1]>1e-7:ordered.append(d)
    return [sample(points, along, d) for d in ordered]


def plan_motorway(survey_path, candidate):
    from mathutils.bvhtree import BVHTree
    if not candidate.is_absolute() or candidate.resolve() == ROOT or candidate.exists():
        raise ValueError('Use a fresh isolated absolute candidate directory')
    survey = json.loads(survey_path.read_text())
    document = ROOT / 'src/worlds/generated/izmaColony.json'
    header = json.loads(document.read_text())
    assert survey['sourceSha256'] == header['sourceSha256']
    for name, expected in survey['dependencies'].items():
        assert hashlib.sha256((ASSETS/name).read_bytes()).hexdigest() == expected, name
    source = read_manifest(document)
    master = json.loads((ASSETS/'izma-colony-plan.json').read_text())
    transport = json.loads((ASSETS/'izma-transport.json').read_text())
    radius = master['radius']; spacing = math.tau*radius/3
    profiles = {p['id']:p for p in transport['profiles']}
    base = source['base']; vertices = base['vertices']
    earth = [vertices[i*3:i*3+3] for i in base['meshes']['earth']]
    wrapped = [(math.cos(x/radius)*(radius-h), y, math.sin(x/radius)*(radius-h)) for x,y,h in earth]
    tree = BVHTree.FromPolygons(wrapped, [tuple(range(i,i+3)) for i in range(0,len(wrapped),3)], all_triangles=True)
    cache = {}

    def ground(x,y):
        key = (round(x,6),round(y,6))
        if key not in cache:
            hit = tree.ray_cast((0,y,0),(math.cos(x/radius),0,math.sin(x/radius)))[0]
            if hit is None:
                raise ValueError(('No native earth under IC',x,y))
            cache[key] = radius-math.hypot(hit.x,hit.z)
        return cache[key]

    interchanges = []; failures = []
    for ic in survey['interchanges']:
        # Civic's north ramps pass below the central transfer approach. A
        # longer alignment delays their climb until beyond that crossing.
        chosen = next(a for a in ic['alternatives'] if a['offset']==32 and a['span']==650) if ic['id']=='a-civic-ic' else ic['alternatives'][0]
        assert not chosen['overlaps'], ('Occupied candidate',ic['id'])
        band = ic['band']; nx, ny = ic['node']; outward = 1 if band != 1 else -1
        highway = profiles[f'band-{band}-expressway']['points']
        highway_y = [p[1] for p in highway]
        access = profiles[ic['id'].removesuffix('-ic')+'-access']['points']
        access_world = [[p[0]+band*spacing,p[1],p[2]] for p in access]
        access_along = stations(access_world)

        def motorway(y):
            i = min(len(highway)-2,max(0,bisect.bisect_right(highway_y,y)-1))
            a,b = highway[i:i+2]; t = (y-a[1])/(b[1]-a[1])
            return a[2]+(b[2]-a[2])*t

        # Keep the existing city-street junctions at the outer end of the
        # survey envelope. Replacement begins inside the final 360 m only.
        common = [p for p in chosen['commonRoad'] if math.dist(p,[nx,ny])<=360]
        common_along = stations(common)
        # The far ramp pair forms the terminal T. A road stub beyond it has no
        # destination, so it is not built merely to match the survey envelope.
        branch_distances = {}
        for ramp in chosen['ramps']:
            p = ramp['points'][0]
            branch_distances[ramp['side']] = math.dist(common[0],p)
        terminal = branch_distances[1]
        common = [*filter(lambda p:math.dist(common[0],p)<terminal-1e-7,common),
                  sample(common,common_along,terminal)]
        common_length=stations(common)[-1]
        plateau_boundaries=[d+delta for d in branch_distances.values() for delta in [-28,0,28]
                            if 0<=d+delta<=common_length]
        common = densify(common, plateau_boundaries)
        roads = [{'id':ic['id']+'-underpass','kind':'arterial','width':16.,'footway':2.2,
                  'gradeLimit':.06,'points':common}]
        for ramp in chosen['ramps']:
            roads.append({'id':ic['id']+'-ramp-'+ramp['id'].replace(':','-'), 'kind':'ramp',
                          'width':7.,'footway':0.,'gradeLimit':.06,'side':ramp['side'],
                          'direction':ramp['direction'],'points':densify(ramp['points'],[30])})
        heights = {}; edges = {}; pinned = {}; soil_samples = {}
        common_first = min(range(len(access_world)),key=lambda i:math.dist(access_world[i][:2],common[0]))
        assert math.dist(access_world[common_first][:2],common[0])<.001

        def key(p):
            return f'{p[0]:.6f}:{p[1]:.6f}'

        for road in roads:
            points = road['points']; along = stations(points); keys = []
            for i,p in enumerate(points):
                ident = key(p); keys.append(ident); edges.setdefault(ident,[])
                a,b = points[max(0,i-1)],points[min(len(points)-1,i+1)]
                dx,dy = b[0]-a[0],b[1]-a[1]; length = math.hypot(dx,dy)
                extent = road['width']/2+road['footway']
                soils = [ground(p[0]-dy/length*offset,p[1]+dx/length*offset) for offset in [-extent,0,extent]]
                soil_samples[ident] = max(soils)
                heights[ident] = max(heights.get(ident,-math.inf),max(soils)+.16)
                if road['kind']=='arterial' and along[i]<=16:
                    old = sample(access_world,access_along,access_along[common_first]+along[i])[2]
                    pinned[ident] = old
                if road['kind']=='ramp' and outward*(p[0]-nx)*road['side']<=20.00001:
                    # The last 120 m align vertically before entering the
                    # existing carriageway; no uphill lip at the merge.
                    pinned[ident] = motorway(p[1])
                if i:
                    previous = keys[i-1]; cost = road['gradeLimit']*(along[i]-along[i-1])
                    edges[previous].append((ident,cost)); edges[ident].append((previous,cost))
            road['keys'] = keys
        # A vehicle turns across a finite junction, not a single shared point.
        # Level the common road for 28 m on either side and the first 30 m of
        # both ramps. These small turning areas share one solved height; the
        # neighbouring approaches retain the same grade constraints.
        junction_plateaus=[];common_stations=stations(common)
        for side,distance in branch_distances.items():
            at=min(range(len(common)),key=lambda i:abs(common_stations[i]-distance))
            anchor=roads[0]['keys'][at];members=[]
            for i,position in enumerate(common_stations):
                if abs(position-distance)<=28.00001:members.append(roads[0]['keys'][i])
            for road in roads[1:]:
                if road['side']!=side:continue
                members.extend(k for k,along in zip(road['keys'],stations(road['points'])) if along<=30.00001)
            for member in members:
                if member==anchor:continue
                edges[anchor].append((member,0.));edges[member].append((anchor,0.))
            junction_plateaus.append({'side':side,'position':common[at],'commonRadius':28,
                                      'rampLength':30,'anchor':anchor,'members':members})
        for ident,h in pinned.items():
            if heights[ident]>h+.025:
                failures.append({'id':ic['id'],'kind':'fixed-surface-below-earth','point':ident,'minimum':heights[ident],'fixed':h})
            heights[ident] = max(h,heights[ident])
        queue = [(-h,k) for k,h in heights.items()]; heapq.heapify(queue)
        while queue:
            negative,k = heapq.heappop(queue)
            if -negative<heights[k]-1e-9:continue
            for other,cost in edges[k]:
                wanted = heights[k]-cost
                if heights[other]<wanted-1e-9:
                    heights[other]=wanted;heapq.heappush(queue,(-wanted,other))
        for ident,h in pinned.items():
            if abs(heights[ident]-h)>.025:
                failures.append({'id':ic['id'],'kind':'grade-cannot-meet-fixed-surface','point':ident,'solved':heights[ident],'fixed':h})
        for plateau in junction_plateaus:
            anchor=plateau.pop('anchor');members=plateau.pop('members')
            plateau['height']=heights[anchor]
            assert all(abs(heights[k]-heights[anchor])<1e-7 for k in members)
        clearances = []
        for road in roads:
            road['points'] = [[*p,heights[k],soil_samples[k]] for p,k in zip(road['points'],road.pop('keys'))]
            road['maximumGrade'] = max(abs(b[2]-a[2])/math.dist(a[:2],b[:2]) for a,b in zip(road['points'],road['points'][1:]))
            assert road['maximumGrade']<=road['gradeLimit']+1e-7
            if road['kind']=='arterial':
                for p in road['points']:
                    if abs(p[0]-nx)<=13:
                        clearances.append(motorway(p[1])-2.4-p[2]-.14)
        minimum_clearance = min(clearances)
        if minimum_clearance<6.2:
            failures.append({'id':ic['id'],'kind':'underpass-clearance','minimum':minimum_clearance})
        for ramp in roads[1:]:
            branch = min(roads[0]['points'],key=lambda p:math.dist(p[:2],ramp['points'][0][:2]))
            assert math.dist(branch[:3],ramp['points'][0][:3])<.001
        mainline=[[nx,p[1],p[2],p[3]] for p in highway if ny-chosen['span']-60<=p[1]<=ny+chosen['span']+60]
        mainline=[p for i,p in enumerate(mainline) if i==0 or math.dist(p[:2],mainline[i-1][:2])>1e-7]
        interchanges.append({'id':ic['id'],'band':band,'node':ic['node'],
            'rampOffset':chosen['offset'],'rampSpan':chosen['span'],'roads':roads,
            'junctionPlateaus':junction_plateaus,
            'minimumProfileUnderpassClearance':minimum_clearance,
            'mainline':mainline,
            'replaceOriginalAccessFrom':roads[0]['points'][0][:3],
            'replaceOriginalNodeCap':ic['id']})
    result={'origin':'ai','created':'2026-09-20','version':1,'radius':radius,'span':master['span'],
        'sourceSha256':header['sourceSha256'],'dependencies':survey['dependencies'],
        'surveySha256':hashlib.sha256(survey_path.read_bytes()).hexdigest(),
        'earthSha256':hashlib.sha256(encoded(earth)).hexdigest(),'interchanges':interchanges,
        'failures':failures,'groundQueries':len(cache),
        'status':'Vertical planning candidate; original T junctions remain installed. Native geometry, supports, crossings, collision and runtime acceptance pending.'}
    path=candidate/'assets/blender/izma-motorway-plan.json';path.parent.mkdir(parents=True)
    path.write_bytes(encoded(result))
    print(json.dumps({'interchanges':len(interchanges),'ramps':sum(len(i['roads'])-1 for i in interchanges),
        'minimumProfileClearance':min(i['minimumProfileUnderpassClearance'] for i in interchanges),
        'maximumGrade':max(r['maximumGrade'] for i in interchanges for r in i['roads']),
        'failures':failures,'candidate':str(candidate)}),flush=True)
    if failures:raise ValueError('Candidate profile constraints failed; preserve report and revise design')


if __name__=='__main__':
    parser=argparse.ArgumentParser()
    parser.add_argument('--survey',type=Path,required=True)
    parser.add_argument('--candidate-root',type=Path,required=True)
    args=parser.parse_args(sys.argv[sys.argv.index('--')+1:])
    plan_motorway(args.survey,args.candidate_root)
