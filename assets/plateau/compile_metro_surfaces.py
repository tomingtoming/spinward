"""Stream CityGML into a bounded spatial store without invented land classes.

All source land-use classes survive; natural/water/urban rendering is resolved
from each municipality's own codelist. Source holes and IDs are retained.
"""
import argparse
import hashlib
import json
import sqlite3
from pathlib import Path

import numpy as np
from pyproj import Transformer
from shapely import make_valid, union_all
from shapely.geometry import Polygon, box
from shapely.prepared import prep
from assemble import city_members, G
from plan_tokyo_metro import write, receipt_paths


def connect(path):
    db=sqlite3.connect(path)
    db.executescript('''
      PRAGMA journal_mode=WAL;
      CREATE TABLE IF NOT EXISTS files(key TEXT PRIMARY KEY, url TEXT, sha256 TEXT, kind TEXT, audit TEXT);
      CREATE TABLE IF NOT EXISTS surfaces(rowid INTEGER PRIMARY KEY, source_id TEXT UNIQUE, city_code TEXT,
        kind TEXT, class_code TEXT, code_space TEXT, geometry BLOB, min_z REAL, max_z REAL);
      CREATE VIRTUAL TABLE IF NOT EXISTS surface_index USING rtree(rowid,min_x,max_x,min_y,max_y);
      CREATE TABLE IF NOT EXISTS feature_sources(rowid INTEGER, file_key TEXT, PRIMARY KEY(rowid,file_key));
    ''')
    return db


def import_file(db,root,receipt,crop):
    key=hashlib.sha256(receipt['url'].encode()).hexdigest()[:24]
    prior=db.execute('SELECT sha256 FROM files WHERE key=?',(key,)).fetchone()
    if prior:
        assert prior[0]==receipt['sha256'];return None
    identical=db.execute('SELECT audit FROM files WHERE sha256=? AND kind=?',(receipt['sha256'],receipt['kind'])).fetchone()
    if identical:
        audit={**json.loads(identical[0]),'identicalSourceMirror':True}
        with db:db.execute('INSERT INTO files VALUES(?,?,?,?,?)',(key,receipt['url'],receipt['sha256'],receipt['kind'],json.dumps(audit)))
        return audit
    source=root/receipt['path'];digest=hashlib.sha256()
    with source.open('rb') as stream:
        while block:=stream.read(1024*1024):digest.update(block)
    assert digest.hexdigest()==receipt.get('storedSha256',receipt['sha256'])
    projector=Transformer.from_crs(6668,6677,always_xy=True);prepared=prep(crop)
    kind=receipt['kind'];total=0;accepted=0;missing_lod=0;duplicates=0;area=0;invalid=0
    with db:
        for member in city_members(source):
            feature=next(iter(member));id_=feature.attrib.get(G+'id');assert id_
            total+=1;surfaces=[el for el in feature if el.tag.endswith('}lod1MultiSurface')]
            if not surfaces:missing_lod+=1;continue
            classification=next((el for el in feature if el.tag.endswith('}class')),None)
            # Store codes even before their dictionaries arrive. Never guess a class.
            code=classification.text if classification is not None else None
            code_space=classification.attrib.get('codeSpace') if classification is not None else None
            parts=[];zs=[]
            for surface in surfaces:
                assert not any('href' in a for el in surface.iter() for a in el.attrib),'Unresolved xlink'
                for polygon in surface.iter(G+'Polygon'):
                    rings=[];heights=[]
                    for ring in polygon:
                        if ring.tag not in (G+'exterior',G+'interior'):continue
                        pos=ring.find('.//'+G+'posList');assert pos is not None
                        assert pos.attrib.get('srsDimension','3')=='3'
                        points=np.fromstring(pos.text,sep=' ').reshape(-1,3);assert np.isfinite(points).all()
                        xy=np.column_stack(projector.transform(points[:,1],points[:,0]))
                        rings.append(xy);heights.extend(points[:,2].tolist())
                    if not rings:continue
                    polygon=Polygon(rings[0],rings[1:])
                    if not prepared.intersects(box(*polygon.bounds)):continue
                    invalid+=not polygon.is_valid;cut=make_valid(polygon).intersection(crop)
                    if cut.area<.01:continue
                    parts.append(cut);zs.extend(heights)
            if not parts:continue
            merged=union_all(parts);source_id=f"{kind}:{id_}"
            accepted+=1;area+=merged.area
            prior=db.execute('SELECT rowid FROM surfaces WHERE source_id=?',(source_id,)).fetchone()
            if prior:
                rowid=prior[0];duplicates+=1
                existing=db.execute('SELECT geometry,class_code FROM surfaces WHERE rowid=?',(rowid,)).fetchone()
                from shapely import from_wkb
                old=from_wkb(existing[0])
                assert old.symmetric_difference(merged).area<.01 and existing[1]==code,'Conflicting GML feature across mirrors: '+source_id
            else:
                cursor=db.execute('INSERT INTO surfaces(source_id,city_code,kind,class_code,code_space,geometry,min_z,max_z) VALUES(?,?,?,?,?,?,?,?)',
                    (source_id,receipt['cityCode'],kind,code,code_space,merged.wkb,min(zs),max(zs)))
                rowid=cursor.lastrowid;x0,y0,x1,y1=merged.bounds
                db.execute('INSERT INTO surface_index VALUES(?,?,?,?,?)',(rowid,x0,x1,y0,y1))
            db.execute('INSERT OR IGNORE INTO feature_sources VALUES(?,?)',(rowid,key))
        audit=dict(sourceFeatures=total,acceptedFeatures=accepted,duplicates=duplicates,featuresWithoutLod1=missing_lod,
                   invalidSourcePolygonsRepaired=invalid,sumFeatureAreaKm2=area/1e6)
        db.execute('INSERT INTO files VALUES(?,?,?,?,?)',(key,receipt['url'],receipt['sha256'],kind,json.dumps(audit)))
    return audit


def main():
    parser=argparse.ArgumentParser();parser.add_argument('--root',type=Path,required=True);parser.add_argument('--limit',type=int)
    args=parser.parse_args();root=args.root.resolve();plan=json.loads((root/'tokyo-metro-plan.json').read_text())
    crop=union_all([Polygon(b['projectedCorners']) for b in plan['bands']])
    db=connect(root/'metro-surfaces.sqlite');errors=[];count=0
    receipts=[json.loads(p.read_text()) for p in receipt_paths(root)]
    try:
        for receipt in receipts:
            if receipt['kind'] not in ['tran','luse','wtr'] or receipt['status']!='acquired':continue
            try:result=import_file(db,root,receipt,crop)
            except Exception as error:
                errors.append(dict(url=receipt['url'],error=str(error)));break
            if result:
                count+=1
                if count%20==0 or result.get('duplicates',0)>0:print('compiled surface',count,receipt['cityCode'],receipt['kind'],result,flush=True)
                if args.limit and count>=args.limit:break
    finally:
        report=dict(files=db.execute('SELECT count(*) FROM files').fetchone()[0],
                    surfaces=dict(db.execute('SELECT kind,count(*) FROM surfaces GROUP BY kind').fetchall()),
                    errors=errors,complete=False,interpretation='Source polygons only; land classification, gap auditing, DEM and runtime verification remain.')
        write(root/'surface-compile-audit.json',report);db.execute('PRAGMA wal_checkpoint(TRUNCATE)');db.close()
        print(json.dumps(report,ensure_ascii=False),flush=True)
    if errors:raise RuntimeError('CityGML import failed; see surface-compile-audit.json')


if __name__=='__main__':main()
