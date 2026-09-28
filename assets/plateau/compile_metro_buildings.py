"""Incremental metric source store for full-area PLATEAU streaming.

One decoder process, one source tile in memory, one transaction per tile. Preserve
original buildings even at strip edges; clipping for the colony is a later step.
The RTree indexes true footprint bounds rather than tileset boxes. SQLite and
all binary derivatives stay under the ignored evidence directory.
"""
import argparse
import hashlib
import json
import math
import sqlite3
import struct
import subprocess
import zlib
from pathlib import Path

import numpy as np
from pyproj import Transformer
from shapely import union_all, make_valid, set_precision
from shapely.geometry import Polygon, box
from shapely.prepared import prep
from plan_tokyo_metro import write, receipt_paths


class Decoder:
    def __init__(self,node):
        self.process=subprocess.Popen([node,str(Path(__file__).with_name('decode_metro_tiles.mjs')),'--stdio'],stdin=subprocess.PIPE,stdout=subprocess.PIPE,text=True)
    def read(self,path):
        self.process.stdin.write(json.dumps({'path':str(path.resolve())})+'\n');self.process.stdin.flush()
        line=self.process.stdout.readline()
        if not line:raise RuntimeError('Tile decoder terminated')
        result=json.loads(line)
        if 'error' in result:raise ValueError(result['error'])
        return result['result']
    def close(self):
        self.process.stdin.close();self.process.stdout.close();self.process.wait(timeout=10)


def connect(path):
    db=sqlite3.connect(path)
    db.executescript('''
        PRAGMA journal_mode=WAL;
        CREATE TABLE IF NOT EXISTS tiles (
          key TEXT PRIMARY KEY, sha256 TEXT NOT NULL, url TEXT NOT NULL,
          total INTEGER NOT NULL, accepted INTEGER NOT NULL, audit TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS buildings (
          rowid INTEGER PRIMARY KEY, source_id TEXT NOT NULL UNIQUE, city_code TEXT NOT NULL,
          usage TEXT, lod INTEGER NOT NULL, bounds TEXT NOT NULL,
          geometry BLOB NOT NULL, footprint BLOB NOT NULL, vertex_count INTEGER NOT NULL, index_count INTEGER NOT NULL);
        CREATE VIRTUAL TABLE IF NOT EXISTS building_index USING rtree(rowid,min_x,max_x,min_y,max_y);
        CREATE TABLE IF NOT EXISTS feature_sources (rowid INTEGER, tile_key TEXT, PRIMARY KEY(rowid,tile_key));
        CREATE TABLE IF NOT EXISTS band_buildings (
          band TEXT, rowid INTEGER, crosses_boundary INTEGER NOT NULL, PRIMARY KEY(band,rowid));
    ''')
    return db


def metric_features(decoded, city):
    a=np.asarray(decoded['positions'],dtype=np.float64).reshape(-1,3)
    ecef=np.column_stack([a[:,0],-a[:,2],a[:,1]])+decoded['rtc']
    llh=np.column_stack(Transformer.from_crs(4978,4979,always_xy=True).transform(*ecef.T))
    xy=np.column_stack(Transformer.from_crs(6668,6677,always_xy=True).transform(*llh[:,:2].T))
    batches=np.asarray(decoded['batches'],dtype=np.int32);tri=np.asarray(decoded['indices'],dtype=np.uint32).reshape(-1,3)
    assert np.equal(batches[tri[:,0]],batches[tri[:,1]]).all() and np.equal(batches[tri[:,0]],batches[tri[:,2]]).all()
    triangle_ids=batches[tri[:,0]]
    for i,feature in enumerate(decoded['features']):
        vi=np.flatnonzero(batches==i)
        if not len(vi):continue
        source_bounds=np.asarray(feature['bounds']);geo=llh[vi]
        error=float(abs(np.r_[geo[:,:2].min(0),geo[:,:2].max(0)]-source_bounds[:4]).max()*111320)
        height_error=float(abs(np.ptp(geo[:,2])-(source_bounds[5]-source_bounds[4])))
        assert error<.5 and height_error<.5,(feature['id'],error,height_error)
        # Source bounds are CityGML orthometric elevations; ECEF contains ellipsoidal altitude.
        positions=np.column_stack([xy[vi],geo[:,2]+source_bounds[4]-geo[:,2].min()])
        remap=np.full(len(batches),-1,dtype=np.int32);remap[vi]=np.arange(len(vi))
        indices=remap[tri[triangle_ids==i]];assert (indices>=0).all()
        yield dict(source_id=city+':'+feature['id'],usage=feature['usage'],lod=feature['sourceLod'],
                   source_bounds=feature['bounds'],positions=positions,indices=indices,
                   bounds_error=error,height_error=height_error)


def source_footprint(positions,indices):
    # Snap each projected face before overlay. Snapping only during union leaves
    # near-coincident wall/roof edges able to trigger GEOS side-location conflicts.
    # Quantization is <= 1.415 mm per vertex; source 3D geometry stays untouched.
    faces=[Polygon(points[:,:2]) for points in positions[indices]]
    faces=[set_precision(face,.002) for face in faces if face.area>.005]
    return make_valid(union_all(faces))


def add_tile(db,root,receipt,decoder,band_shapes):
    key=hashlib.sha256(receipt['url'].encode()).hexdigest()[:24]
    prior=db.execute('SELECT sha256 FROM tiles WHERE key=?',(key,)).fetchone()
    if prior:
        assert prior[0]==receipt['sha256'],'Source changed after compilation'
        return None
    path=root/receipt['path'];expected=receipt.get('storedSha256',receipt['sha256'])
    assert hashlib.sha256(path.read_bytes()).hexdigest()==expected,'Corrupt source: '+str(path)
    decoded=decoder.read(path)
    whole=union_all(list(band_shapes.values()));prepared=prep(whole)
    accepted=0;duplicates=0;max_bounds=0;max_height=0
    with db:
        for feature in metric_features(decoded,receipt['cityCode']):
            positions=feature['positions'];indices=feature['indices'];xy=positions[:,:2]
            bounds=[*xy.min(0),*xy.max(0)]
            if not prepared.intersects(box(*bounds)):continue
            max_bounds=max(max_bounds,feature['bounds_error']);max_height=max(max_height,feature['height_error'])
            footprint=source_footprint(positions,indices)
            if footprint.is_empty or not prepared.intersects(footprint):continue
            accepted+=1
            prior=db.execute('SELECT rowid,bounds FROM buildings WHERE source_id=?',(feature['source_id'],)).fetchone()
            if prior:
                assert np.max(np.abs(np.array(json.loads(prior[1]))-feature['source_bounds']))<.5,'Conflicting source identity'
                rowid=prior[0];duplicates+=1
            else:
                raw=positions.astype('<f4').tobytes()+indices.astype('<u4').tobytes()
                cursor=db.execute('INSERT INTO buildings(source_id,city_code,usage,lod,bounds,geometry,footprint,vertex_count,index_count) VALUES(?,?,?,?,?,?,?,?,?)',
                    (feature['source_id'],receipt['cityCode'],feature['usage'],feature['lod'],json.dumps(feature['source_bounds']),
                     zlib.compress(raw,3),footprint.wkb,len(positions),indices.size))
                rowid=cursor.lastrowid;x0,y0,x1,y1=footprint.bounds
                db.execute('INSERT INTO building_index VALUES(?,?,?,?,?)',(rowid,x0,x1,y0,y1))
                for band,shape in band_shapes.items():
                    if shape.intersects(footprint):
                        db.execute('INSERT INTO band_buildings VALUES(?,?,?)',(band,rowid,not shape.covers(footprint)))
            db.execute('INSERT INTO feature_sources VALUES(?,?)',(rowid,key))
        audit=dict(maxBoundsErrorM=max_bounds,maxHeightRangeErrorM=max_height,duplicates=duplicates)
        db.execute('INSERT INTO tiles VALUES(?,?,?,?,?,?)',(key,receipt['sha256'],receipt['url'],len(decoded['features']),accepted,json.dumps(audit)))
    return dict(total=len(decoded['features']),accepted=accepted,**audit)


def main():
    parser=argparse.ArgumentParser();parser.add_argument('--root',type=Path,required=True);parser.add_argument('--node',required=True)
    parser.add_argument('--limit',type=int);args=parser.parse_args();root=args.root.resolve()
    plan=json.loads((root/'tokyo-metro-plan.json').read_text());bands={b['id']:Polygon(b['projectedCorners']) for b in plan['bands']}
    receipts=[json.loads(p.read_text()) for p in receipt_paths(root)]
    receipts=[r for r in receipts if r['kind']=='building' and r['status']=='acquired']
    db=connect(root/'metro-source.sqlite');decoder=Decoder(args.node);errors=[];count=0
    try:
        for receipt in receipts:
            try:result=add_tile(db,root,receipt,decoder,bands)
            except Exception as error:
                errors.append(dict(url=receipt['url'],error=str(error)));print('FAILED',receipt['url'],str(error)[:250],flush=True);break
            if result:
                count+=1
                if count%30==0:print('compiled',count,'buildings',db.execute('SELECT count(*) FROM buildings').fetchone()[0],flush=True)
                if args.limit and count>=args.limit:break
    finally:
        decoder.close()
        report=dict(tiles=db.execute('SELECT count(*) FROM tiles').fetchone()[0],
            buildings=db.execute('SELECT count(*) FROM buildings').fetchone()[0],
            bands={band:dict(count=db.execute('SELECT count(*) FROM band_buildings WHERE band=?',(band,)).fetchone()[0],
                            boundaryCrossings=db.execute('SELECT count(*) FROM band_buildings WHERE band=? AND crosses_boundary=1',(band,)).fetchone()[0]) for band in bands},
            errors=errors,complete=False,interpretation='Acquired source geometry store only. Boundary adaptation, surface coverage and runtime acceptance remain.')
        write(root/'building-compile-audit.json',report);db.execute('PRAGMA wal_checkpoint(TRUNCATE)');db.close()
        print(json.dumps(report,ensure_ascii=False),flush=True)
    if errors:raise RuntimeError('Source geometry audit failed; see building-compile-audit.json')


if __name__=='__main__':main()
