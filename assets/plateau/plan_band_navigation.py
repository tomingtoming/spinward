"""Connect real stations to source roads and then to the colony's outer network."""
import argparse,json,math,hashlib
from collections import deque
from pathlib import Path
import numpy as np
from shapely import union_all,contains_xy,buffer,from_wkb,to_wkb
from shapely.geometry import Polygon,LineString,Point,box
from shapely.prepared import prep
from shapely.strtree import STRtree
from source_route_grid import astar,edges_for,connected
from prepare_walk_tiles import ground
from prepare_walk import rings
from assemble import Terrain,Frame,Mesh,polygon_parts


def simplify_route(points,domain):
    prepared=prep(domain);simple=[points[0]];i=0
    while i<len(points)-1:
        far=i+1
        for j in range(i+2,min(len(points),i+61)):
            if prepared.covers(LineString([points[i],points[j]])):far=j
        assert prepared.covers(LineString([points[i],points[far]])),'Raster route crossed source obstruction'
        simple.append(points[far]);i=far
    return simple


def source_routes(root,region=None):
    d=root/'derived';study=json.loads((d/'study.json').read_text());imports=json.loads((root/'imports.json').read_text());plan=json.loads((root/'band-source-plan.json').read_text());report=[]
    for s,imp,band in zip(study['samples'],imports['samples'],plan['bands']):
        if region and s['id']!=region:continue
        w=json.loads((d/s['walk']).read_text());bounds=w['bounds'];cx,cy=s['anchor']['local'];step=2
        roads=union_all([Polygon(p['rings'][0],p['rings'][1:]) for p in w['roads']+w.get('pavements',[]) if p.get('design')!='band-connector'])
        obstacles=[Polygon(p['rings'][0],p['rings'][1:]) for p in w['buildings']+w['water']+w.get('obstacles',[])];obstacle_tree=STRtree(obstacles)
        signature=hashlib.sha256((d/s['walk']).read_bytes()).hexdigest();domain_cache=root/f'{s["id"]}-route-domain.wkb';signature_file=root/f'{s["id"]}-route-domain.sha256'
        if domain_cache.exists() and signature_file.read_text()==signature:domain=from_wkb(domain_cache.read_bytes())
        else:
            print(s['id'],'building road domain',flush=True)
            domain=roads.buffer(-.43).difference(union_all(buffer(obstacles,.45,quad_segs=8)))
            domain_cache.write_bytes(to_wkb(domain));signature_file.write_text(signature)
        xs=np.arange(bounds[0]+2,bounds[2],step);ys=np.arange(bounds[1]+2,bounds[3],step)
        xx,yy=np.meshgrid(xs,ys);mask=contains_xy(domain,xx,yy);del xx,yy
        valid=np.column_stack(np.nonzero(mask))
        def nearest(point):
            dist=(xs[valid[:,1]]-point[0])**2+(ys[valid[:,0]]-point[1])**2;j,i=valid[int(np.argmin(dist))];return int(i),int(j)
        def xy(node):return [float(xs[node[0]]),float(ys[node[1]])]
        start=nearest(w['arrival']['spawn']);cache=root/f'{s["id"]}-route-grid.npz';signature=hashlib.sha256((d/s['walk']).read_bytes()).hexdigest()
        cached=np.load(cache) if cache.exists() else None
        if cached is not None and str(cached['signature'])==signature:edges=cached['edges']
        else:
            print(s['id'],'checking',len(valid),'road-grid points and their actual connecting segments',flush=True)
            edges=edges_for(domain,mask,xs,ys);np.savez_compressed(cache,signature=signature,edges=edges)
        mask=connected(edges,start);valid=np.column_stack(np.nonzero(mask));print(s['id'],'connected road cells',len(valid),flush=True)
        home=w['arrival']['spawn'];destinations=[dict(id='home',label=s['station'],point=home,ground=ground(w,*home),yaw=w['arrival']['yaw'],provenance='PLATEAUの道路上')];routes=[];connectors=[];offsets=[]
        def path_to(end):
            raw=astar(edges,start,end,step) if end!=start else [start]
            pts=[home]+[xy(p) for p in raw if xy(p)!=home]
            return simplify_route(pts,domain) if len(pts)>1 else pts
        for station in band['stations']:
            if station['name']==s['station']:continue
            target=[station['local'][0]-cx,station['local'][1]-cy];end=nearest(target);point=xy(end);offset=math.dist(point,target)
            if offset>240:raise ValueError(f'{s["id"]} {station["name"]}: connected road is {offset:.1f} m away; investigate rather than relabel')
            route=path_to(end);routes.append(route);yaw=math.atan2(-(target[0]-point[0]),target[1]-point[1])
            destinations.append(dict(id='station-'+station['name'],label=station['name']+'周辺',point=point,ground=ground(w,*point),yaw=yaw,provenance='国土数値情報の駅近傍・PLATEAUの道路上',stationOffsetM=offset))
            offsets.append(dict(station=station['name'],metres=offset));print(s['id'],station['name'],round(offset,1),'m from station',flush=True)
        for side in [-1,1]:
            edge=bounds[0] if side<0 else bounds[2]
            vx=xs[valid[:,1]];vy=ys[valid[:,0]];score=np.abs(vx-edge)*20+np.abs(vy-home[1])*.1
            choice=valid[int(np.argmin(score))];end=(int(choice[1]),int(choice[0]));point=xy(end)
            nearby=box(min(point[0],edge)-2,point[1]-165,max(point[0],edge)+2,point[1]+165)
            local=[obstacles[int(i)] for i in obstacle_tree.query(nearby,predicate='intersects')]
            free=nearby.intersection(box(*bounds).buffer(-.5)).difference(union_all(buffer(local,.5,quad_segs=8)));prepared=prep(free)
            # Find a clear source-to-margin segment. No connector may cut through a building or water.
            choices=[]
            for dy in np.arange(-160,161,4):
                destination=[edge-side*.6,max(bounds[1]+1,min(bounds[3]-1,point[1]+dy))]
                line=LineString([point,destination])
                if prepared.covers(line):choices.append((line.length,destination))
            if not choices:raise ValueError('No clear band edge connector: '+s['id']+' '+str(side))
            edgepoint=min(choices)[1];outer=[side*1640-cx,edgepoint[1]];route=path_to(end);routes.append(route)
            connector=[point,edgepoint,outer];connectors.append(dict(id=f'connector-{side}',width=3,points=connector,provenance='Spinward designed path joining a source road to the band promenade'))
        if s.get('exploration'):
            tour=json.loads((d/s['exploration']).read_text());routes.append(tour['points'])
            for stop in tour['stops'][1:]:destinations.append(dict(id='tour-'+stop['id'],label=stop['label'],point=stop['point'],ground=ground(w,*stop['point']),yaw=stop['yaw'],provenance='受け入れ済み散策路'))
        f=imp['frame'];t=Terrain(root,imp,Frame(f['epsg'],f['origin'],f['angle']));mesh=Mesh()
        paving=union_all([LineString(c['points']).buffer(c['width']/2,cap_style=2,join_style=2) for c in connectors]).intersection(box(*bounds))
        near=[obstacles[int(i)] for i in obstacle_tree.query(paving.buffer(.2),predicate='intersects')]
        paving=paving.difference(union_all(buffer(near,.15,quad_segs=8)))
        for polygon in polygon_parts(paving):t.surface(polygon,mesh,.09)
        descriptor=dict(mesh.save(d/s['id'],'band-connectors'),material='#b5af99',path=s['id']+'/')
        s['meshes']=[m for m in s['meshes'] if m['name']!='band-connectors']+[descriptor]
        w['roads']=[p for p in w['roads'] if p.get('design')!='band-connector']+[dict(rings=rings(p),bounds=list(p.bounds),design='band-connector') for p in polygon_parts(paving)]
        (d/s['walk']).write_text(json.dumps(w,ensure_ascii=False,separators=(',',':')))
        result=dict(region=s['id'],routes=routes,connectors=connectors,destinations=destinations,sourceRoadGridM=step,reachableRoadCells=len(valid),stationOffsets=offsets)
        (root/f'{s["id"]}-band-routes.json').write_text(json.dumps(result,ensure_ascii=False,separators=(',',':')));report.append(dict(id=s['id'],reachableRoadCells=len(valid),stations=offsets,connectors=connectors))
        (d/'study.json').write_text(json.dumps(study,ensure_ascii=False));print(s['id'],'source routes complete',flush=True)
    (d/'study.json').write_text(json.dumps(study,ensure_ascii=False));(root/'band-route-audit.json').write_text(json.dumps(report,ensure_ascii=False,indent=2))


def finish(root):
    d=root/'derived';study=json.loads((d/'study.json').read_text())
    for s in study['samples']:
        source=json.loads((root/f'{s["id"]}-band-routes.json').read_text());outer=json.loads((d/s['bandLandscape']).read_text());w=json.loads((d/s['walk']).read_text())
        routes=source['routes']+[c['points'] for c in source['connectors']]+[r['points'] for r in outer['routes']]
        lines=union_all([LineString(route) for route in routes if len(route)>1]);nodes=[];lookup={};edges=[]
        destinations=source['destinations']+outer['destinations']
        def node(point):
            key=tuple(round(float(v),3) for v in point)
            if key not in lookup:lookup[key]=len(nodes);nodes.append(list(key))
            return lookup[key]
        for line in lines.geoms:
            points=list(line.coords)
            for a,b in zip(points,points[1:]):
                # A stop can be interpolated along a route rather than already
                # being a vertex. Split that real segment; never add a shortcut.
                dx,dy=b[0]-a[0],b[1]-a[1];length2=dx*dx+dy*dy;parts=[(0,a),(1,b)]
                for destination in destinations:
                    p=destination['point'];t=((p[0]-a[0])*dx+(p[1]-a[1])*dy)/length2
                    if 0<t<1 and math.hypot(p[0]-a[0]-t*dx,p[1]-a[1]-t*dy)<1e-5:parts.append((t,p))
                parts.sort(key=lambda p:p[0])
                for (_,u),(_,v) in zip(parts,parts[1:]):
                    i,j=node(u),node(v)
                    if i!=j:edges.append([i,j,math.dist(nodes[i],nodes[j])])
        destinations=source['destinations']+outer['destinations']
        for destination in destinations:
            key=tuple(round(float(v),3) for v in destination['point']);assert key in lookup,(s['id'],destination['id'],key)
            destination['node']=lookup[key]
        adjacency=[[] for p in nodes]
        for a,b,_ in edges:adjacency[a].append(b);adjacency[b].append(a)
        seen={destinations[0]['node']};todo=list(seen)
        while todo:
            for n in adjacency[todo.pop()]:
                if n not in seen:seen.add(n);todo.append(n)
        assert all(d['node'] in seen for d in destinations),'Disconnected destination graph'
        roads=union_all([Polygon(p['rings'][0],p['rings'][1:]) for p in w['roads']+w.get('pavements',[])+outer['roads']]);map_tiles=[];bounds=outer['bounds']
        for i in range(math.floor(bounds[0]/1000),math.ceil(bounds[2]/1000)):
            for j in range(math.floor(bounds[1]/1000),math.ceil(bounds[3]/1000)):
                clip=box(i*1000,j*1000,(i+1)*1000,(j+1)*1000);polys=[]
                for p in polygon_parts(roads.intersection(clip)):
                    simple=p.simplify(1.2,preserve_topology=True);polys.append([[[round(x,1),round(y,1)] for x,y in ring] for ring in rings(simple)])
                if polys:map_tiles.append(dict(id=f'{i},{j}',bounds=list(clip.bounds),roads=polys))
        a=s['frame']['angle'];result=dict(version=2,origin='ai',created='2026-09-23',region=s['id'],bounds=bounds,half=s['half'],north=[-math.cos(a),math.sin(a)],network=dict(nodes=nodes,edges=edges),destinations=destinations,mapTiles=map_tiles,zones=outer['zones'])
        name=s['id']+'/band-navigation.json';(d/name).write_text(json.dumps(result,ensure_ascii=False,separators=(',',':')));s['navigation']=name
        print(s['id'],'navigation',len(destinations),'destinations',len(nodes),'nodes',len(map_tiles),'map tiles',flush=True)
    (d/'study.json').write_text(json.dumps(study,ensure_ascii=False))


if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--root',type=Path,required=True);p.add_argument('--phase',choices=['source','finish'],required=True);p.add_argument('--region');a=p.parse_args()
    if a.phase=='source':source_routes(a.root,a.region)
    else:finish(a.root)
