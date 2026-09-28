"""Resumable exact-source tiles, collision tiles and reusable facade recipes.

Each 200 m tile has a single building owner. Neighbouring footprints remain in
the collision/facade halo. No full-city mesh or million-ID runtime table.
"""
import argparse
import gzip
import hashlib
import json
import math
import shutil
import sqlite3
import zlib
from pathlib import Path

import numpy as np
from PIL import Image
from shapely import from_wkb, union_all
from shapely.geometry import Point, box

from audit_metro_coverage import dictionaries, projected_cell, query
from metro_geometry import Frame, Grid, clip_mesh, curve_subdivide, merge, polygons, save_tile, terrain_mesh, weld
from plan_tokyo_metro import write
from prepare_metro_overview import BODY, GROUND, linear_colour, owner, paint, source_ground, tile_grid, tile_specs, validate_output_contract
from plan_frontage import plan_buildings
from prepare_facade_sites import rooms


def rings(poly):
    return [[[float(x),float(y)] for x,y in ring.coords] for ring in [poly.exterior,*poly.interiors]]


def json_tile(output,name,data):
    raw=json.dumps(data,ensure_ascii=False,separators=(',',':')).encode()
    encoded=gzip.compress(raw,compresslevel=5,mtime=0);path=output/name;path.parent.mkdir(parents=True,exist_ok=True)
    temporary=path.with_suffix('.next');temporary.write_bytes(encoded);temporary.replace(path)
    return dict(path=name,bytes=len(encoded),decodedBytes=len(raw),sha256=hashlib.sha256(raw).hexdigest())


def build_tile(output,band,tile,buildings,surfaces,codes,grid,facades=True):
    frame=Frame(band);crop=box(*tile['bounds']).buffer(2,join_style=2).intersection(box(*band['bounds']))
    source_crop=projected_cell(band,crop.bounds);band_shape=box(*band['bounds'])
    rendered=[];collision=[];features={};positions=[];indices=[];owned=set();np_count=0;ni_count=0
    minimum=float('inf');maximum=-float('inf');source_triangles=0;clipped=0
    for identity,usage,source_bounds,geometry,blob,vertices,indices_count in query(buildings,'buildings',source_crop,
            's.source_id,s.usage,s.bounds,s.geometry,s.footprint,s.vertex_count,s.index_count'):
        footprint=frame.shape(from_wkb(blob)).intersection(band_shape)
        if footprint.area<.001 or not footprint.intersects(crop):continue
        bounds=json.loads(source_bounds);seed=int(hashlib.sha256(identity.encode()).hexdigest()[:8],16)
        raw=zlib.decompress(geometry)
        p=frame.points(np.frombuffer(raw,dtype='<f4',count=vertices*3).reshape(-1,3))
        idx=np.frombuffer(raw,dtype='<u4',count=indices_count,offset=vertices*12)
        if not band_shape.covers(box(*[float(p[:,0].min()),float(p[:,1].min()),float(p[:,0].max()),float(p[:,1].max())])):
            p,idx=clip_mesh(p,idx,band['bounds']);clipped+=1
        else:p,idx=weld(p,idx)
        if not len(idx):continue
        for poly in polygons(footprint):
            collision.append(dict(id=identity,rings=rings(poly),bounds=list(poly.bounds),base=bounds[4],top=bounds[5]))
        # Small halo also supplies real wall vertices for neighbour exposure tests.
        features[identity]=dict(usage=usage,firstIndex=ni_count,indexCount=len(idx))
        positions.append(p);indices.append(idx+np_count);np_count+=len(p);ni_count+=len(idx)
        if owner(band,footprint)!=tile['id']:continue
        owned.add(identity);source_triangles+=indices_count//3
        p,idx=curve_subdivide(p,idx)
        minimum=min(minimum,float(p[:,2].min()));maximum=max(maximum,float(p[:,2].max()))
        rendered.append(dict(position=p,index=idx,color=np.tile(linear_colour(BODY[seed%5]),(len(p),1))))
    ground=source_ground(surfaces,codes,band,crop.bounds)
    road=union_all([shape for _,_,shape,label in ground if label=='道路用地'])
    water=union_all([shape for _,_,shape,label in ground if label=='水面']).difference(road)
    roads=[dict(rings=rings(p),bounds=list(p.bounds)) for p in polygons(road) if p.area>.001]
    waters=[dict(rings=rings(p),bounds=list(p.bounds)) for p in polygons(water) if p.area>.001]
    collision_bounds=box(*tile['bounds']).buffer(1,join_style=2)
    wbuildings=[]
    for b in collision:
        for poly in polygons(Polygon_from_rings(b['rings']).intersection(collision_bounds)):
            if poly.area>.001:wbuildings.append({**b,'rings':rings(poly),'bounds':list(poly.bounds)})
    x0,y0,x1,y1=tile['bounds'];step=grid.step
    gx0=max(grid.origin[0],math.floor(x0/step)*step-step);gy0=max(grid.origin[1],math.floor(y0/step)*step-step)
    gx1=min(grid.origin[0]+(grid.z.shape[1]-1)*step,math.ceil(x1/step)*step+step)
    gy1=min(grid.origin[1]+(grid.z.shape[0]-1)*step,math.ceil(y1/step)*step+step)
    xs=np.arange(gx0,gx1+step*.1,step);ys=np.arange(gy0,gy1+step*.1,step);xx,yy=np.meshgrid(xs,ys)
    walk=dict(version=1,bounds=band['bounds'],half=20000,step=step,axis=xs.tolist(),terrainOrigin=[gx0,gy0],
              heights=grid.height(xx,yy).tolist(),buildings=wbuildings,roads=roads,water=waters)
    prefix=f'{band["id"]}/tiles/{tile["id"]}'
    image=Image.new('RGB',(400,400),'#ab969e')
    for _,_,shape,label in ground:paint(image,shape,GROUND[label],tile['gridBounds'],.5)
    texture=output/(prefix+'.png');texture.parent.mkdir(parents=True,exist_ok=True);image.save(texture,optimize=True)
    image.resize((100,100),Image.Resampling.BOX).save(output/(prefix+'-far.png'),optimize=True)
    meshes=[dict(name='terrain',colour='#ffffff',roughness=1,texture=prefix+'.png',textureBounds=tile['gridBounds'],attributes=terrain_mesh(grid,tile['bounds'],5))]
    buildings_mesh=merge(rendered)
    if buildings_mesh:meshes.append(dict(name='buildings',colour='#ffffff',roughness=.9,attributes=buildings_mesh))
    near=save_tile(output,prefix+'.bin.gz',meshes)
    far=[dict(name='terrain',colour='#ffffff',roughness=1,texture=prefix+'-far.png',textureBounds=tile['gridBounds'],attributes=terrain_mesh(grid,tile['bounds'],40))]
    if buildings_mesh:far.append(meshes[-1])
    far=[{**m,'segments':[dict(tile=tile['id'],first=0,count=len(m['attributes']['index']))]} for m in far]
    distant=save_tile(output,prefix+'-far.bin.gz',far)
    walking=json_tile(output,prefix+'-walk.json.gz',walk)
    recipe=[]
    if facades and owned and roads:
        p=np.concatenate(positions);idx=np.concatenate(indices).reshape(-1,3)
        candidates=plan_buildings(dict(buildings=collision,roads=roads),features,p,idx,grid)
        # Multipart footprints share one source building ID; each exposed part is retained.
        recipe=rooms([row for row in candidates if row['id'] in owned])
        for row in recipe:
            row['style']=(row['seed']//5)%4
            for wall in row['walls']:
                encoded=wall.pop('rooms');bands=[]
                for floor in range(wall['floors']):
                    bays=sorted((int(key.split(':')[1]),value) for key,value in encoded.items() if key.startswith(str(floor)+':'))
                    bands.append(''.join(str(value) for _,value in bays))
                wall['roomBands']=bands
    site=json_tile(output,prefix+'-facade.json.gz',dict(id=tile['id'],buildings=recipe))
    heights=grid.height(xx,yy);minimum=min(minimum,float(heights.min()));maximum=max(maximum,float(heights.max()))
    # Render ownership bounds include complete source buildings extending beyond this tile.
    bounds=list(tile['bounds'])
    if buildings_mesh:
        p=buildings_mesh['position'];bounds=[min(bounds[0],float(p[:,0].min())),min(bounds[1],float(p[:,1].min())),max(bounds[2],float(p[:,0].max())),max(bounds[3],float(p[:,1].max()))]
    return dict(id=tile['id'],sourceTileBounds=tile['bounds'],bounds=bounds,heightRange=[minimum,maximum],
                buildings=len(owned),sourceTriangles=source_triangles,renderTriangles=sum(len(m['attributes']['index'])//3 for m in meshes),
                clippedHaloBuildings=clipped,facadeBuildings=len({b['id'] for b in recipe}),facadeWalls=sum(len(b['walls']) for b in recipe),
                near=near,far={**distant,'tiles':[tile['id']]},walk=walking,facade=site)


def Polygon_from_rings(rings_):
    from shapely.geometry import Polygon
    return Polygon(rings_[0],rings_[1:])


def manifests(output,band,rows):
    base=dict(version=1,id=band['id'],tiles=[{**r['near'],'id':r['id'],'bounds':r['bounds'],'heightRange':r['heightRange']} for r in rows],
              farTiles=[{**r['far'],'id':r['id'],'bounds':r['bounds'],'heightRange':r['heightRange']} for r in rows])
    origin,grid=tile_grid(band)
    walk=dict(version=3,bounds=band['bounds'],gridOrigin=origin,gridShape=grid,tileSize=200,
              tiles=[{**r['walk'],'id':r['id'],'bounds':r['sourceTileBounds']} for r in rows])
    facade=dict(version=3,kit='facade-kit.json',bodyColours={},loadDistance=220,evictDistance=300,maxResident=24,maxBytes=6*1024*1024,
                sites=[{**r['facade'],'bytes':r['facade']['decodedBytes'],'id':r['id'],'bounds':r['bounds'],'heightRange':r['heightRange']} for r in rows])
    for suffix,data in [('base',base),('walk',walk),('facades',facade)]:write(output/band['id']/(suffix+'.json'),data)


def main():
    parser=argparse.ArgumentParser();parser.add_argument('--root',type=Path,required=True);parser.add_argument('--limit',type=int)
    parser.add_argument('--band');parser.add_argument('--tile');parser.add_argument('--without-facades',action='store_true')
    args=parser.parse_args();root=args.root.resolve();output=root/'derived'
    plan=json.loads((root/'tokyo-metro-plan.json').read_text());validate_output_contract(output,plan)
    buildings=sqlite3.connect(f'file:{root}/metro-source.sqlite?mode=ro',uri=True);surfaces=sqlite3.connect(f'file:{root}/metro-surfaces.sqlite?mode=ro',uri=True)
    codes=dictionaries(root);done=0;report=[]
    for band in plan['bands']:
        if args.band and band['id']!=args.band:continue
        grid=Grid(root,band['id']);rows=[]
        specs=list(tile_specs(band))
        arrivals=output/'metro-arrivals.json'
        if arrivals.exists():
            x,y=json.loads(arrivals.read_text())[band['id']]['spawn']
            specs.sort(key=lambda t:math.hypot((t['bounds'][0]+t['bounds'][2])/2-x,(t['bounds'][1]+t['bounds'][3])/2-y))
        for tile in specs:
            checkpoint=output/band['id']/'tiles'/(tile['id']+'.json')
            if checkpoint.exists():row=json.loads(checkpoint.read_text())
            else:
                if (args.tile and args.tile!=tile['id']) or (args.limit and done>=args.limit):continue
                if shutil.disk_usage(output).free<1_500_000_000:raise OSError('Retain 1.5 GB workspace reserve')
                row=build_tile(output,band,tile,buildings,surfaces,codes,grid,not args.without_facades)
                write(checkpoint,row);done+=1
                if done%20==0 or args.limit==1:print(band['id'],tile['id'],'completed',done,'buildings',row['buildings'],flush=True)
            rows.append(row)
            if done and done%20==0:manifests(output,band,rows)
        manifests(output,band,rows)
        report.append(dict(id=band['id'],tiles=len(rows),expectedTiles=3400,buildings=sum(r['buildings'] for r in rows),
                           facadeBuildings=sum(r['facadeBuildings'] for r in rows),triangles=sum(r['renderTriangles'] for r in rows)))
        audit='near-compile-audit'+('-'+args.band if args.band else '')+'.json'
        write(root/audit,dict(complete=len(report)==3 and all(r['tiles']==r['expectedTiles'] for r in report),bands=report))
    print(json.dumps(report),flush=True);buildings.close();surfaces.close()


if __name__=='__main__':main()
