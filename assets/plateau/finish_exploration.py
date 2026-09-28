"""Civilian park planting and a source-use-backed commercial viewpoint.

Planting positions/species are Spinward design, not a survey of this park.
"""
import json,math,random,argparse
from pathlib import Path
from shapely import union_all
from shapely.geometry import Polygon,LineString,Point
from shapely.strtree import STRtree
from assemble import Mesh,Terrain,Frame,polygon_parts
from prepare_walk import rings
from prepare_walk_tiles import ground

def main(root):
    d=root/'derived';read=lambda v:json.loads((d/v).read_text());study=read('study.json');s=study['samples'][0];w=read(s['walk']);r=read('exploration.json');imp=json.loads((root/'imports.json').read_text())['samples'][0];f=imp['frame'];t=Terrain(root,imp,Frame(f['epsg'],f['origin'],f['angle']))
    features={f['id']:f for f in read(s['features'])};shops=[Polygon(b['rings'][0],b['rings'][1:]) for b in w['buildings'] if '店舗' in (features[b['id']]['usage'] or '') or features[b['id']]['usage']=='商業施設'];tree=STRtree(shops)
    path=LineString(r['segments'][2]['points']+r['segments'][3]['points'][1:]);scores=[]
    for distance in range(150,int(path.length)-150,10):
        point=path.interpolate(distance);scores.append((len(tree.query(point.buffer(35),predicate='intersects')),distance,point))
    count,distance,point=max(scores,key=lambda p:(p[0],-p[1]));after=path.interpolate(distance+8);stop=next(s for s in r['stops'] if s['id']=='shops');stop.update(point=list(point.coords[0]),yaw=math.atan2(-(after.x-point.x),after.y-point.y),ground=ground(w,point.x,point.y),nearbySourceRetailParts=count)
    park=Polygon(r['park']['rings'][0],r['park']['rings'][1:]);obstacles=union_all([Polygon(b['rings'][0],b['rings'][1:]) for b in w['buildings']+w['water']]);roads=union_all([Polygon(p['rings'][0],p['rings'][1:]) for p in w['roads']]);paths=union_all([Polygon(p['rings'][0],p['rings'][1:]) for p in w['pavements'] if p.get('design')=='park-path'])
    allowed=park.buffer(-3).difference(obstacles.buffer(4)).difference(roads.buffer(2.5)).difference(paths.buffer(2.1)).difference(LineString(r['points']).buffer(3))
    rng=random.Random(230923);positions=[];bounds=park.bounds
    for x in range(math.ceil(bounds[0]),math.floor(bounds[2]),11):
        for y in range(math.ceil(bounds[1]),math.floor(bounds[3]),11):
            px,py=x+rng.uniform(-3,3),y+rng.uniform(-3,3);pt=Point(px,py)
            if not allowed.contains(pt) or min(park.boundary.distance(pt),paths.distance(pt))>13:continue
            if any(math.hypot(px-a,py-b)<7 for a,b,*_ in positions):continue
            positions.append([px,py,t.height(px,py)+.035,rng.uniform(6.5,10),rng.uniform(2.2,3.1)])
    meshes={k:Mesh() for k in ['park-trunks','park-trees-0','park-trees-1','park-trees-2']};colliders=[]
    for i,(x,y,z,height,width) in enumerate(positions):
        trunk=meshes['park-trunks'];n=8;vertices=[[x+.17*math.cos(j*2*math.pi/n),y+.17*math.sin(j*2*math.pi/n),z+h] for h in [0,height*.58] for j in range(n)];indices=[]
        for j in range(n):k=(j+1)%n;indices.extend([j,k,k+n,j,k+n,j+n])
        trunk.add(vertices,indices);crown=meshes[f'park-trees-{i%3}'];vertices=[];indices=[];levels=5
        for lat in range(levels+1):
            angle=math.pi*lat/levels
            for j in range(n):a=j*2*math.pi/n;vertices.append([x+width*math.sin(angle)*math.cos(a),y+width*.87*math.sin(angle)*math.sin(a),z+height*.67+height*.33*math.cos(angle)])
        for lat in range(levels):
            for j in range(n):a=lat*n+j;b=lat*n+(j+1)%n;indices.extend([a,b,a+n,b,b+n,a+n])
        crown.add(vertices,indices);poly=Point(x,y).buffer(.18,quad_segs=2);colliders.append(dict(id=f'park-tree-{i}',rings=rings(poly),bounds=list(poly.bounds),design='park-planting'))
    colours={'park-trunks':'#726657','park-trees-0':'#667954','park-trees-1':'#788766','park-trees-2':'#5f755d'}
    for name,mesh in meshes.items():s['meshes']=[m for m in s['meshes'] if m['name']!=name]+[dict(mesh.save(d/'tokyo',name),material=colours[name],path='tokyo/',solid=True)]
    w['obstacles']=[b for b in w.get('obstacles',[]) if b.get('design')!='park-planting']+colliders;r['park']['designedTrees']=len(positions)
    for stop in r['stops']:stop['ground']=ground(w,*stop['point'])
    (d/'exploration.json').write_text(json.dumps(r,ensure_ascii=False));(d/s['walk']).write_text(json.dumps(w,ensure_ascii=False,separators=(',',':')));(d/'study.json').write_text(json.dumps(study,ensure_ascii=False))
    audit=dict(origin='ai',created='2026-09-23',trees=len(positions),treePositions=positions,sourceRetailPartsNearViewpoint=count,shopViewpoint=stop['point'],design='Spinward planting; excludes source roads, buildings, water and path clearance; trunk collision only')
    (root/'exploration-finish.json').write_text(json.dumps(audit,ensure_ascii=False,indent=2));print('trees',len(positions),'retail parts',count)
if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--root',type=Path,required=True);main(p.parse_args().root)
