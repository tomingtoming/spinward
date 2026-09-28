"""Match N02 station lines to PLATEAU transport buildings, then enrich recipes.

Source volumes stay immutable. A station name/line is source information;
elevations and hall/platform classification are conservative Spinward designs.
Only changed owner recipes are written; all other catalog paths are reused.
"""
import argparse, collections, gzip, hashlib, json, sqlite3, zlib
from pathlib import Path
import numpy as np
from shapely import from_wkb, union_all
from shapely.geometry import box, shape, Polygon, LineString
from shapely.strtree import STRtree
from audit_metro_coverage import dictionaries, projected_cell, query
from metro_geometry import Frame, Grid, polygons
from prepare_metro_overview import source_buildings, source_ground, owner
from prepare_metro_near import rings, json_tile
from prepare_facade_life import projection
from plan_frontage import plan_buildings


def station_match(usage, footprint, height, line):
    """Do not infer an aboveground station from proximity to a station point."""
    if usage != '運輸倉庫施設' or footprint.area < 150 or height < 4.5:
        return None
    rectangle = list(footprint.minimum_rotated_rectangle.exterior.coords)
    lengths = sorted(np.linalg.norm(np.asarray(b)-a) for a,b in zip(rectangle,rectangle[1:]))
    short, long = lengths[0], lengths[-1]
    distance = footprint.distance(line)
    overlap = footprint.intersection(line).length
    nearby = footprint.intersection(line.buffer(5, cap_style=2)).area
    # Require a meaningful length of the station platform alignment inside the
    # footprint. A 5m tolerance accommodates adjacent roof centreline offsets.
    if long < 18 or distance > 5 or nearby < min(100, footprint.area*.15):
        return None
    return dict(kind='platform' if height < 9 or (short < 30 and long/short > 3) else 'hall',
                lineOverlapM=round(overlap,2), lineDistanceM=round(distance,2),
                matchAreaM2=round(nearby,2), sourceHeightM=round(height,2))


def roof_seams(p, idx):
    """Only nearly level, topmost source faces receive roof detailing.

    Projected source heights drift by centimetres across a large LOD1 roof
    (Omiya: 26mm). An 80mm band includes that plane without covering lower
    storeys or treating a pitched roof as one flat slab.
    """
    faces=p[idx.reshape(-1,3)];top=float(p[:,2].max())
    faces=faces[np.all(np.abs(faces[:,:,2]-top)<.08,axis=1)]
    roof=union_all([Polygon(f[:,:2]) for f in faces if Polygon(f[:,:2]).area>.01]).buffer(-.18)
    if roof.is_empty or roof.area<100:return []
    ring=list(roof.minimum_rotated_rectangle.exterior.coords)
    a,b=max(zip(ring,ring[1:]),key=lambda ab:np.linalg.norm(np.asarray(ab[1])-ab[0]))
    u=(np.asarray(b)-a);u/=np.linalg.norm(u);n=np.array([-u[1],u[0]]);points=np.asarray(ring);lo,hi=(points@n).min(),(points@n).max()
    along=points@u;start,end=along.min()-1,along.max()+1;seams=[]
    for offset in np.arange(lo+3,hi,8):
        cut=roof.intersection(LineString([u*start+n*offset,u*end+n*offset]))
        for line in list(cut.geoms) if hasattr(cut,'geoms') else [cut]:
            if line.geom_type!='LineString' or line.length<4:continue
            seams.append(dict(a=list(line.coords[0]),b=list(line.coords[-1]),top=top))
    return seams


def attached_station_match(usage, footprint, height, anchor):
    # One hop only, from a directly matched major hall. This recovers source
    # buildings split at a lower concourse without spreading along rail yards.
    if usage!='運輸倉庫施設' or footprint.area<150 or height<4.5 or anchor.area<1500:return None
    contact=footprint.boundary.intersection(anchor.buffer(.30)).length
    if footprint.distance(anchor)>.30 or contact<max(12,min(footprint.length,anchor.length)*.05):return None
    return dict(kind='hall' if height>=10 else 'platform',matchType='attached-transport',
                sharedBoundaryM=round(contact,2),sourceHeightM=round(height,2))


def compile_stations(root, output, base):
    derived=root/'derived';out=derived/output
    if out.exists():raise ValueError(f'Refuse to overwrite station catalog: {out}')
    out.mkdir(parents=True)
    plan=json.loads((root/'tokyo-metro-plan.json').read_text())
    rail=json.loads((root/'metro-transport-source.json').read_text())
    codes=dictionaries(root)
    db=sqlite3.connect(f'file:{root}/metro-source.sqlite?mode=ro',uri=True)
    surfaces=sqlite3.connect(f'file:{root}/metro-surfaces.sqlite?mode=ro',uri=True)
    matched={};audit=dict(origin='ai',created='2026-09-25',ready=False,bands={},
        evidence='PLATEAU transport usage + N02 station alignment; not surveyed elevations',
        constraints=dict(maxLineDistanceM=5, minFootprintM2=150, minHeightM=4.5))
    for band in plan['bands']:
        frame=Frame(band);candidates={};grouped=collections.defaultdict(list)
        for station in next(b for b in rail['bands'] if b['id']==band['id'])['stations']:
            grouped[station['name']].append(station)
        for name, stations in sorted(grouped.items()):
            line=union_all([shape(s['geometry']) for s in stations]);crop=line.buffer(6)
            for identity,usage,bounds,blob in query(db,'buildings',projected_cell(band,crop.bounds),
                's.source_id,s.usage,s.bounds,s.footprint',"AND s.usage='運輸倉庫施設'"):
                footprint=frame.shape(from_wkb(blob))
                # A cut band boundary is not an exposed source station facade.
                if not box(*band['bounds']).covers(footprint):continue
                bounds=json.loads(bounds);match=station_match(usage,footprint,bounds[5]-bounds[4],line)
                if not match:continue
                score=(match['lineOverlapM'],match['matchAreaM2'],-match['lineDistanceM'])
                if identity in candidates and candidates[identity]['score']>=score:continue
                candidates[identity]=dict(id=identity,shape=footprint,owner=owner(band,footprint),score=score,
                    station=dict(name=name,source='N02 + PLATEAU transport footprint',matchType='station-line',**match,
                        stationIds=sorted(s['id'] for s in stations),lines=sorted(set(s['line'] for s in stations))))
        extensions={}
        for anchor in list(candidates.values()):
            if anchor['station']['kind']!='hall' or anchor['shape'].area<1500:continue
            for identity,usage,bounds,blob in query(db,'buildings',projected_cell(band,anchor['shape'].buffer(1).bounds),
                's.source_id,s.usage,s.bounds,s.footprint',"AND s.usage='運輸倉庫施設'"):
                if identity in candidates:continue
                footprint=frame.shape(from_wkb(blob))
                if not box(*band['bounds']).covers(footprint):continue
                bounds=json.loads(bounds);match=attached_station_match(usage,footprint,bounds[5]-bounds[4],anchor['shape'])
                if not match:continue
                if identity in extensions and extensions[identity]['station']['sharedBoundaryM']>=match['sharedBoundaryM']:continue
                extensions[identity]=dict(id=identity,shape=footprint,owner=owner(band,footprint),station=dict(
                    name=anchor['station']['name'],source='N02 + PLATEAU transport footprint',**match,
                    anchorBuilding=anchor['id'],stationIds=anchor['station']['stationIds'],lines=anchor['station']['lines']))
        candidates.update(extensions)
        matched[band['id']]=candidates
        print(band['id'],'matched',len(candidates),'buildings',flush=True)
    labels=sorted({b['station']['name'] for c in matched.values() for b in c.values()})
    kit=json.loads((derived/'facades-v3/kit.json').read_text())
    kit.update(stationSigns=labels,stationVersion=1)
    (out/'kit.json').write_text(json.dumps(kit,ensure_ascii=False,separators=(',',':')))
    for band in plan['bands']:
        name=band['id'];frame=Frame(band);grid=Grid(root,name);candidates=matched[name]
        manifest=json.loads((derived/base/(name+'.json')).read_text());sites={s['id']:s for s in manifest['sites']}
        by_owner=collections.defaultdict(list)
        for b in candidates.values():by_owner[b['owner']].append(b)
        applied=[];rejected=[]
        for tile, targets in sorted(by_owner.items()):
            crop=union_all([b['shape'] for b in targets]).buffer(3)
            nearby=list(source_buildings(db,band,crop.bounds));shapes=[b['shape'] for b in nearby];tree=STRtree(shapes)
            collision=[dict(id=b['id'],rings=rings(poly),base=b['base'],top=b['top']) for b in nearby for poly in polygons(b['shape'])]
            features={};positions=[];indices=[];roofs={};np_count=ni_count=0
            for b in targets:
                usage,geometry,vertices,count=db.execute('SELECT usage,geometry,vertex_count,index_count FROM buildings WHERE source_id=?',(b['id'],)).fetchone()
                raw=zlib.decompress(geometry);p=frame.points(np.frombuffer(raw,dtype='<f4',count=vertices*3).reshape(-1,3))
                idx=np.frombuffer(raw,dtype='<u4',count=count,offset=vertices*12)
                roofs[b['id']]=roof_seams(p,idx)
                features[b['id']]=dict(usage=usage,firstIndex=ni_count,indexCount=count)
                positions.append(p);indices.append(idx+np_count);np_count+=len(p);ni_count+=count
            ground=list(source_ground(surfaces,codes,band,crop.bounds))
            roads=union_all([s for _,_,s,k in ground if k=='道路用地']);water=union_all([s for _,_,s,k in ground if k=='水面'])
            rows=plan_buildings(dict(buildings=collision,roads=[dict(rings=rings(p)) for p in polygons(roads)]),
                features,np.concatenate(positions),np.concatenate(indices).reshape(-1,3),grid,
                station_ids=set(features),audit=rejected)
            roof_assigned=set()
            for row in rows:
                row['station']={**candidates[row['id']]['station'],'signIndex':4+labels.index(candidates[row['id']]['station']['name'])}
                if row['id'] not in roof_assigned:
                    row['station']['roofSeams']=roofs[row['id']];roof_assigned.add(row['id'])
                for w in row['walls']:
                    w['projectionClearance']=0
                    for depth in [1.12,.66]:
                        area=projection(w,depth)
                        if not box(*band['bounds']).covers(area):continue
                        if area.intersects(roads) or area.intersects(water) or any(area.intersects(shapes[i]) for i in tree.query(area)):continue
                        w['projectionClearance']=depth;break
                applied.append(dict(id=row['id'],station=row['station'],walls=len(row['walls']),owner=tile))
            if not rows:continue
            site=sites[tile];data=json.loads(gzip.decompress((derived/site['path']).read_bytes()))
            added={b['id'] for b in rows};data['buildings']=[b for b in data['buildings'] if b['id'] not in added]+rows
            path=f'{output}/{name}/{tile}.json.gz';saved=json_tile(derived,path,data)
            # FacadeStream's recipe bytes are decoded bytes, not wire bytes.
            site.update(saved,bytes=saved['decodedBytes'],buildings=len({r['id'] for r in data['buildings']}))
            points=[p for r in rows for w in r['walls'] for p in [w['a'],w['b']]]
            site['bounds']=[min(site['bounds'][k],min(p[k] for p in points)) for k in [0,1]]+[max(site['bounds'][k+2],max(p[k] for p in points)) for k in [0,1]]
            site['heightRange']=[min(site['heightRange'][0],min(w['base'] for r in rows for w in r['walls'])),max(site['heightRange'][1],max(w['top'] for r in rows for w in r['walls']))]
        manifest['stationVersion']=1;manifest['kit']=f'{output}/kit.json'
        (out/(name+'.json')).write_text(json.dumps(manifest,ensure_ascii=False,separators=(',',':')))
        audit['bands'][name]=dict(matched=len(candidates),appliedBuildings=len({b['id'] for b in applied}),
            stations=sorted({b['station']['name'] for b in applied}),changedSites=len({b['owner'] for b in applied}),buildings=applied,
            rejected=[r for r in rejected if r['reason']!='applied'])
        print(name,'applied',audit['bands'][name]['appliedBuildings'],'buildings',flush=True)
    audit['ready']=True;(out/'station-audit.json').write_text(json.dumps(audit,ensure_ascii=False,indent=2))
    db.close();surfaces.close()


if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--root',type=Path,required=True);p.add_argument('--output',default='stations-v1');p.add_argument('--base',default='facades-v4')
    args=p.parse_args();compile_stations(args.root,args.output,args.base)
