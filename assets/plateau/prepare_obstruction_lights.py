"""Spinward roof beacons, supported by actual PLATEAU triangles.

The 60 m design threshold is not a surveyed equipment inventory or a claim of
aviation-law compliance. A bounds-box centre is never used as a roof support.
"""
import argparse, json, sqlite3, zlib
from pathlib import Path
import numpy as np
from shapely import union_all
from shapely.geometry import Polygon, Point, box
from shapely.ops import nearest_points
from audit_metro_coverage import projected_cell, query
from metro_geometry import Frame, polygons
from plan_tokyo_metro import write


def roof_anchors(positions,indices):
    faces=positions[np.asarray(indices).reshape(-1,3)]
    top=float(positions[:,2].max())
    # Restrict to the real upper roof. Lower podiums must not inherit tower Z.
    flat=faces[np.all(np.abs(faces[:,:,2]-top)<.08,axis=1)]
    roofs=[(Polygon(f[:,:2]),f) for f in flat if Polygon(f[:,:2]).area>.01]
    if not roofs:return []
    shape=union_all([p for p,_ in roofs]).buffer(-.45)
    anchors=[]
    for poly in sorted(polygons(shape),key=lambda p:-p.area):
        if poly.area<1:continue
        corners=list(poly.minimum_rotated_rectangle.exterior.coords)[:-1]
        candidates=[nearest_points(poly,Point(*c))[0] for c in corners] if poly.area>=100 else [poly.representative_point()]
        for p in candidates:
            if any(p.distance(Point(*a['point'][:2]))<8 for a in anchors):continue
            support=[]
            for roof,triangle in roofs:
                if not roof.buffer(1e-7).covers(p):continue
                matrix=np.vstack([triangle[:,:2].T,np.ones(3)])
                weights=np.linalg.solve(matrix,np.array([p.x,p.y,1.]))
                z=float(weights@triangle[:,2]);support.append((z,triangle))
            if not support:continue
            z,triangle=max(support,key=lambda s:s[0])
            anchors.append(dict(point=[p.x,p.y,z],triangle=triangle.tolist()))
            if len(anchors)>=4:return anchors
    return anchors


def main():
    parser=argparse.ArgumentParser();parser.add_argument('--root',type=Path,required=True);parser.add_argument('--name',default='obstruction-v1')
    args=parser.parse_args();root=args.root.resolve();out=root/'derived'/args.name
    if out.exists():raise RuntimeError('Use a new immutable output name')
    out.mkdir()
    plan=json.loads((root/'tokyo-metro-plan.json').read_text());db=sqlite3.connect(f'file:{root}/metro-source.sqlite?mode=ro&immutable=1',uri=True)
    bands={};reports={};audit=[]
    for band in plan['bands']:
        frame=Frame(band);clip=box(*band['bounds']);points=[];count=0;omitted=[]
        rows=query(db,'buildings',projected_cell(band,band['bounds']),
            's.source_id,s.bounds,s.geometry,s.vertex_count,s.index_count',
            "AND json_extract(s.bounds,'$[5]')-json_extract(s.bounds,'$[4]')>=60")
        for identity,bounds,geometry,vertices,indices in rows:
            raw=zlib.decompress(geometry);p=frame.points(np.frombuffer(raw,dtype='<f4',count=vertices*3).reshape(-1,3))
            idx=np.frombuffer(raw,dtype='<u4',count=indices,offset=vertices*12)
            # The source geometry can cross the rectangular query envelope.
            if not Polygon(p[:,:2]).convex_hull.intersects(clip):continue
            anchors=[a for a in roof_anchors(p,idx) if clip.covers(Point(*a['point'][:2]))]
            count+=1
            if not anchors:omitted.append(identity)
            for a in anchors:
                points.append(a['point']);audit.append(dict(band=band['id'],building=identity,**a))
        bands[band['id']]=points;reports[band['id']]=dict(buildings=count,lights=len(points),withoutSupportedRoof=omitted)
        print(band['id'],reports[band['id']],flush=True)
    write(out/'manifest.json',dict(version=1,ready=True,frames=[[b['id'],b['band'],b['frame']] for b in plan['bands']],
        thresholdM=60,supportHeightM=.60,bands=bands,report=reports,design='Steady red roof markers, not surveyed aviation equipment'))
    write(out/'roof-support-audit.json',audit)

if __name__=='__main__':main()
