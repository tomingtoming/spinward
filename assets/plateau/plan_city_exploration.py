"""Build connected walking branches across the imported city; retain the accepted tour."""
import argparse,json,math
from collections import deque
from pathlib import Path
import numpy as np
from shapely import union_all,contains_xy
from shapely.geometry import Polygon,LineString,Point
from shapely.prepared import prep
from plan_exploration import astar
from prepare_walk_tiles import ground

def main(root):
 d=root/'derived';read=lambda f:json.loads((d/f).read_text());study=read('study.json');s=study['samples'][0];w=read(s['walk']);tour=read('exploration.json')
 roads=union_all([Polygon(p['rings'][0],p['rings'][1:]) for p in w['roads']+w.get('pavements',[])])
 obstacles=union_all([Polygon(p['rings'][0],p['rings'][1:]) for p in w['buildings']+w['water']+w.get('obstacles',[])])
 domain=roads.buffer(-.4).difference(obstacles.buffer(.4));prepared=prep(domain);step=2.;axis=np.arange(-s['half']+2,s['half'],step);xx,yy=np.meshgrid(axis,axis);mask=contains_xy(domain,xx,yy);valid=np.column_stack(np.nonzero(mask));del xx,yy
 def nearest(point):
  dist=(axis[valid[:,1]]-point[0])**2+(axis[valid[:,0]]-point[1])**2;j,i=valid[int(np.argmin(dist))];return int(i),int(j)
 start=nearest(w['arrival']['spawn'])
 # A road polygon can be an isolated driveway. Pick a destination on the
 # component reachable from home, not just the closest grey patch on the map.
 connected=np.zeros_like(mask);queue=deque([start]);connected[start[1],start[0]]=True
 while queue:
  i,j=queue.popleft()
  for x,y in [(i+1,j),(i-1,j),(i,j+1),(i,j-1)]:
   if 0<=x<len(axis) and 0<=y<len(axis) and mask[y,x] and not connected[y,x]:connected[y,x]=True;queue.append((x,y))
 mask=connected;valid=np.column_stack(np.nonzero(mask));angle=s['frame']['angle'];east=np.array([math.sin(angle),math.cos(angle)]);north=np.array([-math.cos(angle),math.sin(angle)])
 directions=[('east','東の街区',east*1100),('west','西の街区',-east*1100),('north','北の街区',north*1100),('south','南の街区',-north*1100),('north-east','北東の街区',(north+east)*900),('north-west','北西の街区',(north-east)*900),('south-east','南東の街区',(-north+east)*900),('south-west','南西の街区',(-north-east)*900)]
 destinations=[dict(id='home',label='東高円寺',point=w['arrival']['spawn'],ground=ground(w,*w['arrival']['spawn']),yaw=w['arrival']['yaw'],points=[w['arrival']['spawn']],length=0)];branches=[]
 for id,label,target in directions:
  end=nearest(target);raw=astar(mask,start,end,step);points=[(float(axis[i]),float(axis[j])) for i,j in raw];simple=[points[0]];i=0
  while i<len(points)-1:
   far=i+1
   for j in range(i+2,min(len(points),i+61)):
    if prepared.covers(LineString([points[i],points[j]])):far=j
   simple.append(points[far]);i=far
  point=simple[-1];length=sum(math.dist(a,b) for a,b in zip(simple,simple[1:]));yaw=math.atan2(-(point[0]-simple[-2][0]),point[1]-simple[-2][1])
  row=dict(id=id,label=label,point=point,ground=ground(w,*point),yaw=yaw,points=simple,length=length);destinations.append(row);branches.append(row);print(label,round(length,1),'m',len(simple),'points',flush=True)
 # Existing destinations are on the accepted tour; their prefix can be followed back home.
 line=LineString(tour['points'])
 for stop in tour['stops'][1:]:
  target=Point(*stop['point']);along=line.project(target);points=[tour['points'][0]];distance=0
  for a,b in zip(tour['points'],tour['points'][1:]):
   segment=math.dist(a,b)
   if distance+segment>=along:points.append(stop['point']);break
   points.append(b);distance+=segment
  destinations.append(dict(id='tour-'+stop['id'],label=stop['label'],point=stop['point'],ground=ground(w,*stop['point']),yaw=stop['yaw'],points=points,length=along))
 # Compact source road polygons for a 2D map; this is not the collision payload.
 road_map=[]
 for polygon in (roads.geoms if hasattr(roads,'geoms') else [roads]):
  simple=polygon.simplify(1.2,preserve_topology=True)
  road_map.append([[[round(x,1),round(y,1)] for x,y in ring.coords] for ring in [simple.exterior,*simple.interiors]])
 # Node intersections of verified routes for lightweight shortest-route guidance.
 network_lines=union_all([LineString(v['points']) for v in destinations if len(v['points'])>1]+[line]);nodes=[];lookup={};edges=[]
 def node(point):
  key=tuple(round(float(v),3) for v in point)
  if key not in lookup:lookup[key]=len(nodes);nodes.append(list(key))
  return lookup[key]
 for part in network_lines.geoms:
  points=list(part.coords)
  for a,b in zip(points,points[1:]):
   first,last=node(a),node(b)
   if first!=last:edges.append([first,last,math.dist(nodes[first],nodes[last])])
 for destination in destinations:
  key=tuple(round(float(v),3) for v in destination['point']);assert key in lookup,key;destination['node']=lookup[key]
 result=dict(version=1,network=dict(nodes=nodes,edges=edges),origin='ai',created='2026-09-23',region='tokyo',half=s['half'],north=north.tolist(),destinations=destinations,tour=dict(points=tour['points'],length=tour['length']),mapRoads=road_map,coverage=dict(sourceRoadAreaM2=roads.area,walkableRasterCells=len(valid),gridM=step,branches=len(branches),branchMetres=sum(p['length'] for p in branches)))
 (d/'city-exploration.json').write_text(json.dumps(result,ensure_ascii=False,separators=(',',':')));s['navigation']='city-exploration.json';(d/'study.json').write_text(json.dumps(study,ensure_ascii=False));print(json.dumps(result['coverage']),flush=True)
if __name__=='__main__':
 p=argparse.ArgumentParser();p.add_argument('--root',type=Path,required=True);main(p.parse_args().root)
