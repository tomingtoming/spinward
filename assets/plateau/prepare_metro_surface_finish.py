"""Streamable vector surfaces for every source tile, leaving the baseline intact."""
import argparse
import collections
import hashlib
import json
import sqlite3
from pathlib import Path

from shapely import STRtree, union_all
from shapely.geometry import box

from audit_metro_coverage import dictionaries
from metro_geometry import Grid, merge, save_tile
from metro_surface_details import SurfaceDraper
from plan_tokyo_metro import write
from prepare_metro_overview import GROUND, source_ground, tile_specs


def tile_surfaces(entries, tree, tile):
    crop = box(*tile['bounds'])
    groups = collections.defaultdict(list)
    for index in tree.query(crop, predicate='intersects'):
        stage, _, shape, label = entries[index]
        groups[stage, label].append(shape.intersection(crop))
    # Resolve the same hierarchy as the source painter: roads > water > land.
    # Same-class pieces are merged so coincident source surfaces cannot flicker.
    covered = box(0, 0, 0, 0)
    result = []
    for (stage, label), shapes in sorted(groups.items(), reverse=True):
        shape = union_all(shapes).difference(covered)
        if shape.area < 1e-6:
            continue
        result.append((label, shape))
        covered = union_all([covered, shape])
    return result


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--root', type=Path, required=True)
    parser.add_argument('--band')
    parser.add_argument('--limit', type=int)
    parser.add_argument('--segment', type=int)
    args = parser.parse_args()
    root = args.root.resolve(); output = root/'derived'/'finish-v1'; output.mkdir(exist_ok=True)
    plan = json.loads((root/'tokyo-metro-plan.json').read_text())
    contract = dict(version=1,sourceContract=json.loads((root/'derived/metro-contract.json').read_text()),
                    terrainStepM=5,surfaceLiftM=.016,source='PLATEAU land-use, roads and water polygons')
    path = output/'surface-contract.json'
    if path.exists():
        assert json.loads(path.read_text()) == contract, 'Use a fresh finish version for another geometry contract'
    else:
        write(path,contract)
    db = sqlite3.connect(f'file:{root}/metro-surfaces.sqlite?mode=ro&immutable=1',uri=True)
    codes = dictionaries(root); total = 0; reports = []
    for band in plan['bands']:
        if args.band and args.band != band['id']:
            continue
        grid = Grid(root,band['id']); rows = []
        for segment in range(10):
            specs = [t for t in tile_specs(band) if -20000+segment*4000 <= t['bounds'][1] < -16000+segment*4000]
            missing = [t for t in specs if not (output/band['id']/(t['id']+'.json')).exists()]
            entries = None
            if missing and (args.segment is None or args.segment == segment) and (args.limit is None or total < args.limit):
                bounds = [band['bounds'][0],-20000+segment*4000,band['bounds'][2],-16000+segment*4000]
                entries = source_ground(db,codes,band,bounds)
                tree = STRtree([e[2] for e in entries])
            for tile in specs:
                checkpoint = output/band['id']/(tile['id']+'.json')
                if checkpoint.exists():
                    row = json.loads(checkpoint.read_text())
                else:
                    if entries is None or (args.limit is not None and total >= args.limit):
                        continue
                    draper = SurfaceDraper(grid,tile['bounds'])
                    surfaces = tile_surfaces(entries,tree,tile)
                    parts = [draper.paint(shape,GROUND[label]) for label,shape in surfaces]
                    merged = merge([p for p in parts if p is not None]); meshes = []
                    if merged:
                        meshes.append(dict(name='source-surface-detail',colour='#ffffff',roughness=1,attributes=merged))
                    name = f'finish-v1/{band["id"]}/{tile["id"]}.bin.gz'
                    descriptor = save_tile(root/'derived',name,meshes)
                    row = dict(id=tile['id'],bounds=tile['bounds'],**descriptor,
                               triangles=0 if not merged else len(merged['index'])//3,
                               areaM2=sum(s.area for _,s in surfaces))
                    write(checkpoint,row);total += 1
                    if total % 50 == 0:print(band['id'],'generated',total,'segment',segment,flush=True)
                rows.append(row)
            write(output/(band['id']+'-surfaces.json'),dict(id=band['id'],ready=len(rows)==3400,tiles=rows))
        report = dict(id=band['id'],tiles=len(rows),triangles=sum(r['triangles'] for r in rows),
                      decodedBytes=sum(r['decodedBytes'] for r in rows),storedBytes=sum(r['bytes'] for r in rows))
        reports.append(report);print(json.dumps(report),flush=True)
    db.close()
    write(output/('surface-audit'+('-'+args.band if args.band else '')+'.json'),dict(ready=len(reports)==3 and all(r['tiles']==3400 for r in reports),bands=reports))


if __name__ == '__main__':
    main()
