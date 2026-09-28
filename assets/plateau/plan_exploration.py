"""Find an actual continuous public-road walk, with a sourced park destination."""
import argparse,heapq,json,math
from pathlib import Path
import numpy as np
from shapely import union_all,contains_xy
from shapely.geometry import Polygon,LineString,Point
from shapely.prepared import prep
from geo import Frame
from assemble import Mesh,Terrain,polygon_parts
from prepare_walk import rings

def astar(mask,start,end,step):
    rows,cols=mask.shape;total=rows*cols;cost=np.full(total,np.inf);previous=np.full(total,-1,dtype=np.int32)
    a=start[1]*cols+start[0];goal=end[1]*cols+end[0];cost[a]=0;queue=[(0.,a)]
    offsets=[(1,0,1.),(-1,0,1.),(0,1,1.),(0,-1,1.),(1,1,math.sqrt(2)),(1,-1,math.sqrt(2)),(-1,1,math.sqrt(2)),(-1,-1,math.sqrt(2))]
    closed=np.zeros(total,dtype=bool)
    while queue:
        _,a=heapq.heappop(queue)
        if closed[a]:continue
        if a==goal:break
        closed[a]=True;x=a%cols;y=a//cols
        for dx,dy,d in offsets:
            nx=x+dx;ny=y+dy
            if nx<0 or nx>=cols or ny<0 or ny>=rows or not mask[ny,nx]:continue
            if dx and dy and (not mask[y,nx] or not mask[ny,x]):continue
            b=ny*cols+nx;candidate=cost[a]+d*step
            if candidate>=cost[b]:continue
            cost[b]=candidate;previous[b]=a;heapq.heappush(queue,(candidate+math.hypot(nx-end[0],ny-end[1])*step,b))
    if previous[goal]<0:raise ValueError(f'No connected public route {start} -> {end}')
    out=[];a=goal
    while a>=0:out.append((a%cols,a//cols));a=int(previous[a])
    return out[::-1]

def main(root,reference,accepted_tour=None):
    study=json.loads((root/'derived/study.json').read_text());s=study['samples'][0];w=json.loads((root/'derived'/s['walk']).read_text());imp=json.loads((root/'imports.json').read_text())['samples'][0];fr=imp['frame'];f=Frame(fr['epsg'],fr['origin'],fr['angle']);t=Terrain(root,imp,f);cx,cy=imp['anchor']['local']
    native=lambda row:[f.place(row['lon'],row['lat'])[0]-cx,f.place(row['lon'],row['lat'])[1]-cy]
    source=json.loads((root/'raw/parks-osm.json').read_text())['elements'][0];park=Polygon([native(v) for v in source['geometry']])
    paths=json.loads((root/'raw/park-paths-osm.json').read_text())['elements'];park_paths=union_all([LineString([native(v) for v in p['geometry']]).buffer(1.15,cap_style=2,join_style=2) for p in paths]).intersection(park.buffer(2))
    buildings=union_all([Polygon(b['rings'][0],b['rings'][1:]) for b in w['buildings']]);water=union_all([Polygon(b['rings'][0],b['rings'][1:]) for b in w['water']]);roads=union_all([Polygon(b['rings'][0],b['rings'][1:]) for b in w['roads']])
    park_paths=park_paths.difference(buildings.buffer(.45)).difference(water.buffer(.5))
    # OSM supplies a boundary and path centrelines. Path width and landscape finish are Spinward design.
    grass=park.difference(roads.buffer(.03)).difference(park_paths).difference(buildings.buffer(.08)).difference(water)
    for name,shape,offset,colour in [('park-lawn',grass,.045,'#94a77c'),('park-path',park_paths,.20,'#b9b1a2')]:
        mesh=Mesh()
        for part in polygon_parts(shape):t.surface(part,mesh,offset)
        descriptor=dict(mesh.save(root/'derived/tokyo',name),material=colour,path='tokyo/',solid=True)
        s['meshes']=[m for m in s['meshes'] if m['name']!=name]+[descriptor]
    w['pavements']=[p for p in w.get('pavements',[]) if p.get('design')!='park-path']+[dict(rings=rings(p),bounds=list(p.bounds),design='park-path') for p in polygon_parts(park_paths)]
    domain=roads.buffer(-.43).union(park_paths.buffer(-.36)).difference(buildings.buffer(.43)).difference(water.buffer(.45))
    prepared=prep(domain);step=1.;xs=np.arange(-350,901,step);ys=np.arange(-120,1251,step);xx,yy=np.meshgrid(xs,ys);mask=contains_xy(domain,xx,yy);valid=np.column_stack(np.nonzero(mask))
    def nearest(point):
        d=(xs[valid[:,1]]-point[0])**2+(ys[valid[:,0]]-point[1])**2;j,i=valid[int(np.argmin(d))];return (int(i),int(j))
    stations=json.loads((reference/'N02-25_Station.geojson').read_text())['features'];station=next(v for v in stations if v['properties']['N02_005']=='高円寺')
    coords=np.array(station['geometry']['coordinates']).mean(0);sx,sy=f.place(*coords);south=[sx-cx-45,sy-cy]
    destinations=[('arrival','東高円寺',w['arrival']['spawn']),('residential','住宅街',[450,250]),('station','高円寺駅前',south),('shops','商業通り',[100,820]),('park','蚕糸の森公園',[-75,115])]
    nodes=[nearest(p) for _,_,p in destinations];full=[];stops=[];distance=0.;segments=[]
    for k in range(len(nodes)-1):
        raw=astar(mask,nodes[k],nodes[k+1],step);points=[(float(xs[i]),float(ys[j])) for i,j in raw]
        # Keep corners only where a direct segment would leave the public surface.
        simple=[points[0]];i=0
        while i<len(points)-1:
            far=i+1
            for j in range(i+2,min(len(points),i+121)):
                if prepared.covers(LineString([points[i],points[j]])):far=j
            simple.append(points[far]);i=far
        length=sum(math.dist(a,b) for a,b in zip(simple,simple[1:]));segments.append(dict(fromId=destinations[k][0],toId=destinations[k+1][0],length=length,points=simple))
        if not full:full.extend(simple)
        else:full.extend(simple[1:])
        distance+=length
        print('route leg',destinations[k+1][1],round(length,1),'m',flush=True)
    route=LineString(full)
    if not 2000<=route.length<=3000:raise ValueError(f'Route outside milestone length: {route.length}')
    assert any(abs(x)>700 or abs(y)>700 for x,y in full),'Route must enter the newly imported neighbourhood'
    for k,(id,label,_) in enumerate(destinations):
        i,j=nodes[k];point=[float(xs[i]),float(ys[j])];after=segments[min(k,len(segments)-1)]['points'][1] if k<len(segments) else segments[-1]['points'][-2]
        stops.append(dict(id=id,label=label,point=point,yaw=math.atan2(-(after[0]-point[0]),after[1]-point[1])))
    result=dict(origin='ai',created='2026-09-23',region='tokyo',length=route.length,points=full,segments=segments,stops=stops,park=dict(osmWay=source['id'],rings=rings(park),bounds=list(park.bounds),areaM2=park.area,official='https://www.city.suginami.tokyo.jp/s100/shisetsu/14821.html'),design='Source road polygons, N02 station, OSM park boundary/path; Spinward path width and landscape finish')
    if accepted_tour:
        # Rebuilding terrain must not choose a different equal-cost street route
        # or discard established landmark ground heights.
        result=json.loads((accepted_tour/'derived/exploration.json').read_text())
    (root/'derived/exploration.json').write_text(json.dumps(result,ensure_ascii=False,indent=2));s['exploration']='exploration.json'
    (root/'derived'/s['walk']).write_text(json.dumps(w,ensure_ascii=False,separators=(',',':')));(root/'derived/study.json').write_text(json.dumps(study,ensure_ascii=False,indent=2))
    print('CONTINUOUS ROUTE',result['length'],'m,',len(result['points']),'control points',flush=True)

if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--root',type=Path,required=True);p.add_argument('--reference',type=Path,required=True);p.add_argument('--accepted-tour',type=Path);a=p.parse_args();main(a.root,a.reference,a.accepted_tour)
