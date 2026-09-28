"""Recover bridge/culvert crossings from actual road and water footprints.

The imported LOD1 road polygons inspected here have zero source elevations.
Deck heights are therefore explicit Spinward design: bank/DEM clearance with
smooth approaches, not claimed as surveyed bridge geometry. Source buildings,
terrain and road footprints remain unchanged.
"""
import argparse,json,math,hashlib
from pathlib import Path
import numpy as np
from shapely import union_all,constrained_delaunay_triangles
from shapely.geometry import Polygon,Point,box
from shapely.strtree import STRtree
from assemble import Mesh,polygon_parts
from prepare_walk import rings
from prepare_walk_tiles import terrain


def main(root):
    d=root/'derived';study=json.loads((d/'study.json').read_text());reports=[]
    for s in study['samples']:
        file=d/s['walk'];w=json.loads(file.read_text());source_hash=hashlib.sha256(file.read_bytes()).hexdigest()
        if 'sourceWater' not in w:w['sourceWater']=w['water'];w['bridgeSourceWalkSha256']=source_hash
        water=union_all([Polygon(p['rings'][0],p['rings'][1:]) for p in w['sourceWater']]);roads=union_all([Polygon(p['rings'][0],p['rings'][1:]) for p in w['roads'] if p.get('design')!='band-connector'])
        buildings=[Polygon(p['rings'][0],p['rings'][1:]) for p in w['buildings']];tree=STRtree(buildings)
        overlaps=roads.intersection(water);land=roads.difference(water);core=box(*w['bounds']);decks=Mesh();structure=Mesh();supports=[];crossings=[];cuts=[];skipped=[]
        for raw in polygon_parts(overlaps):
            if raw.area<2:continue
            contacts=[p for p in polygon_parts(land.intersection(raw.buffer(1))) if p.area>.2]
            if len(contacts)<2:continue
            cut=raw.buffer(-.35,join_style=2).buffer(.35,join_style=2).intersection(raw)
            if cut.is_empty or cut.area<1:
                cuts.append(raw);crossings.append(dict(kind='culvert',bounds=list(raw.bounds),area=raw.area));continue
            zone=roads.intersection(cut.buffer(24,join_style=2)).intersection(core)
            near=tree.query(zone,predicate='intersects')
            if len(near):zone=zone.difference(union_all([buildings[int(i)].buffer(.5,join_style=2) for i in near]))
            zone=union_all([p for p in polygon_parts(zone) if p.distance(cut)<.01])
            if zone.is_empty:skipped.append(dict(bounds=list(raw.bounds),reason='No safe bridge footprint'));continue
            probes=[p.representative_point() for p in contacts]+[Point(*p) for part in polygon_parts(cut) for p in list(part.exterior.coords)]
            level=max(terrain(w,p.x,p.y) for p in probes)+.65
            def height(x,y):
                ground=terrain(w,x,y)+.12;point=Point(x,y);t=max(0,1-point.distance(cut)/24);t=t*t*(3-2*t)
                edge=min(x-w['bounds'][0],w['bounds'][2]-x,y-w['bounds'][1],w['bounds'][3]-y);factor=min(1,max(0,edge/20));factor=factor*factor*(3-2*factor)
                return max(ground,ground+(level-ground)*t*factor)
            mesh=Mesh();x0,y0,x1,y1=zone.bounds;max_rise=0
            for x in np.arange(math.floor(x0/4)*4,x1,4):
                for y in np.arange(math.floor(y0/4)*4,y1,4):
                    for part in polygon_parts(zone.intersection(box(x,y,x+4,y+4))):
                        if part.area<1e-7:continue
                        for triangle in constrained_delaunay_triangles(part).geoms:
                            xy=list(triangle.exterior.coords)[:3]
                            if ((xy[1][0]-xy[0][0])*(xy[2][1]-xy[0][1])-(xy[1][1]-xy[0][1])*(xy[2][0]-xy[0][0]))<0:xy.reverse()
                            vertices=[[float(a),float(b),float(height(a,b))] for a,b in xy];mesh.add(vertices,[0,1,2])
                            max_rise=max(max_rise,max(h-terrain(w,a,b)-.09 for a,b,h in vertices))
            supports.append(dict(polygons=[rings(part) for part in polygon_parts(zone)],bounds=list(zone.bounds),vertices=mesh.positions,indices=mesh.indices,design='source-road-water-bridge'))
            decks.add(mesh.positions,mesh.indices);cuts.append(zone);crossings.append(dict(kind='bridge',bounds=list(cut.bounds),area=cut.area,level=level,maxRiseM=max_rise,triangles=len(mesh.indices)//3))
            # Solid slab sides, with open approaches. Rails belong only to the
            # road edges over water, never across the entrances on the banks.
            for part in polygon_parts(cut):
                for ring in rings(part):
                    for a,b in zip(ring,ring[1:]):
                        length=math.dist(a,b);count=max(1,math.ceil(length/4))
                        for k in range(count):
                            v=np.array(a)+(np.array(b)-a)*k/count;z=np.array(a)+(np.array(b)-a)*(k+1)/count;ha,hb=height(*v),height(*z)
                            structure.add([[*v,ha-.025],[*z,hb-.025],[*z,hb-.6],[*v,ha-.6]],[0,1,2,0,2,3])
                            mid=Point(*(v+z)/2)
                            if roads.boundary.distance(mid)>.25:continue
                            structure.add([[*v,ha+1.0],[*z,hb+1.0],[*z,hb+1.06],[*v,ha+1.06]],[0,1,2,0,2,3])
                            if length:
                                direction=(z-v)/np.linalg.norm(z-v);normal=np.array([-direction[1],direction[0]])*.025
                                structure.add([[*(v-normal),ha],[*(v+normal),ha],[*(v+normal),ha+1.06],[*(v-normal),ha+1.06]],[0,1,2,0,2,3])
        cleared=water.difference(union_all(cuts)) if cuts else water
        w['water']=[dict(rings=rings(p),bounds=list(p.bounds)) for p in polygon_parts(cleared)];w['heightSupports']=supports
        file.write_text(json.dumps(w,ensure_ascii=False,separators=(',',':')))
        s['meshes']=[m for m in s['meshes'] if m['name'] not in ['bridge-decks','bridge-structure']]
        for name,mesh,colour in [('bridge-decks',decks,'#656c6b'),('bridge-structure',structure,'#9ea99e')]:
            if mesh.indices:s['meshes'].append(dict(mesh.save(d/s['id'],name),material=colour,path=s['id']+'/',solid=True))
        result=dict(id=s['id'],origin='ai',created='2026-09-23',provenance='Road/water footprints from PLATEAU; deck heights and approaches designed from bank DEM because inspected road source Z is zero',crossings=crossings,skipped=skipped)
        (root/f'{s["id"]}-bridges.json').write_text(json.dumps(result,ensure_ascii=False,indent=2));reports.append(dict(id=s['id'],bridges=sum(c['kind']=='bridge' for c in crossings),culverts=sum(c['kind']=='culvert' for c in crossings),maxRiseM=max((c.get('maxRiseM',0) for c in crossings),default=0),skipped=len(skipped)))
        print(reports[-1],flush=True)
    (d/'study.json').write_text(json.dumps(study,ensure_ascii=False));(root/'bridges-audit.json').write_text(json.dumps(reports,ensure_ascii=False,indent=2))


if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--root',type=Path,required=True);main(p.parse_args().root)
