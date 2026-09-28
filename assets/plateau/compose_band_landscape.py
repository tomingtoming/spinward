"""Compose designed outer land around immutable, metre-scale Earth city cores.

No city block is stretched or repeated. The imported core is a literal hole in
the new terrain mesh. Its complete DEM edge is retained as a constrained seam.
Authored waterworks, production landscapes and paths are labelled separately.
"""
import argparse,json,math,random
from pathlib import Path
import numpy as np
from shapely import delaunay_triangles,constrained_delaunay_triangles,union_all
from shapely.geometry import MultiPoint,Polygon,Point,LineString,box
from shapely.strtree import STRtree
from assemble import Mesh,polygon_parts,subdivide
from prepare_walk import rings
from prepare_walk_tiles import terrain
from geo import WIDTH,SPAN


class OuterTerrain:
    def __init__(self,w,band):
        self.w=w;self.band=band;self.cx,self.cy=band['anchor']['local'];self.core=box(*w['bounds'])
        self.bounds=[-WIDTH/2-self.cx,-SPAN/2-self.cy,WIDTH/2-self.cx,SPAN/2-self.cy]
        self.domain=box(*self.bounds).difference(self.core);self.basins=[]

    def baseline(self,x,y):
        b=self.w['bounds'];px=max(b[0],min(b[2],x));py=max(b[1],min(b[3],y))
        h=terrain(self.w,px,py);d=abs(y-py);t=min(1,d/1600);t=t*t*(3-2*t)
        gx=x+self.cx;gy=y+self.cy;band=self.band['band']
        designed=(12+band*6)+3*math.sin(gy/4800)+1.5*math.sin(gx/1100+gy/2300)
        return h*(1-t)+designed*t

    def height(self,x,y):
        h=self.baseline(x,y)
        for bounds in self.basins:
            if bounds[0]-25<x<bounds[2]+25 and bounds[1]-25<y<bounds[3]+25:
                edge=min(x-bounds[0],bounds[2]-x,y-bounds[1],bounds[3]-y)
                h-=4*max(0,min(1,(edge+20)/20))
        return h

    def build(self):
        x0,y0,x1,y1=self.bounds;bx,by,ex,ey=self.w['bounds'];w=self.w
        # Cylinder curvature is across X only: <=20 m X edges keep the chord
        # error under 1.6 cm, while long-axis terrain can use 100 m spacing.
        xs=sorted(set([x0,x1,bx,ex]+list(np.arange(math.ceil(x0/20)*20,x1,20))))
        ys=sorted(set([y0,y1,by,ey]+list(np.arange(math.ceil(y0/100)*100,y1,100))+list(np.arange(math.floor((by-1800)/20)*20,ey+1800,20))))
        points=[(float(x),float(y)) for y in ys for x in xs if not (bx<x<ex and by<y<ey)]
        points.extend((x,by) for x in w['axis']);points.extend((x,ey) for x in w['axis'])
        points.extend((bx,y) for y in w.get('yaxis',w['axis']));points.extend((ex,y) for y in w.get('yaxis',w['axis']))
        p=[];idx=[];lookup={};area=0
        def vertex(x,y):
            key=(round(x,8),round(y,8))
            if key not in lookup:lookup[key]=len(p);p.append([x,y,self.height(x,y)])
            return lookup[key]
        for triangle in delaunay_triangles(MultiPoint(points)).geoms:
            if self.core.covers(triangle):continue
            # Clipping also prevents a rare Delaunay diagonal across a core corner.
            cut=triangle.difference(self.core)
            for part in polygon_parts(cut):
                if part.area<1e-7:continue
                # Dense source-edge samples and sparse outer rows can create
                # diagonal triangles wider than the nominal X grid spacing.
                # Slice every triangle into the same 20 m vertical strips.
                for ix in range(math.floor(part.bounds[0]/20),math.ceil(part.bounds[2]/20)):
                    for piece in polygon_parts(part.intersection(box(ix*20,y0-1,(ix+1)*20,y1+1))):
                        if piece.area<1e-8:continue
                        for t in constrained_delaunay_triangles(piece).geoms:
                            xy=list(t.exterior.coords)[:3]
                            if ((xy[1][0]-xy[0][0])*(xy[2][1]-xy[0][1])-(xy[1][1]-xy[0][1])*(xy[2][0]-xy[0][0]))<0:xy.reverse()
                            idx.extend(vertex(x,y) for x,y in xy);area+=t.area
        assert abs(area-self.domain.area)<.02,(area,self.domain.area)
        self.mesh=Mesh();self.mesh.positions=p;self.mesh.indices=idx
        self.positions=np.asarray(p);self.indices=np.asarray(idx).reshape(-1,3)
        self.triangles=[Polygon(self.positions[t,:2]) for t in self.indices];self.index=STRtree(self.triangles)
        return self.mesh

    def surface(self,shape,offset=0,height=None):
        mesh=Mesh()
        for part in polygon_parts(shape.intersection(self.domain)):
            for i in self.index.query(part,predicate='intersects'):
                source=self.positions[self.indices[i]];matrix=np.column_stack([source[:,:2],np.ones(3)]);coeff=np.linalg.solve(matrix,source[:,2])
                for polygon in polygon_parts(part.intersection(self.triangles[i])):
                    if polygon.area<1e-7:continue
                    for triangle in constrained_delaunay_triangles(polygon).geoms:
                        xy=list(triangle.exterior.coords)[:3]
                        if ((xy[1][0]-xy[0][0])*(xy[2][1]-xy[0][1])-(xy[1][1]-xy[0][1])*(xy[2][0]-xy[0][0]))<0:xy.reverse()
                        mesh.add([[x,y,(height(x,y) if height else coeff[0]*x+coeff[1]*y+coeff[2])+offset] for x,y in xy],[0,1,2])
        return mesh

    def mesh_height(self,x,y):
        point=Point(x,y)
        for i in self.index.query(point,predicate='intersects'):
            source=self.positions[self.indices[i]];coefficient=np.linalg.solve(np.column_stack([source[:,:2],np.ones(3)]),source[:,2])
            return float(coefficient[0]*x+coefficient[1]*y+coefficient[2])
        raise ValueError('Outside designed terrain '+str((x,y)))


def main(root):
    d=root/'derived';study=json.loads((d/'study.json').read_text());source_plan=json.loads((root/'band-source-plan.json').read_text());audit=[]
    for s in study['samples']:
        w=json.loads((d/s['walk']).read_text());t=OuterTerrain(w,s);cx,cy=s['anchor']['local'];b=w['bounds'];band=s['band'];folder=d/s['id'];routes=[];destinations=[];zones=[];waters=[];buildings=[];trees=[]
        native=lambda x,y:[x-cx,y-cy]
        palettes=[['#929f74','#a7b37a','#b8ae84','#77916a'],['#91a27a','#82976d','#acb985','#698268'],['#b8bb80','#a3b176','#b8ad78','#8c9f70']]
        for side in [-1,1]:
            core_end=(b[1]+cy if side<0 else b[3]+cy);first=abs(core_end)+650
            ys=[side*v for v in [first,(first+19000)/2,19000,19870]]
            labels=(['都市縁の公園','食料生産区','水再生施設','端部連絡口'] if band==0 else ['丘陵の緑道','果樹・育苗区','給水調整池','端部連絡口'] if band==1 else ['集落縁の緑道','農産物集配区','農業用水池','端部連絡口'])
            spine=[]
            spine_y=sorted(set(ys+list(np.linspace(side*(abs(core_end)+200),side*19870,max(2,math.ceil((19870-abs(core_end))/100))))),reverse=side<0)
            for y in spine_y:
                spine.append(native(100*math.sin(y/2300+band),float(y)))
            routes.append(dict(id=f'spine-{side}',width=10,points=spine))
            for j,(y,label) in enumerate(zip(ys,labels)):
                x=100*math.sin(y/2300+band);point=native(x,y)
                destinations.append(dict(id=f'outer-{side}-{j}',label=('始端側 ' if side<0 else '終端側 ')+label,point=point,ground=t.height(*point)+.09,yaw=math.atan2(150,230) if j==1 else math.atan2(-(390-x),300) if j==2 else (0 if side>0 else math.pi) if j==3 else math.atan2(-40,32),provenance='Spinward設計'))
                connection=[native(-1640,y),native(-850,y-100*side),point,native(850,y+100*side),native(1640,y)]
                routes.append(dict(id=f'cross-{side}-{j}',width=8,points=connection))
                extent0=side*(abs(core_end)+200) if j==0 else (ys[j-1]+y)/2
                extent1=side*20000 if j==3 else (ys[j+1]+y)/2
                zones.append(dict(id=f'zone-{side}-{j}',label=label,kind=['park','production','waterworks','terminal'][j],bounds=[t.bounds[0],min(extent0,extent1)-cy,t.bounds[2],max(extent0,extent1)-cy],colour=palettes[band][j]))
                # A small civic/service building belongs to each outer stopping place.
                bx,by=(point[0]-80,point[1]+65) if j==2 else (point[0],point[1]+side*50) if j==3 else (point[0]+40,point[1]+32)
                buildings.append(dict(id=f'spinward:{s["id"]}:{side}:{j}',usage='商業施設' if j<2 else '業務施設',bounds=[bx-(12 if j==0 else 24 if j==3 else 18),by-12,bx+(12 if j==0 else 24 if j==3 else 18),by+12],height=5 if j==0 else 8 if j<3 else 14,facility=['park','production-office','water-control','terminal'][j],side=side))
                if j==2:
                    water=box(150-cx,y+120-cy,630-cx,y+480-cy);waters.append(water);t.basins.append(list(water.bounds))
                if j==1:
                    for k in range(6):
                        bx,by=point[0]-360+(k%3)*110,point[1]+210+(k//3)*70
                        buildings.append(dict(id=f'spinward:{s["id"]}:production:{side}:{k}',usage='工場' if band==2 else '農林漁業施設',bounds=[bx-50,by-18,bx+50,by+18],height=4.5 if band!=2 else 9,facility='greenhouse' if band!=2 else 'warehouse',side=side))
        for x in [-1640,1640]:routes.append(dict(id=f'edge-{x}',width=6,points=[native(x,y) for y in sorted(set([-19870,19870]+list(np.arange(-19800,19801,100))))]))
        # End promenades join the two long paths; all authored destinations share this network.
        for y in [-19870,19870]:routes.append(dict(id=f'end-{y}',width=8,points=[native(-1640,y),native(1640,y)]))
        connection_path=root/f'{s["id"]}-band-routes.json'
        if connection_path.exists():routes.extend(json.loads(connection_path.read_text())['connectors'])
        roads=union_all([LineString(r['points']).buffer(r['width']/2,cap_style=2,join_style=2) for r in routes]).intersection(t.domain)
        circulation=roads
        for destination in destinations:
            side=-1 if destination['id'].startswith('outer--1-') else 1
            j=int(destination['id'].split('-')[-1])
            building=next(b for b in buildings if b['id']==f'spinward:{s["id"]}:{side}:{j}')
            x0,y0,x1,y1=building['bounds'];front=2 if j==3 and side<0 else 0
            building['entryWall']=front
            door=[(x0+x1)/2,y1+1 if front==2 else y0-1]
            access=dict(id='access-'+destination['id'],width=4,points=[destination['point'],door],provenance='Spinward designed entrance path')
            routes.append(access)
            roads=roads.union(LineString(access['points']).buffer(2,cap_style=2))
        assert all(water.distance(roads)>30 for water in waters),'Reservoir must not block the circulation route'
        terrain_mesh=t.build();meshes=[]
        for destination in destinations:destination['ground']=t.mesh_height(*destination['point'])+.09
        # Colour plots without claiming them as Earth land-use survey data.
        colour=[]
        for x,y,h in terrain_mesh.positions:
            zone=next((z for z in zones if z['bounds'][1]<=y<=z['bounds'][3]),None)
            shade=(zone or {}).get('colour','#9fa88a');rgb=[int(shade[k:k+2],16)/255 for k in [1,3,5]]
            variation=1+.012*math.sin((x+cx)/600+(y+cy)/1700)
            # Save linear colour values to match Three's vertex-colour contract.
            colour.extend(((v*variation+.055)/1.055)**2.4 if v*variation>.04045 else v*variation/12.92 for v in rgb)
        name='band-terrain';descriptor=dict(terrain_mesh.save(folder,name),material='#ffffff',path=s['id']+'/',colours=name+'.colours.bin')
        np.asarray(colour,dtype='<f4').tofile(folder/descriptor['colours']);meshes.append(descriptor)
        # Expose a real structural edge instead of ending the walkable sheet at
        # an invisible wall. The low parapet shares the actual terrain height.
        edge_mesh=Mesh();x0,y0,x1,y1=t.bounds
        paths=[[(x,float(y)) for y in np.linspace(y0,y1,401)] for x in [x0,x1]]+[[[float(x),y] for x in np.linspace(x0,x1,math.ceil((x1-x0)/20)+1)] for y in [y0,y1]]
        for path in paths:
            for a,bp in zip(path,path[1:]):
                ha,hb=t.mesh_height(*a),t.mesh_height(*bp)
                edge_mesh.add([[*a,ha+.85],[*bp,hb+.85],[*bp,hb-14],[*a,ha-14]],[0,1,2,0,2,3])
        meshes.append(dict(edge_mesh.save(folder,'band-structure-edge'),material='#788881',path=s['id']+'/'))
        road_mesh=t.surface(roads,.09);meshes.append(dict(road_mesh.save(folder,'band-roads'),material='#686d68',path=s['id']+'/'))
        water_mesh=Mesh()
        for water in waters:
            mesh=t.surface(water,0,lambda x,y:t.baseline(x,y)-1.7);water_mesh.add(mesh.positions,mesh.indices)
        meshes.append(dict(water_mesh.save(folder,'band-water'),material='#648b91',roughness=.28,path=s['id']+'/'))
        body=Mesh();facilities=Mesh();glass=Mesh();crop_mesh=Mesh();colliders=[]
        for building in buildings:
            x0,y0,x1,y1=building['bounds'];base=max(t.mesh_height(x,y) for x,y in [(x0,y0),(x1,y0),(x1,y1),(x0,y1)])+.1;top=base+building['height'];low=min(t.mesh_height(x,y) for x,y in [(x0,y0),(x1,y0),(x1,y1),(x0,y1)])-.2
            ring=[[x0,y0],[x1,y0],[x1,y1],[x0,y1],[x0,y0]];colliders.append(dict(id=building['id'],rings=[ring],bounds=building['bounds'],base=base,top=top))
            p=[[x,y,z] for z in [low,top] for x,y in ring[:4]];indices=[4,5,6,4,6,7]
            for k in range(4):j=(k+1)%4;indices.extend([k,j,j+4,k,j+4,k+4])
            part=subdivide(p,indices,20);body.add(part.positions,part.indices);building.update(base=base,top=top)
            if building['facility'] in ['greenhouse','warehouse']:
                # Low gabled production halls read differently from civic offices.
                mid=(y0+y1)/2;ridge=top+(3 if building['facility']=='greenhouse' else 2)
                roof=subdivide([[x0,y0,top],[x1,y0,top],[x1,mid,ridge],[x0,mid,ridge],[x0,y1,top],[x1,y1,top]],[0,1,2,0,2,3,3,2,5,3,5,4],20)
                glass.add(roof.positions,roof.indices)
                for x in np.arange(x0+2,x1-2,8):
                    glass.add([[x,y0-.04,base+.5],[min(x+6,x1-1),y0-.04,base+.5],[min(x+6,x1-1),y0-.04,top-.4],[x,y0-.04,top-.4]],[0,1,2,0,2,3])
            if building['facility']=='terminal':
                front=y0-.04 if building['side']>0 else y1+.04;mx=(x0+x1)/2
                glass.add([[mx-9,front,base],[mx+9,front,base],[mx+9,front,base+7],[mx-9,front,base+7]],[0,1,2,0,2,3])
                facilities.add([[mx-12,front-3,base+7.4],[mx+12,front-3,base+7.4],[mx+12,front+3,base+7.4],[mx-12,front+3,base+7.4]],[0,1,2,0,2,3])
        meshes.append(dict(body.save(folder,'band-buildings'),material='#c5c9b9',path=s['id']+'/'))
        for destination in destinations:
            px,py=destination['point']
            if destination['id'].endswith('-2'):
                for offset in [150,210]:
                    tx,ty=680-cx,py+offset;radius=20;ring=[[tx+radius*math.cos(k*math.tau/40),ty+radius*math.sin(k*math.tau/40)] for k in range(41)];base=max(t.mesh_height(*p) for p in ring)+.1
                    colliders.append(dict(id='spinward:tank:'+destination['id']+':'+str(offset),rings=[ring],bounds=[tx-radius,ty-radius,tx+radius,ty+radius],base=base,top=base+6))
                    for a,bp in zip(ring,ring[1:]):
                        facilities.add([[*a,base-.3],[*bp,base-.3],[*bp,base+6],[*a,base+6]],[0,1,2,0,2,3])
                        glass.add([[tx,ty,base+5.5],[*a,base+5.5],[*bp,base+5.5]],[0,1,2])
            if destination['id'].endswith('-1'):
                for yy in range(80,155,6):
                    plot=box(px-300,py+yy,px-90,py+yy+2)
                    planted=t.surface(plot,.06);crop_mesh.add(planted.positions,planted.indices)
            is_terminal=destination['id'].endswith('-3');side=-1 if destination['id'].startswith('outer--1-') else 1
            sx=px+(-8 if destination['id'].endswith('-1') else 5 if is_terminal else 8);sy=py+(side*8 if is_terminal else 4)
            destination['sign']=dict(x=sx,y=sy,yaw=math.atan2(-(sx-px),sy-py))
        for name,mesh,colour in [('band-facilities',facilities,'#89948c'),('band-production-glass',glass,'#63868c'),('band-crops',crop_mesh,'#587847')]:
            if mesh.indices:meshes.append(dict(mesh.save(folder,name),material=colour,path=s['id']+'/'))
        for collider in colliders:
            assert Polygon(collider['rings'][0]).distance(circulation)>1, 'Facility blocks a road: '+collider['id']
        rng=random.Random(16384+band);blocked=union_all([roads.buffer(7),*waters,*[Polygon(v['rings'][0]).buffer(5) for v in colliders]])
        for destination in destinations:
            if destination['id'].endswith('-3'):continue
            x,y=destination['point']
            for k in range(220):
                px=x+rng.uniform(-550,550);py=y+rng.uniform(-380,380)
                if not t.domain.contains(Point(px,py)) or blocked.contains(Point(px,py)):continue
                trees.append([px,py,t.mesh_height(px,py),rng.uniform(6,12),rng.uniform(2.3,4.0)])
        # A connected 40 km road polygon has a huge bbox and would defeat the
        # runtime's spatial index. Collision pieces are local, with a 1 m halo.
        collision_roads=[]
        for ix in range(math.floor(t.bounds[0]/200),math.ceil(t.bounds[2]/200)):
            for iy in range(math.floor(t.bounds[1]/200),math.ceil(t.bounds[3]/200)):
                crop=box(ix*200-1,iy*200-1,(ix+1)*200+1,(iy+1)*200+1)
                for p in polygon_parts(roads.intersection(crop)):
                    if p.area>1e-7:collision_roads.append(dict(rings=rings(p),bounds=list(p.bounds)))
        result=dict(version=1,origin='ai',created='2026-09-23',provenance='Designed colony land outside the surveyed Earth core; no repeated city blocks',bounds=t.bounds,sourceBounds=w['bounds'],meshes=meshes,
                    buildings=colliders,buildingRecipes=buildings,water=[dict(rings=rings(p),bounds=list(p.bounds)) for p in waters],roads=collision_roads,routes=routes,destinations=destinations,zones=zones,trees=trees)
        file=s['id']+'/band-landscape.json';(d/file).write_text(json.dumps(result,ensure_ascii=False,separators=(',',':')));s['bandLandscape']=file
        audit.append(dict(id=s['id'],sourceAreaKm2=t.core.area/1e6,designedAreaKm2=t.domain.area/1e6,terrainTriangles=len(terrain_mesh.indices)//3,designedBuildings=len(buildings),trees=len(trees),routes=len(routes),destinationCount=len(destinations)))
        print(audit[-1],flush=True)
    study['fullBands']=True;study['status']='Three 40 km bands: source city cores and explicitly designed outer landscapes'
    (d/'study.json').write_text(json.dumps(study,ensure_ascii=False));(root/'band-landscape-audit.json').write_text(json.dumps(audit,ensure_ascii=False,indent=2))


if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--root',type=Path,required=True);main(p.parse_args().root)
