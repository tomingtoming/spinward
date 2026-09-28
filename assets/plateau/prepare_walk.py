"""Derive ground contacts and bounded walking data without moving source buildings."""
import argparse
import collections
import json
import math
from pathlib import Path
import numpy as np
from shapely import union_all, contains_xy, set_precision
from shapely.geometry import Polygon, Point, LineString
from shapely.prepared import prep
from assemble import Mesh, Terrain, Frame, polygon_parts


def read_mesh(root,sample,name):
    m=next(m for m in sample['meshes'] if m['name']==name)
    p=np.fromfile(root/'derived'/m['path']/m['positions'],dtype='<f4').reshape(-1,3)
    i=np.fromfile(root/'derived'/m['path']/m['indices'],dtype='<u4').reshape(-1,3)
    return p,i


def footprint(p,indices):
    triangles=p[indices][:,:,:2].astype(float)
    area=np.abs((triangles[:,1,0]-triangles[:,0,0])*(triangles[:,2,1]-triangles[:,0,1])-
                (triangles[:,1,1]-triangles[:,0,1])*(triangles[:,2,0]-triangles[:,0,0]))
    # Sub-millimetre projection noise from vertical walls must not create invalid slivers.
    polys=[Polygon(t) for t in triangles[area>.0001]]
    return union_all(polys,grid_size=.002)


def rings(poly):
    return [list(poly.exterior.coords)]+[list(r.coords) for r in poly.interiors]


def choose_route(roads,blocked,water):
    domain=roads.buffer(-.75).difference(blocked.buffer(.6)).difference(water.buffer(.5))
    prepared=prep(domain);axis=np.arange(-160,164,4)
    xx,yy=np.meshgrid(axis,axis);mask=contains_xy(domain,xx,yy);points={}
    for j,i in zip(*np.nonzero(mask)):points[(int(i),int(j))]=(float(axis[i]),float(axis[j]))
    assert points,'No source road available for a safe arrival'
    # Prefer the near-station connected component that supports a meaningful walk.
    for start in sorted(points,key=lambda k:points[k][0]**2+points[k][1]**2):
        seen={start:None};queue=collections.deque([start]);end=None
        while queue:
            a=queue.popleft()
            if math.dist(points[a],points[start])>=65:end=a;break
            for di,dj in [(1,0),(-1,0),(0,1),(0,-1),(1,1),(1,-1),(-1,1),(-1,-1)]:
                b=(a[0]+di,a[1]+dj)
                if b not in points or b in seen:continue
                if not prepared.covers(LineString([points[a],points[b]])):continue
                seen[b]=a;queue.append(b)
        if end:
            path=[]
            while end is not None:path.append(points[end]);end=seen[end]
            path.reverse();simple=[path[0]];index=0
            while index<len(path)-1:
                far=index+1
                for next_ in range(index+2,len(path)):
                    if prepared.covers(LineString([path[index],path[next_]])):far=next_
                simple.append(path[far]);index=far
            heading=math.atan2(-(simple[1][0]-simple[0][0]),simple[1][1]-simple[0][1])
            return dict(spawn=simple[0],yaw=heading,route=simple,length=sum(math.dist(a,b) for a,b in zip(simple,simple[1:])))
    raise ValueError('No connected 65m source-road route near this station')


def main(root,regions=None):
    report=json.loads((root/'derived/study.json').read_text());imports=json.loads((root/'imports.json').read_text())
    output=dict(origin='ai',created='2026-09-22',samples=[])
    previous=json.loads((root/'walking-adaptation.json').read_text()) if regions and (root/'walking-adaptation.json').exists() else {'samples':[]}
    for s,imp in zip(report['samples'],imports['samples']):
        if regions and s['id'] not in regions:
            output['samples'].extend(v for v in previous['samples'] if v['id']==s['id']);continue
        frame=Frame(imp['frame']['epsg'],imp['frame']['origin'],imp['frame']['angle']);t=Terrain(root,imp,frame)
        p,i=read_mesh(root,s,'buildings');features=json.loads((root/'derived'/s['features']).read_text())
        foundations=Mesh();colliders=[];polygons=[];raised=0;max_gap=0;roof_concerns=[]
        for f in features:
            indices=i[f['firstIndex']//3:(f['firstIndex']+f['indexCount'])//3]
            shape=footprint(p,indices);feature_points=p[np.unique(indices)];this_gap=0
            for part in polygon_parts(shape):
                if part.area<.03:continue
                # Disconnected parts of one GML building may have different foundation elevations.
                mask=contains_xy(part.buffer(.005),feature_points[:,0],feature_points[:,1])
                assert mask.any(),f['id']
                base=float(feature_points[mask,2].min());top=float(feature_points[mask,2].max());highest_ground=-math.inf
                polygons.append(part);rr=rings(part)
                colliders.append(dict(id=f['id'],rings=rr,bounds=list(part.bounds),base=base,top=top))
                for ring in rr:
                    for a,b in zip(ring,ring[1:]):
                        n=max(1,math.ceil(math.dist(a,b)/2))
                        for k in range(n):
                            v=np.array(a)+(np.array(b)-a)*k/n;w=np.array(a)+(np.array(b)-a)*(k+1)/n
                            za,zb=t.height(*v),t.height(*w);highest_ground=max(highest_ground,za,zb)
                            this_gap=max(this_gap,base-za,base-zb)
                            if max(base-za,base-zb)<.025:continue
                            # A separate retaining/foundation skirt: source footprint and height are unchanged.
                            lo_a=min(base-.015,za-.12);lo_b=min(base-.015,zb-.12)
                            foundations.add([[*v,base+.015],[*w,base+.015],[*w,lo_b],[*v,lo_a]],[0,1,2,0,2,3])
                if top-highest_ground<1:roof_concerns.append(dict(id=f['id'],roofAboveHighestGrade=top-highest_ground))
            if this_gap>.025:raised+=1
            max_gap=max(max_gap,this_gap)
        rp,ri=read_mesh(root,s,'roads');roads=footprint(rp,ri)
        water=Polygon()
        if any(m['name']=='water' for m in s['meshes']):
            wp,wi=read_mesh(root,s,'water');water=footprint(wp,wi)
        blocked=union_all(polygons,grid_size=.002);arrival=choose_route(roads,blocked,water)
        folder=root/'derived'/s['id'];mesh=dict(foundations.save(folder,'foundations'),material='#8d8d83',path=s['id']+'/')
        walk=dict(version=1,half=s['half'],bounds=t.bounds,terrainOrigin=t.bounds[:2],step=t.step,axis=t.axis.tolist(),yaxis=t.yaxis.tolist(),heights=t.z.tolist(),heightPatches=t.patches,buildings=colliders,
                  water=[dict(rings=rings(part),bounds=list(part.bounds)) for part in polygon_parts(water)],
                  roads=[dict(rings=rings(part),bounds=list(part.bounds)) for part in polygon_parts(roads)],arrival=arrival,
                  adaptation='Added separate foundation skirts; original buildings and terrain not translated',
                  audit=dict(buildingsWithAddedSkirt=raised,maxOriginalGapM=max_gap,roofConcerns=roof_concerns))
        (folder/'walk.json').write_text(json.dumps(walk,ensure_ascii=False,separators=(',',':')))
        s['meshes']=[m for m in s['meshes'] if m['name']!='foundations']+[mesh]
        s['walk']=s['id']+'/walk.json';output['samples'].append(dict(id=s['id'],**walk['audit'],arrival=arrival,foundationTriangles=mesh['triangles']))
        print(s['id'],len(colliders),'footprints, skirts',raised,'route',arrival,flush=True)
    (root/'derived/study.json').write_text(json.dumps(report,ensure_ascii=False,indent=2))
    (root/'walking-adaptation.json').write_text(json.dumps(output,ensure_ascii=False,indent=2))


if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--root',type=Path,required=True);p.add_argument('--region',action='append');args=p.parse_args();main(args.root,args.region)
