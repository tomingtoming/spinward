"""Reusable district LOD for low buildings omitted by the old skyline.

Only the distant silhouette is approximated by an oriented source-footprint
rectangle. Native heights, ownership, near geometry and collision are unchanged.
Nine floats per building replace per-building meshes/materials. Outputs live in
a separate versioned directory; existing catalogs are never overwritten.
"""
import argparse
import collections
import hashlib
import json
import math
import sqlite3
from pathlib import Path

import numpy as np

from metro_geometry import save_tile
from prepare_metro_overview import source_buildings
from plan_tokyo_metro import write


def main():
    parser=argparse.ArgumentParser()
    parser.add_argument('--root',type=Path,required=True)
    parser.add_argument('--output',type=Path,required=True)
    args=parser.parse_args();root=args.root.resolve();output=args.output.resolve()
    derived=root/'derived'
    if not output.is_relative_to(derived):raise ValueError('Output must be inside the explicitly selected derived directory')
    plan=json.loads((root/'tokyo-metro-plan.json').read_text())
    db=sqlite3.connect(f'file:{root}/metro-source.sqlite?mode=ro',uri=True)
    bands={};total=0
    for band in plan['bands']:
        entries=[]
        for segment in range(10):
            checkpoint=output/band['id']/f'segment-{segment}.json'
            if checkpoint.exists():
                rows=json.loads(checkpoint.read_text());entries.extend(rows);total+=sum(r['instances'] for r in rows);continue
            y=-20000+segment*4000;bounds=[band['bounds'][0],y,band['bounds'][2],y+4000]
            chunks=collections.defaultdict(list)
            for building in source_buildings(db,band,bounds):
                xcell,ycell=map(int,building['owner'].split('-'))
                if not segment*20<=ycell<(segment+1)*20:continue
                height=building['top']-building['base']
                if height<.3 or height>=18:continue
                rectangle=building['shape'].minimum_rotated_rectangle
                if rectangle.geom_type!='Polygon':continue
                p=np.asarray(rectangle.exterior.coords)[:4];centre=p.mean(axis=0)
                edge=p[1]-p[0];width=np.linalg.norm(edge);depth=np.linalg.norm(p[2]-p[1])
                if not np.isfinite(p).all() or not math.isfinite(width+depth+height+building['base']) or min(width,depth)<.15:continue
                chunks[(xcell//4,ycell//4)].append([*centre,building['base'],width,depth,height,math.atan2(edge[1],edge[0]),building['seed']%5,ycell*17+xcell])
            rows=[]
            for (xcell,ycell),values in sorted(chunks.items()):
                data=np.asarray(values,dtype='<f4');identity=f'{xcell}-{ycell}'
                # Include the entire oriented box, including source compounds
                # extending across their ownership tile.
                extent=np.hypot(data[:,3],data[:,4])/2
                b=[float((data[:,0]-extent).min()),float((data[:,1]-extent).min()),float((data[:,0]+extent).max()),float((data[:,1]+extent).max())]
                name=f'{band["id"]}/{identity}.bin.gz'
                tile=save_tile(output,name,[dict(name='lowrise',attributes=dict(instances=data))])
                rows.append({**tile,'path':str((output/name).relative_to(derived)),'id':identity,'instances':len(data),'bounds':b,
                    'heightRange':[float(data[:,2].min()),float((data[:,2]+data[:,5]).max())]})
            write(checkpoint,rows);entries.extend(rows);total+=sum(r['instances'] for r in rows)
            print(band['id'],segment,'instances',sum(r['instances'] for r in rows),flush=True)
        bands[band['id']]=entries
    result=dict(version=1,ready=True,frames=[[b['id'],b['band'],b['frame']] for b in plan['bands']],bands=bands,
        instances=total,approximation=dict(heightBelowM=18,footprint='minimum rotated rectangle',chunkCells=[4,4],renderOnly=True),
        sourcePlanSha256=hashlib.sha256((root/'tokyo-metro-plan.json').read_bytes()).hexdigest())
    write(output/'manifest.json',result);db.close()
    print('ready',total,'instances',sum(t['bytes'] for rows in bands.values() for t in rows),'wire bytes',flush=True)


if __name__=='__main__':main()
