# /// script
# requires-python = ">=3.10"
# dependencies = ["shapely==2.1.2"]
# ///
"""Select JCT corridors against occupied parcels and current IC footprints.

This is a reproducible horizontal survey, not a native-clearance certificate.
Existing source and all installed buildings remain untouched.
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
from izma_junction_alignments import movements, OUTER
from plan_izma_urban import rectangle

ASSETS = Path(__file__).resolve().parent
ROOT = ASSETS.parents[1]


def survey(output):
    assert output.is_absolute() and not output.exists()
    document = ROOT / 'src/worlds/generated/izmaColony.json'
    header = json.loads(document.read_text())
    source = read_manifest(document)
    master = json.loads((ASSETS / 'izma-colony-plan.json').read_text())
    motorway = json.loads((ASSETS / 'izma-motorway-plan.json').read_text())
    transport = json.loads((ASSETS / 'izma-motorway-routes.json').read_text())
    assert transport['sourceSha256'] == header['sourceSha256']
    radius = master['radius']; spacing = math.tau * radius / 3
    half_land = radius * master['landArcRadians'] / 2
    profiles = {p['id']: p for p in transport['profiles']}
    protected = []; shapes = []

    def add(ident, kind, shape):
        assert shape.is_valid and not shape.is_empty, ident
        protected.append({'id': ident, 'kind': kind}); shapes.append(shape)

    for layer in ['architecture', 'neighbourhoods']:
        for p in source[layer]['parcels']:
            add(p['id'], 'building', Polygon(rectangle(*p['position'], p['yaw'], *p['size'][:2])))
            access = p.get('access')
            if access and math.dist(access['start'][:2], access['end'][:2]) > .01:
                add(p['id'] + '-entry', 'entrance', LineString([access['start'][:2], access['end'][:2]]).buffer(access['width'] / 2 + .3))
    for p in source['cornerBlocks']['parcels']:
        add(p['id'], 'building', Polygon(p['outline']))
    for p in json.loads((ASSETS / 'izma-block-parcels.json').read_text())['blocks']:
        add(p['id'], 'inhabited-block', Polygon(p['boundary']))
    for p in json.loads((ASSETS / 'izma-public-spaces.json').read_text())['places']:
        add(p['id'], 'public-space', Polygon(rectangle(*p['position'], p['yaw'], *p['size'])))
    for ic in motorway['interchanges']:
        add(ic['id'], 'installed-IC', unary_union([LineString([p[:2] for p in r['points']]).buffer(r['width']/2 + r['footway'] + 2) for r in ic['roads']]))
    tree = STRtree(shapes)

    def overlaps(shape):
        return [{**protected[i], 'area': area} for i in tree.query(shape, predicate='intersects')
                if (area := shape.intersection(shapes[i]).area) > .05]

    sites = []; alternatives = []
    # The retained general transfer roads reach the old highway termini at
    # +/-19000. Terminate the motorway inside those roads instead of turning
    # an at-grade shared endpoint into a barrier across the general network.
    for index, fixed in [(0, -18500), (1, None), (2, 18500)]:
        for band in range(3):
            x = profiles[f'band-{band}-expressway']['points'][0][0]
            choices = []
            for y in ([fixed] if fixed is not None else [4300, *range(3500, 5801, 100), 6500]):
                if any(c['y'] == y for c in choices): continue
                ident = f'band-{band}-jct-{index}'
                ramps = movements(ident, x, y, 0 if index == 1 else (-1 if index == 0 else 1))
                footprint = unary_union([LineString(r['points']).buffer(5) for r in ramps])
                corridor = LineString([(band*spacing-half_land, y), (band*spacing+half_land, y)]).buffer(15)
                conflicts = overlaps(unary_union([footprint, corridor]))
                choices.append({'id': ident, 'band': band, 'index': index, 'x': x, 'y': y,
                                'conflicts': conflicts, 'overlapArea': sum(v['area'] for v in conflicts)})
            choices.sort(key=lambda c: (bool(c['conflicts']), c['overlapArea'], abs(c['y']-4300)))
            chosen = choices[0]
            sites.append({**chosen, 'movements': movements(chosen['id'], x, chosen['y'], 0 if index == 1 else (-1 if index == 0 else 1))})
            alternatives.append({'site': chosen['id'], 'candidates': choices})

    rings = []
    for index in range(3):
        group = [s for s in sites if s['index'] == index]
        controls = []
        # Align with each selected land corridor. Any difference between bands
        # bends gradually over the light strips, away from occupied city plots.
        for site in group:
            controls.extend([[min(site['band']*spacing-half_land,site['x']-OUTER-35), site['y']],
                             [max(site['band']*spacing+half_land,site['x']+OUTER+35), site['y']]])
        controls.append([controls[0][0]+3*spacing, controls[0][1]])
        points = []
        for a, b in zip(controls, controls[1:]):
            n = math.ceil(math.dist(a,b)/8)
            points.extend([[a[0]+(b[0]-a[0])*i/n, a[1]+(b[1]-a[1])*i/n] for i in range(n)])
        points.append(controls[-1])
        rings.append({'id': f'motorway-ring-{index}', 'index': index, 'width': 24., 'points': points,
                      'conflicts': overlaps(LineString(points).buffer(15))})
    result = {'origin': 'ai', 'created': '2026-09-21', 'sourceSha256': header['sourceSha256'],
              'radius': radius, 'span': master['span'], 'halfLand': half_land,
              'dependencies': {n: hashlib.sha256((ASSETS/n).read_bytes()).hexdigest() for n in
                               ['izma-colony-plan.json', 'izma-motorway-plan.json', 'izma-motorway-routes.json',
                                'izma-block-parcels.json', 'izma-public-spaces.json']},
              'scope': 'Projected occupation only; vertical profiles, actual mesh clearances, structural supports and runtime integration pending.',
              'sites': sites, 'rings': rings, 'alternatives': alternatives, 'protectedFootprints': len(shapes)}
    output.mkdir(parents=True)
    (output/'junction-survey.json').write_text(json.dumps(result,separators=(',',':'))+'\n')
    print(json.dumps({'sites': [{k:s[k] for k in ['id','x','y','overlapArea','conflicts']} for s in sites],
                      'ringConflicts': [{'id':r['id'],'conflicts':r['conflicts']} for r in rings]},indent=2))


if __name__ == '__main__':
    p = argparse.ArgumentParser(); p.add_argument('--output',type=Path,required=True)
    survey(p.parse_args().output)
