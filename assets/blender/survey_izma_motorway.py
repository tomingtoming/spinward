# /// script
# requires-python = ">=3.10"
# dependencies = ["shapely==2.1.2"]
# ///
"""Compare ramp footprints with the current occupied colony before authoring ICs.

This is a horizontal land-use survey, not a collision or clearance certificate.
The original motorway and access profiles remain fixed inputs. No application
or existing Blender asset is modified.
"""
import argparse
import hashlib
import json
import math
from pathlib import Path
from shapely import LineString, Polygon
from shapely.ops import unary_union
from shapely.strtree import STRtree
from colony_manifest_io import read_manifest
from plan_izma_urban import rectangle

ROOT = Path(__file__).resolve().parents[2]
ASSETS = ROOT / 'assets/blender'


def bezier(points, steps=24):
    result = []
    for i in range(steps+1):
        t = i/steps; s = 1-t
        weights = [s**3, 3*s*s*t, 3*s*t*t, t**3]
        result.append([sum(w*p[k] for w,p in zip(weights, points)) for k in range(2)])
    return result


def survey(output):
    if not output.is_absolute() or output.resolve() == ROOT:
        raise ValueError('Use an isolated absolute output directory')
    if output.exists():
        raise ValueError('Preserve existing survey output; use a fresh directory')
    header_path = ROOT / 'src/worlds/generated/izmaColony.json'
    header = json.loads(header_path.read_text()); source = read_manifest(header_path)
    master = json.loads((ASSETS / 'izma-colony-plan.json').read_text())
    transport = json.loads((ASSETS / 'izma-transport.json').read_text())
    spacing = math.tau*master['radius']/3
    occupied, shapes = [], []

    def add(ident, kind, polygon, height=None):
        if polygon.is_empty or not polygon.is_valid:
            raise ValueError(('Invalid protected footprint', ident))
        occupied.append({'id':ident, 'kind':kind, 'bounds':list(polygon.bounds), 'height':height})
        shapes.append(polygon)

    for layer in ['architecture', 'neighbourhoods']:
        for p in source[layer]['parcels']:
            add(p['id'], 'building', Polygon(rectangle(*p['position'],p['yaw'],*p['size'][:2])),
                [p['floor'],p['floor']+p['size'][2]])
            access = p.get('access')
            if access and math.dist(access['start'][:2],access['end'][:2])>.01:
                add(p['id']+'-entry','entrance',LineString([access['start'][:2],access['end'][:2]]).buffer(access['width']/2+.3))
    for p in source['cornerBlocks']['parcels']:
        add(p['id'],'building',Polygon(p['outline']),[p['floor'],p['floor']+p['height']])
    for p in json.loads((ASSETS/'izma-block-parcels.json').read_text())['blocks']:
        add(p['id'],'inhabited-block',Polygon(p['boundary']))
    public_places = json.loads((ASSETS/'izma-public-spaces.json').read_text())['places']
    assert {p['id'] for p in public_places} == {p['id'] for p in source['publicRealm']['places']}
    for p in public_places:
        add(p['id']+'-public','public-space',Polygon(rectangle(*p['position'],p['yaw'],*p['size'])))
    tree = STRtree(shapes)
    nodes = {n['id']:n for n in master['nodes']}
    profiles = {p['id']:p for p in transport['profiles']}
    interchanges = []
    for district in master['districts']:
        ident=district['id']; node=nodes[ident+'-ic']; band=node['band']
        nx,ny=node['xy']; shift=band*spacing; outward=1 if nx>0 else -1
        highway=profiles[f'band-{band}-expressway']; access=profiles[ident+'-access']
        endpoint=min(access['points'],key=lambda p:math.dist(p[:2],node['xy']))
        assert math.dist(endpoint[:2],node['xy'])<.001
        approach=[p for p in access['points'] if math.dist(p[:2],node['xy'])<=460]
        assert len(approach)>3
        slope=(endpoint[1]-approach[0][1])/(outward*(endpoint[0]-approach[0][0]))
        # Follow the occupied road reservation; the final alignment to an
        # underpass remains a vertical-design decision after the footprint audit.
        common=[[p[0]+shift,p[1]] for p in approach]
        common.extend([[nx+shift+outward*u,ny+slope*u] for u in [40,110]])
        alternatives=[]
        for offset in [32,56,80]:
            for span in [500,650]:
                paths=[]
                for side in [-1,1]:
                    for direction in [-1,1]:
                        local=bezier([[side*offset,side*offset*slope],[side*(offset+20),side*(offset+20)*slope],
                            [side*(offset+20),direction*(span-200)],[side*20,direction*(span-120)]])
                        local+=bezier([[side*20,direction*(span-120)],[side*12,direction*(span-80)],
                            [side*8,direction*(span-40)],[side*8,direction*span]],12)[1:]
                        path=[[nx+shift+outward*u,ny+v] for u,v in local]
                        from shapely import Point
                        assert LineString(common).distance(Point(path[0]))<.001, ('Disconnected ramp branch',ident,side,direction)
                        paths.append({'id':f'{side}:{direction}','side':side,'direction':direction,'width':7,'points':path})
                footprint=unary_union([LineString(common).buffer(10),
                    *(LineString(p['points']).buffer(4.5) for p in paths)])
                overlaps=[]
                for i in tree.query(footprint,predicate='intersects'):
                    area=footprint.intersection(shapes[i]).area
                    if area>.05:overlaps.append({**occupied[i],'projectedOverlapArea':area})
                area_by_kind={k:sum(o['projectedOverlapArea'] for o in overlaps if o['kind']==k)
                              for k in sorted({o['kind'] for o in overlaps})}
                alternatives.append({'offset':offset,'span':span,'commonRoad':common,'ramps':paths,
                    'footprintArea':footprint.area,'overlaps':overlaps,'areaByKind':area_by_kind})
        alternatives.sort(key=lambda a:(sum(a['areaByKind'].get(k,0) for k in ['building','inhabited-block','public-space']),
                                         a['areaByKind'].get('entrance',0),a['span'],a['offset']))
        at=min(highway['points'],key=lambda p:math.dist(p[:2],node['xy']))
        assert math.dist(at[:2],node['xy'])<.001
        interchanges.append({'id':ident+'-ic','band':band,'node':[nx+shift,ny],
            'motorwayHeight':at[2],'terrainAtNode':at[3],'existingAccessHeight':endpoint[2],
            'existingAtGrade':abs(at[2]-endpoint[2])<.001,'alternatives':alternatives,
            'preferredFootprint':{'offset':alternatives[0]['offset'],'span':alternatives[0]['span'],
                'areaByKind':alternatives[0]['areaByKind'],'overlapIds':[o['id'] for o in alternatives[0]['overlaps']]}})
    assert len(interchanges)==18
    output.mkdir(parents=True)
    report={'origin':'ai','created':'2026-09-20','version':1,'sourceSha256':header['sourceSha256'],
        'dependencies':{name:hashlib.sha256((ASSETS/name).read_bytes()).hexdigest()
                        for name in ['izma-colony-plan.json','izma-transport.json','izma-block-parcels.json','izma-public-spaces.json']},
        'scope':'18 district IC footprints against current buildings, entrances and public spaces. Projection overlap is not proof of 3D collision; grades, water, foundations, other roads and support clearance still need native design.',
        'status':'Survey only; existing T junctions are not replaced and no candidate is installed.',
        'protectedFootprints':len(occupied),'interchanges':interchanges,
        'remainingJunctions':[n for n in master['nodes'] if '-jct-' in n['id']]}
    (output/'motorway-survey.json').write_text(json.dumps(report,indent=2)+'\n')
    print(json.dumps({'source':header['sourceSha256'],'interchanges':len(interchanges),
        'protected':len(occupied),'choices':[{k:i[k] for k in ['id','motorwayHeight','terrainAtNode','preferredFootprint']} for i in interchanges]}),flush=True)


if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--output',type=Path,required=True)
    survey(parser.parse_args().output)
