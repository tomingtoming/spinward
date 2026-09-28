"""Preserve source rail geometry and expose cuts before designing colony links.

N02 does not supply engineering profiles; no elevation or bridge is invented
here. Shared Earth edges become the explicit input to colony transport design.
"""
import argparse
import hashlib
import json
import math
from pathlib import Path
from pyproj import Transformer
from shapely.geometry import Polygon, box, shape, mapping
from shapely.ops import transform
from shapely.affinity import affine_transform
from plan_tokyo_metro import write


def parts(geometry,kind):
    if geometry.geom_type==kind:yield geometry
    elif hasattr(geometry,'geoms'):
        for child in geometry.geoms:yield from parts(child,kind)


def connect_source_cuts(bands, increasing_cross=False):
    """Pair the same original railway at the shared source edges, not nearest lines."""
    links=[];unmatched=[]
    for south,north in zip(bands,bands[1:]):
        a=[(i,c) for i,c in enumerate(south['boundaryCuts']) if c['edge']==('x-max' if increasing_cross else 'x-min')]
        b=[(i,c) for i,c in enumerate(north['boundaryCuts']) if c['edge']==('x-min' if increasing_cross else 'x-max')]
        used=set()
        for _,cut in a:
            candidates=[(j,other) for j,other in b if j not in used and other['track']==cut['track']
                        and abs(other['local'][1]-cut['local'][1])<.01]
            if len(candidates)!=1:
                unmatched.append(dict(band=south['id'],cut=cut,matches=len(candidates)));continue
            j,other=candidates[0];used.add(j)
            links.append(dict(sourceTrack=cut['track'],line=cut['line'],operator=cut['operator'],
                sides=[dict(band=south['id'],local=cut['local']),dict(band=north['id'],local=other['local'])],
                axialDifferenceM=abs(cut['local'][1]-other['local'][1]),
                status='source continuity verified; colony bridge/route not designed'))
        unmatched.extend(dict(band=north['id'],cut=cut,matches=0) for i,cut in b if i not in used)
    return dict(candidates=links,unmatchedInteriorCuts=unmatched)


def main():
    parser=argparse.ArgumentParser();parser.add_argument('--root',type=Path,required=True);parser.add_argument('--source',type=Path,required=True)
    args=parser.parse_args();root=args.root.resolve();plan=json.loads((root/'tokyo-metro-plan.json').read_text())
    bbox=box(min(b['bbox'][0] for b in plan['bands']),min(b['bbox'][1] for b in plan['bands']),
             max(b['bbox'][2] for b in plan['bands']),max(b['bbox'][3] for b in plan['bands']))
    project=Transformer.from_crs(6668,6677,always_xy=True);inputs={};receipts=[]
    for kind,name in [('stations','N02-25_Station.geojson'),('tracks','N02-25_RailroadSection.geojson')]:
        path=args.source/name;receipts.append(dict(kind=kind,path=str(path.resolve()),sha256=hashlib.sha256(path.read_bytes()).hexdigest()))
        chosen=[]
        for i,feature in enumerate(json.loads(path.read_text())['features']):
            geometry=shape(feature['geometry'])
            if not geometry.intersects(bbox):continue
            chosen.append(dict(id=f'{kind}-{i}',properties=feature['properties'],geometry=transform(project.transform,geometry)))
        inputs[kind]=chosen
    result=dict(version=1,source='https://nlftp.mlit.go.jp/ksj/gml/datalist/KsjTmplt-N02-2025.html',sourceReceipts=receipts,
                status='Source rail cut inventory; colony connections, routes and elevation unimplemented',bands=[])
    for band in plan['bands']:
        f=band['frame'];c,s=math.cos(f['angle']),math.sin(f['angle']);ox,oy=f['origin'];crop=box(*band['bounds'])
        row=dict(id=band['id'],stations=[],tracks=[],boundaryCuts=[])
        for kind,features in inputs.items():
            for feature in features:
                local=affine_transform(feature['geometry'],[s,-c,c,s,-ox*s+oy*c,-ox*c-oy*s]);cut=local.intersection(crop)
                if cut.is_empty:continue
                properties=feature['properties'];line=properties.get('N02_003');operator=properties.get('N02_004')
                if kind=='stations':
                    row[kind].append(dict(id=feature['id'],name=properties['N02_005'],line=line,operator=operator,
                        center=list(cut.centroid.coords)[0],geometry=mapping(cut),crossesBoundary=not crop.covers(local),properties=properties))
                else:
                    row[kind].append(dict(id=feature['id'],line=line,operator=operator,geometry=mapping(cut),properties=properties))
                    for point in parts(local.intersection(crop.boundary),'Point'):
                        x,y=point.coords[0];x0,y0,x1,y1=band['bounds']
                        edge=min([('x-min',abs(x-x0)),('x-max',abs(x-x1)),('y-min',abs(y-y0)),('y-max',abs(y-y1))],key=lambda e:e[1])[0]
                        row['boundaryCuts'].append(dict(track=feature['id'],line=line,operator=operator,local=[x,y],edge=edge))
        row['summary']=dict(stations=len(row['stations']),tracks=len(row['tracks']),boundaryCuts=len(row['boundaryCuts']),
                            stationNames=sorted(set(v['name'] for v in row['stations'])),sourceTrackLengthKm=sum(shape(t['geometry']).length for t in row['tracks'])/1000)
        result['bands'].append(row);print(band['id'],json.dumps(row['summary'],ensure_ascii=False),flush=True)
    result['windowConnections']=connect_source_cuts(result['bands'],plan.get('layout')=='inland-b')
    print('window source connections',len(result['windowConnections']['candidates']),'unmatched',len(result['windowConnections']['unmatchedInteriorCuts']),flush=True)
    write(root/'metro-transport-source.json',result)


if __name__=='__main__':main()
