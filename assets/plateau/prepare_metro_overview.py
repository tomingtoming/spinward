"""Bounded, source-derived overview of every square metre of the three strips.

Low buildings become roof footprints at this distant LOD. Buildings >= 18 m
retain source-footprint volumes. This is an explicit rendering approximation,
not a replacement of the detailed source models kept in metro-source.sqlite.
"""
import argparse
import collections
import hashlib
import json
import math
import shutil
import sqlite3
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw
from shapely import from_wkb
from shapely.geometry import box

from audit_metro_coverage import dictionaries, projected_cell, query
from metro_geometry import Frame, Grid, curve_subdivide, merge, polygons, prism, save_tile, terrain_mesh
from plan_tokyo_metro import write

BODY = ['#cfc6b4','#b3b8b5','#ab9181','#e1d9c9','#8c9c9c']
GROUND = {
    '住宅用地':'#b5b3aa', '商業用地':'#b8b7b0', '公益施設用地':'#b5b6ad',
    '交通施設用地':'#aaaead', '工業用地':'#a9aeae', '農林漁業施設用地':'#b6b1a0',
    'その他公的施設用地':'#b5b6ad',
    '道路用地':'#65696b', '公共空地':'#9eac8b', '山林':'#768b69',
    '田':'#a1ad79', '畑':'#afa77e', 'その他自然地':'#94a083',
    '水面':'#668e96', 'その他①':'#8d9e7e', 'その他②':'#69787e',
    'その他③':'#90938f', 'その他④':'#b1a99b', '低未利用土地':'#b3ab9b',
    '不明':'#afaca5',
}


def validate_output_contract(output,plan=None):
    contract=dict(version=1,gridOrigin=[-1700,-20000],gridShape=[17,200],tileSizeM=200,
                  boundaryVerticesM=5,sourceAxes='X south, Y east, Z orthometric')
    if plan and plan.get('layout')=='inland-b':
        contract.update(version=2,sourceAxes='X cross-strip, Y along-strip, Z orthometric',layout=plan['layout'],
            frameHash=hashlib.sha256(json.dumps([(b['id'],b['band'],b['frame']) for b in plan['bands']],sort_keys=True).encode()).hexdigest())
    path=output/'metro-contract.json'
    if path.exists():assert json.loads(path.read_text())==contract,'Incompatible generated tile grid'
    else:write(path,contract)


def linear_colour(hex_colour):
    c=np.array([int(hex_colour[i:i+2],16)/255 for i in [1,3,5]])
    return np.where(c<=.04045,c/12.92,((c+.055)/1.055)**2.4)


def paint(image, shape, colour, bounds, resolution):
    """Draw source polygons without filling their courtyard/water holes."""
    x0,y0,x1,y1=bounds
    draw=ImageDraw.Draw(image)
    convert=lambda ring:[((x-x0)/resolution,(y1-y)/resolution) for x,y in ring.coords]
    for part in polygons(shape):
        if not part.interiors:
            draw.polygon(convert(part.exterior),fill=colour)
        else:
            # Preserve previously drawn layers through holes; never erase to a
            # default land colour when a later polygon surrounds another use.
            bx0,by0,bx1,by1=part.bounds
            left=max(0,math.floor((bx0-x0)/resolution)-1)
            top=max(0,math.floor((y1-by1)/resolution)-1)
            right=min(image.width,math.ceil((bx1-x0)/resolution)+2)
            bottom=min(image.height,math.ceil((y1-by0)/resolution)+2)
            if right<=left or bottom<=top:continue
            mask=Image.new('L',(right-left,bottom-top),0);md=ImageDraw.Draw(mask)
            points=lambda ring:[(x-left,y-top) for x,y in convert(ring)]
            md.polygon(points(part.exterior),fill=255)
            for ring in part.interiors:md.polygon(points(ring),fill=0)
            image.paste(colour,(left,top,right,bottom),mask)


def tile_grid(band):
    x0,y0,x1,y1=band['bounds']
    # Half-tile alignment keeps the 3.351 km strip inside seventeen 200 m
    # columns while all internal boundaries still land on the 5 m DEM lattice.
    origin=[math.floor(x0/100)*100,math.floor(y0/100)*100]
    return origin,[math.ceil((x1-origin[0])/200),math.ceil((y1-origin[1])/200)]


def tile_specs(band):
    # Regular 200 m ownership grid aligned to the actual 5 m elevation samples.
    x0,y0,x1,y1=band['bounds'];origin,(nx,ny)=tile_grid(band)
    for j in range(ny):
        for i in range(nx):
            nominal=[origin[0]+i*200,origin[1]+j*200,origin[0]+(i+1)*200,origin[1]+(j+1)*200]
            yield dict(id=f'{i}-{j}',bounds=[max(x0,nominal[0]),max(y0,nominal[1]),min(x1,nominal[2]),min(y1,nominal[3])],
                       gridBounds=nominal,ij=[i,j])


def owner(band, shape):
    x0,y0,x1,y1=shape.bounds;x,y=(x0+x1)/2,(y0+y1)/2
    (ox,oy),(nx,ny)=tile_grid(band)
    return f'{min(nx-1,max(0,int((x-ox)//200)))}-{min(ny-1,max(0,int((y-oy)//200)))}'


def source_ground(db, codes, band, bounds):
    frame=Frame(band);shape=projected_cell(band,bounds);clip=box(*bounds)
    # Draw land use first, then explicit water and road source surfaces.
    rows=query(db,'surfaces',shape,'s.rowid,s.kind,s.city_code,s.class_code,s.code_space,s.geometry')
    entries=[]
    for rowid,kind,city,code,space,blob in rows:
        geom=frame.shape(from_wkb(blob))
        if not geom.intersects(clip):continue
        geom=geom.intersection(clip)
        if geom.is_empty:continue
        label='道路用地' if kind=='tran' else '水面' if kind=='wtr' else codes[(city,Path(space).name)][code].split('（')[0]
        assert label in GROUND,(label,city,code)
        entries.append(({'luse':0,'wtr':1,'tran':2}[kind],rowid,geom,label))
    return sorted(entries,key=lambda row:(row[0],row[1]))


def source_buildings(db,band,bounds):
    frame=Frame(band);shape=projected_cell(band,bounds);clip=box(*band['bounds']);part=box(*bounds)
    rows=query(db,'buildings',shape,'s.source_id,s.bounds,s.footprint')
    for identity,source_bounds,blob in rows:
        footprint=frame.shape(from_wkb(blob)).intersection(clip)
        if footprint.is_empty or footprint.area<.001 or not footprint.intersects(part):continue
        low,high=json.loads(source_bounds)[4:6]
        seed=int(hashlib.sha256(identity.encode()).hexdigest()[:8],16)
        yield dict(id=identity,shape=footprint,base=low,top=high,seed=seed,owner=owner(band,footprint))


def build_segment(root,output,band,segment,buildings,surfaces,codes,grid):
    index=segment; y0=-20000+index*4000
    specs=[tile for tile in tile_specs(band) if y0<=tile['bounds'][1]<y0+4000]
    bounds=[band['bounds'][0],y0,band['bounds'][2],y0+4000]
    image_bounds=[-1700,y0,1700,y0+4000]
    resolution=4
    image=Image.new('RGB',(850,1000),'#ab969e') # unresolved ground is visibly distinct
    counts=collections.Counter()
    for _,_,shape,label in source_ground(surfaces,codes,band,bounds):
        paint(image,shape,GROUND[label],image_bounds,resolution);counts[label]+=1
    skyline=collections.defaultdict(list);owned=0;intersections=0
    for b in source_buildings(buildings,band,bounds):
        intersections+=1
        # The palette is designed by Spinward; footprint/height are source facts.
        body=BODY[b['seed']%5]
        roof=np.array([int(body[i:i+2],16) for i in [1,3,5]])
        roof=np.clip(roof*(.70+(b['seed']//5%5)*.035),0,255).astype(int)
        paint(image,b['shape'],tuple(roof),image_bounds,resolution)
        tile_row=int(b['owner'].split('-')[1])
        if not index*20<=tile_row<(index+1)*20:continue
        owned+=1
        if b['top']-b['base']<18:continue
        # Keep holes and source topology; simplify at a stated 0.5 m far tolerance.
        shape=b['shape'].simplify(.5,preserve_topology=True)
        p,i=curve_subdivide(*prism(shape,b['base'],b['top']))
        if len(i):skyline[b['owner']].append(dict(position=p,index=i,color=np.tile(linear_colour(body),(len(p),1))))
    name=f'{band["id"]}/overview-{index}'
    texture=output/(name+'.png');texture.parent.mkdir(parents=True,exist_ok=True)
    image.save(texture,optimize=True)
    grounds=[];volumes=[];gs=[];vs=[];gcount=0;vcount=0
    for tile in specs:
        g=terrain_mesh(grid,tile['bounds'],40);grounds.append(g)
        gs.append(dict(tile=tile['id'],first=gcount,count=len(g['index'])));gcount+=len(g['index'])
        b=merge(skyline[tile['id']])
        if b:
            volumes.append(b);vs.append(dict(tile=tile['id'],first=vcount,count=len(b['index'])));vcount+=len(b['index'])
    meshes=[dict(name='terrain',colour='#ffffff',roughness=1,texture=name+'.png',textureBounds=image_bounds,
                 segments=gs,attributes=merge(grounds))]
    if volumes:meshes.append(dict(name='buildings',colour='#ffffff',roughness=.9,segments=vs,attributes=merge(volumes)))
    descriptor=save_tile(output,name+'.bin.gz',meshes)
    return dict(**descriptor,id=str(index),bounds=bounds,texture=name+'.png',texturePixels=850000,
                buildings=owned,buildingIntersections=intersections,terrainTriangles=gcount//3,buildingTriangles=vcount//3,
                classes=dict(counts),tiles=[t['id'] for t in specs])


def main():
    parser=argparse.ArgumentParser();parser.add_argument('--root',type=Path,required=True)
    parser.add_argument('--limit',type=int);args=parser.parse_args();root=args.root.resolve()
    output=root/'derived';output.mkdir(exist_ok=True)
    plan=json.loads((root/'tokyo-metro-plan.json').read_text());validate_output_contract(output,plan);codes=dictionaries(root)
    buildings=sqlite3.connect(f'file:{root}/metro-source.sqlite?mode=ro',uri=True)
    surfaces=sqlite3.connect(f'file:{root}/metro-surfaces.sqlite?mode=ro',uri=True)
    samples=[];done=0
    for band in plan['bands']:
        grid=Grid(root,band['id']);segments=[]
        for segment in range(10):
            checkpoint=output/band['id']/f'overview-{segment}.json'
            if checkpoint.exists():row=json.loads(checkpoint.read_text())
            else:
                if args.limit and done>=args.limit:break
                if shutil.disk_usage(output).free<1_500_000_000:raise OSError('Retain 1.5 GB workspace reserve')
                row=build_segment(root,output,band,segment,buildings,surfaces,codes,grid)
                write(checkpoint,row);done+=1
                print(band['id'],segment,'buildings',row['buildings'],'triangles',row['terrainTriangles']+row['buildingTriangles'],flush=True)
            segments.append(row)
        sample=dict(id=band['id'],name=band['name'],band=band['band'],bounds=band['bounds'],anchor=band['anchor'],
                    frame=band['frame'],reliefM=grid.meta['rangeM'],overview=segments,tiles=list(tile_specs(band)))
        samples.append(sample)
        write(output/'metro-overview.json',dict(version=1,radius=plan['radius'],span=plan['span'],bandWidth=plan['width'],
              sourceAreaKm2=plan['areaKm2'],layout=plan.get('layout','legacy'),defaultRegion=plan.get('defaultRegion','south'),
              sourcePins=plan['sourcePins'],samples=samples,ready=len(samples)==3 and all(len(s['overview'])==10 for s in samples),
              approximation=dict(groundPixelM=4,lowBuildingRoofsOnlyBelowM=18,volumeFootprintToleranceM=.5,terrainInteriorStepM=40,sharedBoundaryStepM=5),
              sourceCoverage='Source geometry audit is separate; see geometry-coverage-audit.json.'))
    print(json.dumps(dict(segments=sum(len(s['overview']) for s in samples),
          triangles=sum(r['terrainTriangles']+r['buildingTriangles'] for s in samples for r in s['overview']),
          decodedBytes=sum(r['decodedBytes'] for s in samples for r in s['overview'])),ensure_ascii=False),flush=True)
    buildings.close();surfaces.close()


if __name__=='__main__':main()
