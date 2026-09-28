"""Certify facade projections against source footprints, roads and water.

Write a separate recipe catalog; geometry and original recipes stay immutable.
Missing certification means no deep projection, never assumed empty space.
"""
import argparse,gzip,hashlib,json,sqlite3,time,math
import numpy as np
from pathlib import Path
from shapely import union_all
from shapely.geometry import Polygon,box,Point,LineString
from shapely.ops import nearest_points
from shapely.strtree import STRtree
from audit_metro_coverage import dictionaries
from prepare_metro_overview import source_buildings,source_ground
from metro_geometry import Grid

def entrance_position(row,w):
    n=2166136261
    for c in row['id']+':elevation-v2':n=((n^ord(c))*16777619)&0xffffffff
    house=row['usage'] in ['住宅','店舗等併用住宅','作業所併用住宅']
    apartment=row['usage'] in ['共同住宅','店舗等併用共同住宅']
    nominal=3.1 if house else 4.5 if apartment else 3.2
    span=w['length']-.9;count=max(1,math.floor(span/(nominal+((n>>2)%3-.9)*.25)))
    weights=[.66 if house and i==count-1 else 1 for i in range(count)];j=count//2
    along=.45+span*(sum(weights[:j])+weights[j]/2)/sum(weights)
    return [w['a'][k]+(w['b'][k]-w['a'][k])*along/w['length'] for k in [0,1]]

def entry_access(row,w,roads,water,nearby,shapes,tree,grid):
    w.pop('entryAccess',None)
    if roads.is_empty:return
    p=entrance_position(row,w);start=[p[k]+w['normal'][k]*.055 for k in [0,1]]
    q=list(nearest_points(Point(start),roads)[1].coords[0]);length=math.dist(start,q)
    if length<.15 or length>8:return
    direction=[(q[k]-start[k])/length for k in [0,1]]
    if sum(direction[k]*w['normal'][k] for k in [0,1])<.75:return
    area=LineString([start,q]).buffer(.53,cap_style=2)
    if area.intersects(water) or any(nearby[i]['id']!=row['id'] and area.intersects(shapes[i]) for i in tree.query(area)):return
    centerline=LineString([start,q])
    if any(nearby[i]['id']==row['id'] and centerline.intersects(shapes[i].buffer(-.02)) for i in tree.query(area)):return
    gx,gy=grid.origin
    if not box(gx,gy,gx+(grid.z.shape[1]-1)*grid.step,gy+(grid.z.shape[0]-1)*grid.step).covers(area):return
    points=[]
    for t in [0,.25,.5,.75,1]:
        for side in [-.5,.5]:points.append([start[0]+direction[0]*length*t-direction[1]*side,start[1]+direction[1]*length*t+direction[0]*side])
    points=np.asarray(points);samples=grid.height(points[:,0],points[:,1])
    # Only nearly level source terrain receives a flat apron. A slope needs a
    # terrain-conforming path, not a floating plank or an invented staircase.
    if max(samples)-min(samples)>.04:return
    w['entryAccess']={'start':start,'end':q,'ground':float(max(samples))}

def projection(w,depth):
    a,b=w['a'],w['b'];u=[(b[k]-a[k])/w['length'] for k in [0,1]];n=w['normal'];inset=.32
    return Polygon([[a[k]+u[k]*inset+n[k]*d for k in [0,1]] for d in [.07,depth]]+
                   [[b[k]-u[k]*inset+n[k]*d for k in [0,1]] for d in [depth,.07]])

def main():
    p=argparse.ArgumentParser();p.add_argument('--root',type=Path,required=True);p.add_argument('--output',default='facades-v3');p.add_argument('--reuse-clearance');args=p.parse_args();root=args.root
    bands=json.loads((root/'tokyo-metro-plan.json').read_text())['bands'];d=root/'derived';out=d/args.output
    out.mkdir(exist_ok=True);codes=dictionaries(root)
    buildings=sqlite3.connect(f'file:{root}/metro-source.sqlite?mode=ro',uri=True)
    surfaces=sqlite3.connect(f'file:{root}/metro-surfaces.sqlite?mode=ro',uri=True)
    audit={'origin':'ai','created':'2026-09-25','bands':{},'ready':False};start=time.monotonic()
    for band in bands:
        name=band['id'];manifest=json.loads((d/args.reuse_clearance/(name+'.json') if args.reuse_clearance else d/name/'facades.json').read_text());folder=out/name;folder.mkdir(exist_ok=True);grid=Grid(root,name)
        stats={'sites':0,'walls':0,'certified':0,'blocked':0};audit['bands'][name]=stats
        for site in manifest['sites']:
            target=folder/(site['id']+'.json.gz')
            raw=gzip.decompress((d/site['path']).read_bytes());data=json.loads(raw)
            bounds=box(*site['bounds']).buffer(10).bounds
            candidates=[r for r in data['buildings'] if r['usage'] in ['共同住宅','店舗等併用共同住宅','店舗等併用住宅','商業施設','商業系複合施設','業務施設','住宅']]
            if candidates:
                nearby=list(source_buildings(buildings,band,bounds));shapes=[b['shape'] for b in nearby];tree=STRtree(shapes)
                ground=list(source_ground(surfaces,codes,band,bounds));roads=union_all([shape for _,_,shape,kind in ground if kind=='道路用地']);water=union_all([shape for _,_,shape,kind in ground if kind=='水面']);public=union_all([roads,water])
                for row in candidates:
                    for w in row['walls']:
                        stats['walls']+=1
                        if not args.reuse_clearance:
                            w['projectionClearance']=0
                            for depth in [1.12,.66]:
                                area=projection(w,depth)
                                blocked=area.intersects(public) or any(area.intersects(shapes[i]) for i in tree.query(area))
                                if not blocked and box(*band['bounds']).covers(area):w['projectionClearance']=depth;break
                        elif w.get('projectionClearance',0)>0:
                            area=projection(w,w['projectionClearance'])
                            if any(nearby[i]['id']==row['id'] and area.intersects(shapes[i]) for i in tree.query(area)):w['projectionClearance']=0
                        stats['certified' if w['projectionClearance']>=1 else 'blocked']+=1
                    if row['walls']:
                        w=min(row['walls'],key=lambda w:w['roadDistance']-min(w['length'],18)*.08)
                        if w['roadDistance']<8 and max(w['ground'])-min(w['ground'])<.65:
                            entry_access(row,w,roads,water,nearby,shapes,tree,grid)
                            if 'entryAccess' in w:stats['aprons']=stats.get('aprons',0)+1
            blob=json.dumps(data,ensure_ascii=False,separators=(',',':')).encode();target.write_bytes(gzip.compress(blob,compresslevel=5,mtime=0))
            site.update(path=str(target.relative_to(d)),bytes=len(blob),decodedBytes=len(blob),sha256=hashlib.sha256(blob).hexdigest())
            stats['sites']+=1
            if stats['sites']%200==0:print(name,stats,round(time.monotonic()-start,1),flush=True)
        manifest['lifeVersion']=1;(out/(name+'.json')).write_text(json.dumps(manifest,separators=(',',':')))
        print(name,stats,flush=True)
    audit['ready']=True;audit['seconds']=time.monotonic()-start;(out/'clearance-audit.json').write_text(json.dumps(audit,indent=2));print(audit,flush=True)

if __name__=='__main__':main()
