"""Resolve the replaced deck profiles and directed IC/mainline connections.

The original transport blockout remains the source for unchanged roads. This
sidecar describes the built replacement and explicit left-hand carriageways;
it does not assert that JCTs, interband links or traffic simulation are done.
"""
import argparse
import bisect
import hashlib
import json
import math
from pathlib import Path
from colony_manifest_io import read_manifest

ASSETS=Path(__file__).resolve().parent


def length(points):return sum(math.dist(a[:2],b[:2]) for a,b in zip(points,points[1:]))


def grade(points):
    return max((abs(b[2]-a[2])/math.dist(a[:2],b[:2]) for a,b in zip(points,points[1:])
                if math.dist(a[:2],b[:2])>1e-7),default=0.)


def resolve(plan,transport,master,river=None):
    spacing=plan['radius']*math.tau/3
    profiles={r['id']:{**r,'points':[[p[0]+r['band']*spacing,p[1],p[2]] for p in r['points']]}
              for r in transport['profiles']}
    reference_routes={r['id']:dict(r) for r in master['routes'] if r['id'] in profiles}
    graph_nodes={};reference_nodes={};edges=[];lanes={};replaced=[]
    for original in master['nodes']:
        x,y=original['xy'];x+=original['band']*spacing
        incident=[profiles[r['id']] for r in master['routes'] if original['id'] in r['nodes'] and r['id'] in profiles]
        matches=[p for r in incident for p in r['points'] if math.hypot(p[0]-x,p[1]-y)<1e-5]
        assert matches,original['id']
        reference_nodes[original['id']]={**original,'position':[x,y,matches[0][2]]}
    def node(ident,band,position,role):
        if ident in graph_nodes:
            assert math.dist(graph_nodes[ident]['position'],position)<1e-5,ident
        else:graph_nodes[ident]={'id':ident,'band':band,'position':list(position),'role':role}
        return ident
    def edge(ident,start,end,points,kind,bidirectional=False):
        assert len(points)>=2 and math.dist(points[0],graph_nodes[start]['position'])<1e-5
        assert math.dist(points[-1],graph_nodes[end]['position'])<1e-5
        assert grade(points)<=.060001,(ident,grade(points))
        edges.append({'id':ident,'from':start,'to':end,'points':points,'kind':kind,
                      'bidirectional':bidirectional,'length':length(points),'maximumGrade':grade(points)})
    def highway_at(band,y,side):
        points=profiles[f'band-{band}-expressway']['points'];ys=[p[1] for p in points]
        assert ys[0]<=y<=ys[-1]
        i=min(len(points)-2,max(0,bisect.bisect_right(ys,y)-1));a,b=points[i:i+2]
        t=(y-a[1])/(b[1]-a[1])
        return [a[0]+side*6,y,a[2]+(b[2]-a[2])*t]
    for ic in plan['interchanges']:
        band=ic['band'];ident=ic['id'];access=ident.removesuffix('-ic')+'-access'
        old=profiles[access]['points'];common=ic['roads'][0]
        seam=common['points'][0][:3]
        stop=min(range(len(old)),key=lambda i:math.dist(old[i],seam))
        assert math.dist(old[stop],seam)<.001,(ident,'access seam')
        resolved=[*old[:stop],*[p[:3] for p in common['points']]]
        centre=reference_routes[access]['nodes'][0]
        if river and river['replacesRoute']==access:
            join=river['joinOriginalAt']
            assert join<stop and math.dist(old[join],river['points'][-1])<1e-5
            resolved=[*river['points'],*old[join+1:stop],*[p[:3] for p in common['points']]]
            centre=river['entryNode']
        profiles[access]={**profiles[access],'points':resolved,'length':length(resolved),
                          'maximumGrade':grade(resolved),'replacement':ident}
        entry=node(centre,band,resolved[0],'district-entry')
        forks={};ordered=[]
        for fork in ic['junctionPlateaus']:
            p=[*fork['position'],fork['height']]
            at=min(range(len(resolved)),key=lambda i:math.dist(resolved[i],p))
            assert math.dist(resolved[at],p)<1e-5
            key=node(ident+'-fork-'+str(fork['side']),band,p,'local-ramp-junction')
            forks[fork['side']]=key;ordered.append((at,key))
        ordered.sort();prior=0;prior_id=entry
        for at,key in ordered:
            edge(access+'-'+str(at),prior_id,key,resolved[prior:at+1],'arterial',True)
            prior=at;prior_id=key
        assert prior==len(resolved)-1,'The far branch is the actual common-road terminal'
        reference_routes[access]['nodes']=[entry,*[key for _,key in ordered]]
        replaced.append({'originalAccess':access,'retiredAtGradeNode':ident,'newForks':list(forks.values())})
        reference_nodes[ident]['role']='motorway-overpass'
        for ramp in ic['roads'][1:]:
            path=[p[:3] for p in ramp['points']];end=path[-1]
            side=1 if end[0]>ic['node'][0] else -1
            heading=-side # Left-hand traffic: west carriageway goes towards increasing axial y.
            entering=ramp['direction']==heading
            connection=highway_at(band,end[1]+(20 if entering else -20)*heading,side)
            on_mainline=node(ramp['id']+'-mainline',band,connection,'merge' if entering else 'exit')
            lanes.setdefault((band,side),[]).append(on_mainline)
            connector=[end,connection] if entering else [connection,end]
            # A connector stays on its own carriageway and moves with its traffic.
            assert all(side*(p[0]-ic['node'][0])>=5.999 for p in connector)
            assert (connector[-1][1]-connector[0][1])*heading>0
            fork=forks[ramp['side']]
            points=[*path,connection] if entering else [connection,*reversed(path)]
            edge(ramp['id'],fork if entering else on_mainline,on_mainline if entering else fork,points,'on-ramp' if entering else 'off-ramp')
            profiles[ramp['id']]={'id':ramp['id'],'band':band,'kind':'ramp','points':path,
                                 'length':length(path),'maximumGrade':grade(path),'replacement':ident}
            deck_end=ramp['id']+'-deck-end'
            reference_nodes[deck_end]={'id':deck_end,'band':band,'position':end,'role':'ramp-deck-end'}
            reference_routes[ramp['id']]={'id':ramp['id'],'kind':'ramp','width':ramp['width'],
                                         'nodes':[fork,deck_end],'mainlineNode':on_mainline,'endpointOffsetToLane':connector}
    for (band,side),junctions in lanes.items():
        profile=profiles[f'band-{band}-expressway']['points'];heading=-side
        for end,label in [(profile[0],'south'),(profile[-1],'north')]:
            junctions.append(node(f'band-{band}-lane-{side}-{label}',band,highway_at(band,end[1],side),'motorway-terminal'))
        junctions.sort(key=lambda ident:graph_nodes[ident]['position'][1]*heading)
        for i,(start,end) in enumerate(zip(junctions,junctions[1:])):
            a,b=graph_nodes[start]['position'],graph_nodes[end]['position']
            middle=[[p[0]+side*6,p[1],p[2]] for p in profile if min(a[1],b[1])<p[1]<max(a[1],b[1])]
            middle.sort(key=lambda p:p[1]*heading)
            edge(f'band-{band}-lane-{side}-{i}',start,end,[a,*middle,b],'motorway')
    adjacency={ident:[] for ident in graph_nodes}
    for e in edges:
        adjacency[e['from']].append(e['to'])
        if e['bidirectional']:adjacency[e['to']].append(e['from'])
    reachability=[]
    for entry in [n for n in graph_nodes.values() if n['role']=='district-entry']:
        seen={entry['id']};pending=[entry['id']]
        while pending:
            for target in adjacency[pending.pop()]:
                if target not in seen:seen.add(target);pending.append(target)
        reached=sorted(n for n in seen if graph_nodes[n]['role']=='district-entry')
        assert len(reached)==6 and all(graph_nodes[n]['band']==entry['band'] for n in reached)
        reachability.append({'entry':entry['id'],'districts':reached})
    assert len(profiles)==162 and len(replaced)==18
    assert sum(e['kind']=='on-ramp' for e in edges)==36
    assert sum(e['kind']=='off-ramp' for e in edges)==36
    reference_nodes.update(graph_nodes)
    for route in reference_routes.values():
        for ident in route['nodes']:
            position=reference_nodes[ident]['position']
            assert any(math.dist(p,position)<1e-5 for p in profiles[route['id']]['points']),(route['id'],ident)
    return {'coordinates':'unwrapped surface metres: arc x, axial y, inward height',
            'profiles':list(profiles.values()),'referenceRoutes':list(reference_routes.values()),
            'referenceNodes':list(reference_nodes.values()),'replacements':replaced,
            'laneGraph':{'nodes':list(graph_nodes.values()),'edges':edges,'reachableDistricts':reachability},
            'reservedRoutes':[r for r in master['routes'] if r['id'] not in profiles],
            'status':'Directed IC/mainline topology resolved; drawn/physical paths and traffic integration pending. JCT/interband branches remain reservations.'}


if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--candidate-root',type=Path,required=True)
    parser.add_argument('--source-root',type=Path,required=True);parser.add_argument('--output',type=Path,required=True)
    args=parser.parse_args()
    assert all(p.is_absolute() for p in [args.candidate_root,args.source_root,args.output]) and not args.output.exists()
    plan_path=args.candidate_root/'assets/blender/izma-motorway-plan.json'
    transport_path=ASSETS/'izma-transport.json';master_path=ASSETS/'izma-colony-plan.json'
    source=read_manifest(args.source_root/'src/worlds/generated/izmaColony.json')
    river=source.get('motorway',{}).get('riverConnection')
    if river:
        study=ASSETS.parents[1]/'src/worlds/generated/worldLandscapes.json'
        assert hashlib.sha256(study.read_bytes()).hexdigest()==river['studySha256']
    result=resolve(json.loads(plan_path.read_text()),json.loads(transport_path.read_text()),json.loads(master_path.read_text()),river)
    if river:result['riverConnection']=river
    result.update({'origin':'ai','created':'2026-09-20','sourceSha256':json.loads((args.source_root/'src/worlds/generated/izmaColony.json').read_text())['sourceSha256'],
                   'dependencies':{p.name:hashlib.sha256(p.read_bytes()).hexdigest() for p in [plan_path,transport_path,master_path]}})
    args.output.write_text(json.dumps(result,separators=(',',':'))+'\n')
    print(json.dumps({'profiles':len(result['profiles']),'nodes':len(result['laneGraph']['nodes']),
                      'edges':len(result['laneGraph']['edges']),'reachableDistrictsPerBand':6,'status':result['status']}))
