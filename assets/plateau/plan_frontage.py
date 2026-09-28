"""Design a bounded civilian frontage over immutable real building footprints.

Usage/footprint/height are source facts. Window layout, palette and paving are
Spinward design choices, not a reconstruction of present-day Higashi-koenji.
"""
import argparse,json,math,hashlib
from pathlib import Path
import numpy as np
from shapely import union_all,linestrings
from shapely.geometry import Polygon,Point,LineString,box
from shapely.geometry.polygon import orient
from shapely.prepared import prep
from shapely.strtree import STRtree
from assemble import Terrain,Frame,Mesh,polygon_parts
from prepare_walk import read_mesh,rings

def plan_buildings(w,features,p,idx,t,route=None,audit=None,station_ids=None):
    shapes=[Polygon(b['rings'][0],b['rings'][1:]) for b in w['buildings']]
    all_buildings=prep(union_all(shapes));building_index=STRtree(shapes);road_shapes=[Polygon(b['rings'][0],b['rings'][1:]) for b in w['roads']]
    # One connected city road polygon can contain half a million vertices.
    # Nearest distance to its indexed boundary segments is the same geometric
    # query, without scanning that whole polygon for every facade wall.
    road_area=prep(union_all(road_shapes));segments=linestrings(np.asarray([list(pair) for road in w['roads'] for ring in road['rings'] for pair in zip(ring,ring[1:])]).reshape(-1,2,2));road_index=STRtree(segments)
    selected=[]
    for b,poly in zip(w['buildings'],shapes):
        # Station enrichment is an explicit, source-matched pass. Keep every
        # neighbour in the exposure mask without decorating it a second time.
        if station_ids is not None and b['id'] not in station_ids:continue
        f=features[b['id']];usage=f['usage'] or '不明'
        station=station_ids is not None and b['id'] in station_ids and usage=='運輸倉庫施設'
        reason=('outside-corridor' if route is not None and poly.distance(route)>29 else 'low-height' if b['top']-b['base']<4.5 else 'unknown-or-special-use' if usage in ['不明','その他','運輸倉庫施設'] and not station else 'small-footprint' if poly.area<18 else None)
        if reason:
            if audit is not None:audit.append(dict(id=b['id'],reason=reason,usage=usage))
            continue
        seed=int(hashlib.sha256(b['id'].encode()).hexdigest()[:8],16)
        tri=idx[f['firstIndex']//3:(f['firstIndex']+f['indexCount'])//3];vertices=p[np.unique(tri)]
        walls=[]
        for ring in [orient(poly.simplify(.04),sign=1).exterior]:
            rr=list(ring.coords)
            for a,bb in zip(rr,rr[1:]):
                a=np.array(a);bb=np.array(bb);delta=bb-a;length=float(np.linalg.norm(delta))
                if length<2.4:continue
                u=delta/length;normal=np.array([u[1],-u[0]]);mid=(a+bb)/2
                # An attached neighbour must not acquire windows through its party wall.
                samples=[Point(*(a+delta*v+normal*.6)) for v in [.2,.5,.8]]
                free=[not all_buildings.contains(point) for point in samples]
                exposure_base=-math.inf
                if not all(free):
                    if not station:continue
                    neighbours={int(i) for point in samples for i in building_index.query(point) if shapes[i].contains(point)}
                    if any(w['buildings'][i]['id']==b['id'] for i in neighbours):continue
                    # A low attached podium hides only the lower station wall.
                    # Keep the conservative maximum across the whole facade.
                    exposure_base=max(w['buildings'][i]['top'] for i in neighbours)+.20
                dist=np.abs((vertices[:,0]-a[0])*normal[0]+(vertices[:,1]-a[1])*normal[1])
                along=(vertices[:,0]-a[0])*u[0]+(vertices[:,1]-a[1])*u[1]
                vv=vertices[(dist<.08)&(along>=-.08)&(along<=length+.08)]
                if len(vv)<3:continue
                base,top=max(float(vv[:,2].min()),exposure_base),float(vv[:,2].max())
                if top-base<4.5:continue
                ground=[t.height(*(a+delta*v)) for v in [0,.5,1]]
                walls.append(dict(a=a.tolist(),b=bb.tolist(),normal=normal.tolist(),length=length,
                                  base=base,top=top,ground=ground,roadDistance=0 if road_area.covers(Point(*mid)) else segments[int(road_index.nearest(Point(*mid)))].distance(Point(*mid)) if len(segments) else 999))
        if walls:selected.append(dict(id=b['id'],usage=usage,seed=seed,walls=walls))
        if audit is not None:audit.append(dict(id=b['id'],reason='applied' if walls else 'no-eligible-exposed-wall',usage=usage,walls=len(walls)))
    return selected

def main(root):
    study=json.loads((root/'derived/study.json').read_text());s=study['samples'][0]
    imp=json.loads((root/'imports.json').read_text())['samples'][0]
    fr=imp['frame'];t=Terrain(root,imp,Frame(fr['epsg'],fr['origin'],fr['angle']))
    folder=root/'derived/tokyo';w=json.loads((folder/'walk.json').read_text())
    features={f['id']:f for f in json.loads((folder/'features.json').read_text())}
    p,idx=read_mesh(root,s,'buildings');route=LineString(w['arrival']['route'])
    shapes=[Polygon(b['rings'][0],b['rings'][1:]) for b in w['buildings']]
    all_buildings=union_all(shapes);roads=union_all([Polygon(b['rings'][0],b['rings'][1:]) for b in w['roads']])
    selected=plan_buildings(w,features,p,idx,t,route)
    # Designed raised footways inside the imported wide-road surface; not claimed as source LOD2.
    area=route.buffer(45,cap_style=2).buffer(16)
    wide=roads.buffer(-4).buffer(4)
    # Meet the imported road edge: the previous 15–20 cm inset left an unintended asphalt slit by shop fronts.
    paving=roads.buffer(-.015).difference(roads.buffer(-1.85)).intersection(wide.buffer(.20)).intersection(area).difference(all_buildings.buffer(.025))
    paving=union_all([a for a in polygon_parts(paving) if a.area>3])
    mesh=Mesh();kerb=Mesh();pavements=[]
    for part in polygon_parts(paving):
        t.surface(part,mesh,.20);pavements.append(dict(rings=rings(part),bounds=list(part.bounds)))
        for rr in rings(part):
            for a,b in zip(rr,rr[1:]):
                count=max(1,math.ceil(math.dist(a,b)/1.0))
                for i in range(count):
                    v=np.array(a)+(np.array(b)-a)*i/count;z=np.array(a)+(np.array(b)-a)*(i+1)/count
                    h1,h2=t.height(*v),t.height(*z)
                    kerb.add([[*v,h1+.085],[*z,h2+.085],[*z,h2+.20],[*v,h1+.20]],[0,1,2,0,2,3])
    s['meshes']=[m for m in s['meshes'] if m['name'] not in ['footways','kerbs']]
    for name,m,color in [('footways',mesh,'#b9b1a2'),('kerbs',kerb,'#99988f')]:
        if m.indices:s['meshes'].append(dict(m.save(folder,name),material=color,path='tokyo/',solid=True))
    # A straight validation walk entirely inside the new pavement, with body clearance.
    direction=np.array(w['arrival']['route'][1])-w['arrival']['route'][0];direction=direction/np.linalg.norm(direction)
    normal=np.array([-direction[1],direction[0]]);walkable=paving.buffer(-.36).difference(all_buildings.buffer(.4))
    candidates=[]
    for offset in np.arange(-35,35,.25):
        for degrees in [-10,-5,0,5,10]:
            angle=math.radians(degrees);c,sn=math.cos(angle),math.sin(angle)
            d=np.array([direction[0]*c-direction[1]*sn,direction[0]*sn+direction[1]*c])
            line=LineString([d*-12+normal*offset,d*110+normal*offset])
            cut=line.intersection(walkable)
            parts=list(cut.geoms) if hasattr(cut,'geoms') else [cut]
            for part in parts:
                if part.geom_type=='LineString' and part.length>16:candidates.append(part)
    assert candidates,'A continuous 16m footway route is required'
    path=min(candidates,key=lambda l:Point(l.coords[0]).distance(Point(0,0)))
    start=np.array(path.interpolate(.25).coords[0]);end=np.array(path.interpolate(15).coords[0])
    w['pavementRoute']=[start.tolist(),end.tolist()]
    w['pavements']=pavements;(folder/'walk.json').write_text(json.dumps(w,ensure_ascii=False,separators=(',',':')))
    plan=dict(origin='ai',created='2026-09-22',region='tokyo',source='PLATEAU usage, footprint and height; source geometry unchanged',
              design='Spinward facade and footway design; not surveyed architecture',reference='GQuuuuuuX episode 05 frame 0041: varied frontage widths and depths; no text/combat props copied',
              buildings=selected,buildingIds=sorted(set(b['id'] for b in selected)),footwayAreaM2=paving.area)
    (root/'frontage-plan.json').write_text(json.dumps(plan,ensure_ascii=False,indent=2))
    s['frontage']='tokyo/frontage.json';(root/'derived/study.json').write_text(json.dumps(study,ensure_ascii=False,indent=2))
    print(len(plan['buildingIds']),'buildings;',len(selected),'parts;',sum(len(b['walls']) for b in selected),'exposed walls;',paving.area,'m2 footways')

if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--root',type=Path,required=True);main(p.parse_args().root)
