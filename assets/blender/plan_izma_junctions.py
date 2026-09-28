"""Grade three ring motorways and nine JCTs against the installed native source.

Run in isolated Blender. This writes a candidate only; it does not retire any
old barrier or publish unverified geometry to the runtime.
"""
import argparse
import bisect
import hashlib
import json
import math
from pathlib import Path
import sys

ASSETS = Path(__file__).resolve().parent
ROOT = ASSETS.parents[1]
sys.path.insert(0, str(ASSETS))
from colony_manifest_io import read_manifest
from plan_izma_interband import grade_envelope
from plan_izma_motorway import stations
from izma_junction_alignments import OUTER, LOOP


def at_axis(points, value, axis):
    values = [p[axis] for p in points]
    value = min(values[-1], max(values[0], value))
    i = min(len(points)-2, max(0, bisect.bisect_right(values, value)-1))
    a, b = points[i:i+2]; t = (value-a[axis])/(b[axis]-a[axis])
    return [a[k]+(b[k]-a[k])*t for k in range(3)]


def plan(survey_path, candidate):
    from mathutils.bvhtree import BVHTree
    assert candidate.is_absolute() and not candidate.exists()
    survey = json.loads(survey_path.read_text())
    assert not any(s['conflicts'] for s in survey['sites'])
    assert not any(r['conflicts'] for r in survey['rings'])
    for name, digest in survey['dependencies'].items():
        assert hashlib.sha256((ASSETS/name).read_bytes()).hexdigest() == digest, name
    document = ROOT/'src/worlds/generated/izmaColony.json'
    assert json.loads(document.read_text())['sourceSha256'] == survey['sourceSha256']
    source = read_manifest(document); radius = survey['radius']
    transport = json.loads((ASSETS/'izma-motorway-routes.json').read_text())
    profiles = {p['id']:p['points'] for p in transport['profiles']}
    layers = {'base':source['base'], **{k:v['fixed'] for k,v in source.items() if isinstance(v,dict) and 'fixed' in v}}

    def curved(p):
        x,y,h = p
        return (math.cos(x/radius)*(radius-h), y, math.sin(x/radius)*(radius-h))

    earth = []; floors = []
    for name, packed in layers.items():
        vertices = [curved(packed['vertices'][i:i+3]) for i in range(0,len(packed['vertices']),3)]
        for index in packed['meshes'].get('earth', []): earth.append(vertices[index])
        for surface in packed['surfaces']:
            if surface.get('groundSurface',True):
                floors.extend(vertices[i] for i in surface['indices'])
    def tree(points):
        return BVHTree.FromPolygons(points,[tuple(range(i,i+3)) for i in range(0,len(points),3)],all_triangles=True)
    soil_tree = tree(earth); floor_tree = tree(floors)
    del earth, floors, layers, source
    cache = {}

    def ground(x,y,roads=False):
        key=(round(x,5),round(y,5),roads)
        if key not in cache:
            hit=(floor_tree if roads else soil_tree).ray_cast((0,y,0),(math.cos(x/radius),0,math.sin(x/radius)))[0]
            cache[key]=radius-math.hypot(hit.x,hit.z) if hit else None
        return cache[key]

    def offsets(points,i,width):
        a,b=points[max(0,i-1)],points[min(len(points)-1,i+1)]
        dx,dy=b[0]-a[0],b[1]-a[1];distance=math.hypot(dx,dy);p=points[i]
        return [(p[0]-dy/distance*v,p[1]+dx/distance*v) for v in [-width/2,0,width/2]]

    failures=[];rings=[];sites=[];terminal_retirements=[]
    for original in survey['rings']:
        points=original['points']
        raw=[]
        for i,p in enumerate(points[:-1]):
            floors=[ground(x,y,True) for x,y in offsets(points,i,28)]
            # In a light strip the deck bridges to hull-supported piers. No
            # artificial earth is inserted to support a newly authored road.
            raw.append([*p,max([0.,*[h for h in floors if h is not None]])+10.])
        group=[s for s in survey['sites'] if s['index']==original['index']]
        for _ in range(12):
            changed=False
            for site in group:
                selected=[i for i,p in enumerate(raw) if abs(p[0]-site['x'])<OUTER+35]
                height=max(max(raw[i][2] for i in selected),at_axis(profiles[f"band-{site['band']}-expressway"],site['y'],1)[2]+12.)
                for i in selected:
                    if abs(raw[i][2]-height)>1e-7: changed=True
                    raw[i][2]=height
            raw=grade_envelope(raw,.04,True)
            if not changed: break
        else: raise ValueError('JCT plateaus did not converge')
        raw.append([*points[-1],raw[0][2]])
        rings.append({**original,'points':raw,'deckThickness':2.4,
                      'maximumGrade':max(abs(b[2]-a[2])/math.dist(a[:2],b[:2]) for a,b in zip(raw,raw[1:]))})

    for original in survey['sites']:
        x,y=original['x'],original['y'];band=original['band'];index=original['index']
        mainline=profiles[f'band-{band}-expressway'];ring=rings[index]['points']
        ring_height=at_axis(ring,x,0)[2]
        new_movements=[]
        for movement in original['movements']:
            points=movement['points'];along=stations(points)
            pin={}
            for i,p in enumerate(points):
                if abs(p[0]-x)<16.:
                    pin[i]=at_axis(mainline,p[1],1)[2]
                elif abs(p[1]-y)<16.:
                    pin[i]=at_axis(ring,p[0],0)[2]
            assert 0 in pin and len(points)-1 in pin
            first=0
            while first+1 in pin:first+=1
            last=len(points)-1
            while last-1 in pin:last-=1
            assert first<last and all(i<=first or i>=last for i in pin)
            raw=[]
            for i,p in enumerate(points):
                minimum=0.
                for px,py in offsets(points,i,9.):
                    earth=ground(px,py)
                    if earth is not None:minimum=max(minimum,earth+1.4)
                    floor=ground(px,py,True)
                    if abs(px-x)>16. and floor is not None and (earth is None or floor>earth+.5):
                        minimum=max(minimum,floor+8.6)
                # The climb starts after the shared carriageway surface and
                # finishes before the merge. Interpolating over the entire
                # arc would insert a step immediately beside a pinned seam.
                t=max(0.,min(1.,(along[i]-along[first])/(along[last]-along[first])))
                height=max(minimum,pin[first]*(1-t)+pin[last]*t)
                if i in pin:height=pin[i]
                raw.append([*p,height])
            graded=grade_envelope(raw,.06)
            for i,height in pin.items():
                if abs(graded[i][2]-height)>.002:
                    failures.append({'kind':'unreachable-pinned-deck','route':movement['id'],
                                     'point':i,'height':height,'required':graded[i][2]})
            new_movements.append({**movement,'points':graded,'length':along[-1],
                                  'deckThickness':.9,'pinnedStations':sorted(pin),
                                  'maximumGrade':max(abs(b[2]-a[2])/math.dist(a[:2],b[:2]) for a,b in zip(graded,graded[1:]))})
        if index != 1:
            sign=-1 if index==0 else 1
            old_end=mainline[0] if sign<0 else mainline[-1]
            terminal=y+sign*LOOP
            assert sign*(old_end[1]-terminal)>0
            terminal_retirements.append({'id':original['id'],'band':band,'x':x,'from':terminal,'to':old_end[1],
                                         'width':24.,'preserveCrossingRoute':f'band-{band}-transfer-access-{index}',
                                         'purpose':'Retire the unused highway tail; preserve the general transfer road and its pavement at the former terminus.'})
        sites.append({**original,'movements':new_movements,'ringHeight':ring_height,
                      'mainlineHeight':at_axis(mainline,y,1)[2]})

    target=candidate/'assets/blender';target.mkdir(parents=True)
    result={'origin':'ai','created':'2026-09-21','version':1,'radius':radius,
            'sourceSha256':survey['sourceSha256'],'surveySha256':hashlib.sha256(survey_path.read_bytes()).hexdigest(),
            'dependencies':survey['dependencies'],'sites':sites,'rings':rings,'terminalRetirements':terminal_retirements,
            'failures':failures,'status':'Vertical candidate only; barriers, supports, native clearances, topology and runtime acceptance pending.'}
    (target/'izma-junction-plan.json').write_text(json.dumps(result,separators=(',',':'))+'\n')
    report={'sites':len(sites),'ramps':sum(len(s['movements']) for s in sites),'rings':len(rings),
            'ringLength':sum(stations(r['points'])[-1] for r in rings),
            'failures':failures[:20],'failureCount':len(failures),
            'heights':[{'id':s['id'],'mainline':s['mainlineHeight'],'ring':s['ringHeight']} for s in sites]}
    (candidate/'vertical-summary.json').write_text(json.dumps(report,indent=2)+'\n')
    return report


if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--survey',type=Path,required=True);p.add_argument('--candidate-root',type=Path,required=True)
    args=p.parse_args(sys.argv[sys.argv.index('--')+1:])
    report=plan(args.survey,args.candidate_root);print(json.dumps(report),flush=True)
    if report['failureCount']:raise ValueError('Junction vertical design needs correction')
