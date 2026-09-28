"""Measure old T-junction retirement against the current full-colony source."""
import argparse
from collections import defaultdict
import hashlib
import json
import math
from pathlib import Path
import sys

ASSETS = Path(__file__).resolve().parent
ROOT = ASSETS.parents[1]
sys.path.insert(0, str(ASSETS))
from colony_manifest_io import read_manifest
from izma_motorway_replacement import FootprintCuts, face_area, retirement_cutters, split_footprint


def inventory(candidate):
    if not candidate.is_absolute() or candidate.resolve() == ROOT:
        raise ValueError('Use an isolated absolute candidate directory')
    plan_path = candidate/'assets/blender/izma-motorway-plan.json'
    plan = json.loads(plan_path.read_text())
    header = ROOT/'src/worlds/generated/izmaColony.json'
    assert json.loads(header.read_text())['sourceSha256'] == plan['sourceSha256']
    source = read_manifest(header)
    master = json.loads((ASSETS/'izma-colony-plan.json').read_text())
    assert hashlib.sha256((ASSETS/'izma-colony-plan.json').read_bytes()).hexdigest() == plan['dependencies']['izma-colony-plan.json']
    entries = []
    for ic in plan['interchanges']:
        incident = [r for r in master['routes'] if ic['id'] in r['nodes']]
        assert incident, ic['id']
        radius = max(r['width'] for r in incident)/2 + 3 - 2.75
        entries.extend((ic['id'], p) for p in retirement_cutters(ic, radius))
    cuts = FootprintCuts(entries)
    base = source['base']
    vertices = [tuple(base['vertices'][i:i+3]) for i in range(0, len(base['vertices']), 3)]
    by_owner = defaultdict(lambda: defaultdict(lambda: {'faces':0, 'area':0., 'partial':0}))
    conservation = 0.

    def inspect(indices, label):
        nonlocal conservation
        for offset in range(0, len(indices), 3):
            points = [vertices[i] for i in indices[offset:offset+3]]
            outside, inside = cuts.split(points)
            if not inside:
                continue
            total = face_area(points)
            remaining = sum(face_area(p) for p in outside)
            removed = sum(face_area(p) for _, p in inside)
            conservation = max(conservation, abs(total-remaining-removed))
            for owner, piece in inside:
                record = by_owner[owner][label]
                record['faces'] += 1
                record['area'] += face_area(piece)
                record['partial'] += int(remaining > 1e-7)

    for material, indices in base['meshes'].items():
        inspect(indices, 'drawing:'+material)
    for surface in base['surfaces']:
        inspect(surface['indices'], 'collision:floor' if surface.get('groundSurface', True) else 'collision:body')
    boxes = []
    roads = {}
    road_entries = []
    for ic in plan['interchanges']:
        for road in ic['roads']:
            points = road['points']
            extent = road['width']/2 + road['footway']
            sides = []
            for i,p in enumerate(points):
                a,b = points[max(0,i-1)],points[min(len(points)-1,i+1)]
                dx,dy = b[0]-a[0],b[1]-a[1]
                length = math.hypot(dx,dy)
                sides.append([(p[0]-dy/length*s,p[1]+dx/length*s) for s in [-extent,extent]])
            for i,(a,b) in enumerate(zip(sides,sides[1:])):
                key = (road['id'],i)
                road_entries.append((key,[a[0],b[0],b[1],a[1]]))
                roads[key] = (ic['id'],road,points[i],points[i+1])
    road_cuts = FootprintCuts(road_entries)
    blocking_boxes = []
    for index, box in enumerate(source['structures']):
        x,y,z,w,d,h,yaw = box
        c,s = math.cos(yaw),math.sin(yaw)
        corners = [(x+dx*c-dy*s,y+dx*s+dy*c,z) for dx,dy in [(-w/2,-d/2),(w/2,-d/2),(w/2,d/2),(-w/2,d/2)]]
        outside, inside = cuts.split(corners)
        if inside:
            boxes.append({'index':index,'box':box,'owners':sorted({owner for owner,_ in inside}),
                          'retiredFootprintArea':sum(face_area(p) for _,p in inside),
                          'retainedFootprintArea':sum(face_area(p) for p in outside)})
        # Query each segment independently: two vertically separated routes
        # can overlap in plan and must not steal one another's test footprint.
        candidates = sorted({i for key in road_cuts.cells(corners) for i in road_cuts.grid.get(key,[])})
        blockers = {}
        for candidate_index in candidates:
            key, polygon = road_entries[candidate_index]
            _, overlap = split_footprint(corners,polygon)
            if not overlap:
                continue
            ic_id,road,a,b = roads[key]
            dx,dy = b[0]-a[0],b[1]-a[1]
            heights = []
            for point in overlap:
                t = max(0,min(1,((point[0]-a[0])*dx+(point[1]-a[1])*dy)/(dx*dx+dy*dy)))
                heights.append(a[2]+(b[2]-a[2])*t)
            # Floor/kerb tolerance is 15 cm, target travel clearance 4.6 m.
            if z+h > min(heights)+.15 and z < max(heights)+4.6:
                record = blockers.setdefault(road['id'],{'ic':ic_id,'road':road['id'],'overlapArea':0.,
                                                         'boxBottom':z,'boxTop':z+h,'roadHeights':[]})
                record['overlapArea'] += face_area(overlap)
                record['roadHeights'].extend(heights)
        for record in blockers.values():
            record['roadHeights'] = [min(record['roadHeights']),max(record['roadHeights'])]
            blocking_boxes.append({'index':index,'box':box,**record})
    report = {'origin':'ai','created':'2026-09-20','sourceSha256':plan['sourceSha256'],
              'planSha256':hashlib.sha256(plan_path.read_bytes()).hexdigest(),
              'scope':'Read-only finite-width retirement inventory. No native or runtime source changed; merge guard openings and replacement surfaces are separate.',
              'maximumAreaConservationError':conservation,
              'cutters':[{'ic':owner,'polygon':poly} for owner,poly in entries],
              'byInterchange':dict(by_owner),'structureBoxes':boxes,
              'existingBoxesBlockingNewRoads':blocking_boxes,
              'status':'Existing supports require relocation before integration' if blocking_boxes else 'Inventory complete; integration not yet audited'}
    target = candidate/'assets/blender/izma-motorway-retirement.json'
    target.write_text(json.dumps(report,indent=2)+'\n')
    print(json.dumps({'report':str(target),'interchanges':len(by_owner),
                      'maximumAreaConservationError':conservation,'structureBoxes':boxes,
                      'existingBoxesBlockingNewRoads':blocking_boxes,
                      'touchedMaterials':sorted({label for labels in by_owner.values() for label in labels})}),flush=True)
    assert conservation < 1e-4, 'Clipping changed face area beyond the retirement boundary'


if __name__ == '__main__':
    parser=argparse.ArgumentParser()
    parser.add_argument('--candidate-root',type=Path,required=True)
    inventory(parser.parse_args().candidate_root)
