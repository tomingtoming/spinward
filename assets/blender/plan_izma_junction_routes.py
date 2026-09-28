"""Join all 18 district entries through the candidate's directed JCT roads.

Explicitly candidate-only: route connectivity is not installation, traffic
simulation, or proof that the retained barriers have already been removed.
"""
import argparse
from collections import defaultdict
import hashlib
import json
import math
from pathlib import Path
from plan_izma_junctions import at_axis
from plan_izma_motorway_routes import grade,length

ASSETS=Path(__file__).resolve().parent


def combine_profiles(candidate,source_sha):
    """Compile retained IC profiles and the native JCT design for one export."""
    plan=json.loads((candidate/'assets/blender/izma-junction-plan.json').read_text())
    old=json.loads((ASSETS/'izma-motorway-routes.json').read_text())
    graph=json.loads((candidate/'junction-routes.json').read_text())
    assert old['sourceSha256']==plan['sourceSha256']==graph['sourceSha256']
    profiles={p['id']:dict(p) for p in old['profiles']}
    references={r['id']:dict(r) for r in old['referenceRoutes']}
    nodes={n['id']:dict(n) for n in old['referenceNodes']}
    # Preserve each general transfer endpoint as its own level-specific node;
    # moving a JCT must not teleport the unchanged general-road endpoint.
    for site in plan['sites']:
        old_node=nodes[site['id']];legacy=site['id']+'-former-general-end'
        nodes[legacy]={**old_node,'id':legacy,'role':'general-road-legacy-contact' if site['index']==1 else 'general-road-terminus'}
        general=f"band-{site['band']}-transfer-access-{site['index']}"
        references[general]['nodes']=[legacy if n==site['id'] else n for n in references[general]['nodes']]
    for band in range(3):
        ident=f'band-{band}-expressway';old_points=profiles[ident]['points']
        sites=sorted((s for s in plan['sites'] if s['band']==band),key=lambda s:s['y'])
        low=next(r['from'] for r in plan['terminalRetirements'] if r['band']==band and r['from']<0)
        high=next(r['from'] for r in plan['terminalRetirements'] if r['band']==band and r['from']>0)
        coordinates=sorted({low,high,*[p[1] for p in old_points if low<p[1]<high],*[s['y'] for s in sites]})
        points=[at_axis(old_points,y,1) for y in coordinates]
        profiles[ident]={**profiles[ident],'points':points,'length':length(points),'maximumGrade':grade(points)}
        for site in sites:
            nodes[site['id']]={**nodes[site['id']],'position':at_axis(old_points,site['y'],1),'role':'motorway-overpass'}
        references[ident]['nodes'].sort(key=lambda n:nodes[n]['position'][1])
    graph_nodes={n['id']:n for n in graph['laneGraph']['nodes']}
    nodes.update(graph_nodes)
    for ring in plan['rings']:
        points=ring['points'];sites=[s for s in plan['sites'] if s['index']==ring['index']]
        xs=sorted({*[p[0] for p in points],*[s['x'] for s in sites]})
        points=[at_axis(points,x,0) for x in xs]
        ident=ring['id'];ring_refs=[]
        for site in sites:
            key=site['id']+'-ring';ring_refs.append(key)
            nodes[key]={'id':key,'band':site['band'],'position':at_axis(points,site['x'],0),'role':'ring-overpass'}
        profiles[ident]={'id':ident,'kind':'expressway','band':0,'points':points,'length':length(points),
                         'maximumGrade':grade(points),'closed':True,'interband':True}
        references[ident]={'id':ident,'kind':'expressway','width':24.,'nodes':ring_refs,'closed':True}
    for site in plan['sites']:
        for ramp in site['movements']:
            ident=ramp['id'];points=ramp['points']
            profiles[ident]={'id':ident,'kind':'ramp','band':site['band'],'points':points,'length':length(points),
                             'maximumGrade':grade(points),'replacement':site['id']}
            references[ident]={'id':ident,'kind':'ramp','width':7.,'nodes':[ident+'-start',ident+'-end']}
    for route in references.values():
        for n in route['nodes']:
            assert any(math.dist(p,nodes[n]['position'])<.002 for p in profiles[route['id']]['points']),(route['id'],n)
    assert len(profiles)==213
    return {**old,'sourceSha256':source_sha,'sourceBeforeJunctions':old['sourceSha256'],
            'profiles':list(profiles.values()),'referenceRoutes':list(references.values()),
            'referenceNodes':list(nodes.values()),'laneGraph':graph['laneGraph'],
            'junctionPlanSha256':graph['planSha256'],'junctionNativeSha256':graph['nativeSha256'],
            'retiredTerminalNodes':graph['retiredTerminalNodes'],
            'remainingLegacyTransferContacts':[s['id']+'-former-general-end' for s in plan['sites'] if s['index']==1],
            'status':'JCT source candidate with all18 district entries connected. Traffic integration and legacy central general-road contacts remain.'}


def resolve(candidate):
    path=candidate/'assets/blender/izma-junction-plan.json';plan=json.loads(path.read_text())
    old_path=ASSETS/'izma-motorway-routes.json';old=json.loads(old_path.read_text())
    assert old['sourceSha256']==plan['sourceSha256']
    assert hashlib.sha256(old_path.read_bytes()).hexdigest()==plan['dependencies'][old_path.name]
    output=candidate/'junction-routes.json';assert not output.exists()
    profiles={p['id']:p for p in old['profiles']};circumference=math.tau*plan['radius']
    nodes={n['id']:dict(n) for n in old['laneGraph']['nodes']}
    retired_nodes=[]
    for ident,n in list(nodes.items()):
        if n['role']=='motorway-terminal':
            retired_nodes.append(ident);del nodes[ident]
    old_main=[e for e in old['laneGraph']['edges'] if e['kind']=='motorway']
    edges=[e for e in old['laneGraph']['edges'] if e['kind']!='motorway']
    main_nodes=defaultdict(set);ring_nodes=defaultdict(list)
    for edge in old_main:
        for ident in [edge['from'],edge['to']]:
            if ident in retired_nodes:continue
            n=nodes[ident];x=profiles[f"band-{n['band']}-expressway"]['points'][0][0]
            side=1 if n['position'][0]>x else -1
            main_nodes[(n['band'],-side)].add(ident)
            if n['role']=='motorway-terminal':n['role']='motorway-through'

    def add_edge(ident,start,end,points,kind,wrap=0):
        assert math.dist(points[0],nodes[start]['position'])<.002,ident
        end_position=[nodes[end]['position'][0]+wrap*circumference,*nodes[end]['position'][1:]]
        assert math.dist(points[-1],end_position)<.002,(ident,points[-1],end_position)
        assert grade(points)<=.060001,(ident,grade(points))
        edges.append({'id':ident,'from':start,'to':end,'points':points,'kind':kind,
                      'bidirectional':False,'wrapTurns':wrap,'length':length(points),'maximumGrade':grade(points)})

    for site in plan['sites']:
        for movement in site['movements']:
            ends=[]
            for label,p,heading in [('start',movement['points'][0],movement['startHeading']),
                                    ('end',movement['points'][-1],movement['endHeading'])]:
                ident=movement['id']+'-'+label
                nodes[ident]={'id':ident,'band':site['band'],'position':p,'role':'junction-exit' if label=='start' else 'junction-merge'}
                if heading[1]:
                    assert abs(p[0]-site['x']+heading[1]*6)<1e-6,'Opposing mainline carriageway'
                    main_nodes[(site['band'],heading[1])].add(ident)
                else:
                    assert abs(p[1]-site['y']-heading[0]*6)<1e-6,'Opposing ring carriageway'
                    ring_nodes[(site['index'],heading[0])].append(ident)
                ends.append(ident)
            add_edge(movement['id'],*ends,movement['points'],'junction-'+movement['turn'])

    for (band,heading),ids in main_nodes.items():
        points=profiles[f'band-{band}-expressway']['points'];x=points[0][0]-heading*6
        ordered=sorted(ids,key=lambda n:nodes[n]['position'][1]*heading)
        for index,(start,end) in enumerate(zip(ordered,ordered[1:])):
            a,b=nodes[start]['position'],nodes[end]['position']
            middle=[[x,p[1],p[2]] for p in points if min(a[1],b[1])<p[1]<max(a[1],b[1])]
            middle.sort(key=lambda p:p[1]*heading)
            add_edge(f'connected-band-{band}-lane-{heading}-{index}',start,end,[a,*middle,b],'motorway')

    for (index,heading),ids in ring_nodes.items():
        centre=plan['rings'][index]['points'];offset=[]
        for i,p in enumerate(centre[:-1]):
            a=centre[i-1] if i else [centre[-2][0]-circumference,*centre[-2][1:]]
            b=centre[i+1];dx,dy=b[0]-a[0],b[1]-a[1];d=math.hypot(dx,dy)
            offset.append([p[0]-dy/d*heading*6,p[1]+dx/d*heading*6,p[2]])
        ordered=sorted(ids,key=lambda n:nodes[n]['position'][0]*heading)
        for segment,(start,end) in enumerate(zip(ordered,ordered[1:]+ordered[:1])):
            a=nodes[start]['position'];b=list(nodes[end]['position']);wrap=0
            if (b[0]-a[0])*heading<0:wrap=heading;b[0]+=heading*circumference
            middle=[]
            for shift in [-1,0,1]:
                middle.extend([[p[0]+shift*circumference,p[1],p[2]] for p in offset
                               if min(a[0],b[0])<p[0]+shift*circumference<max(a[0],b[0])])
            middle.sort(key=lambda p:p[0]*heading)
            add_edge(f'motorway-ring-{index}-lane-{heading}-{segment}',start,end,[a,*middle,b],'ring-motorway',wrap)

    adjacency={n:[] for n in nodes};incoming={n:[] for n in nodes}
    for e in edges:
        adjacency[e['from']].append(e['to']);incoming[e['to']].append(e['from'])
        if e['bidirectional']:adjacency[e['to']].append(e['from']);incoming[e['from']].append(e['to'])
    assert all(adjacency[n] and incoming[n] for n in nodes),'An unconnected terminal remains'
    entries={n for n in nodes if nodes[n]['role']=='district-entry'};assert len(entries)==18
    reachable=[]
    for entry in entries:
        seen={entry};pending=[entry]
        while pending:
            for n in adjacency[pending.pop()]:
                if n not in seen:seen.add(n);pending.append(n)
        assert entries<=seen,(entry,entries-seen)
        reachable.append({'entry':entry,'districts':sorted(entries&seen)})
    result={'origin':'ai','created':'2026-09-21','sourceSha256':plan['sourceSha256'],
            'planSha256':hashlib.sha256(path.read_bytes()).hexdigest(),
            'nativeSha256':json.loads(path.with_name('izma-junctions.json').read_text())['nativeSha256'],
            'laneGraph':{'nodes':list(nodes.values()),'edges':edges,'reachableDistricts':sorted(reachable,key=lambda r:r['entry'])},
            'retiredTerminalNodes':retired_nodes,
            'status':'All 18 district entries connected in candidate topology; native-source retirement, traffic and runtime integration remain.'}
    output.write_text(json.dumps(result,separators=(',',':'))+'\n')
    return {'nodes':len(nodes),'edges':len(edges),'reachableFromEveryDistrict':18,
            'junctionMovements':sum(e['kind'].startswith('junction-') for e in edges),
            'wrapEdges':sum(bool(e.get('wrapTurns')) for e in edges)}


if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--candidate-root',type=Path,required=True)
    print(json.dumps(resolve(p.parse_args().candidate_root),indent=2))
