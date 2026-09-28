"""Bounded night fields and street fixtures from the same source plan.

Not surveyed lighting: this is Spinward's lighting design on PLATEAU road
land, avoiding buildings/water and using the exact source DEM for pole bases.
All heavy unions and window reductions happen offline.
"""
import argparse
import gzip
import json
import math
import sqlite3
from pathlib import Path

import numpy as np
from PIL import Image
from shapely import STRtree, union_all
from shapely.geometry import Point, LineString

from audit_metro_coverage import dictionaries
from metro_geometry import Grid, polygons, save_tile
from plan_tokyo_metro import write
from prepare_metro_overview import source_ground, source_buildings, paint

POOL_STEP = 8
WALL_STEP = 16
POOL_RADIUS = 13
SPACING = 38


def plan_lamps(road, water, buildings, grid, bounds, occupied=None):
    """True union boundaries only; no poles on arbitrary 200 m tile edges."""
    occupied = occupied if occupied is not None else {}
    walls = STRtree(buildings)
    anchors = []
    rejection = dict(narrow=0, corner=0, building=0, water=0, spacing=0, slope=0)
    x0,y0,x1,y1 = bounds
    for poly in sorted(polygons(road), key=lambda p:p.bounds):
        for ring in [poly.exterior, *poly.interiors]:
            if ring.length < 15: continue
            # A fixed metric density, not one fixture per source polygon.
            for d in np.arange(SPACING*.5,ring.length,SPACING):
                p=ring.interpolate(float(d));x,y=p.x,p.y
                if not (x0+1 <= x < x1-1 and y0 <= y < y1):continue
                a=ring.interpolate(max(0,float(d)-1.5));b=ring.interpolate(min(ring.length,float(d)+1.5))
                dx,dy=b.x-a.x,b.y-a.y;length=math.hypot(dx,dy)
                if length<2.85:rejection['corner']+=1;continue
                nx,ny=-dy/length,dx/length
                if not road.covers(Point(x+nx,y+ny)):nx,ny=-nx,-ny
                # Keep poles at the curb, with the head facing into a road of
                # usable width. No poles across a crossing mouth or tiny alley.
                if not road.covers(LineString([(x+nx*.1,y+ny*.1),(x+nx*5.5,y+ny*5.5)])):
                    rejection['narrow']+=1;continue
                px,py=x+nx*.55,y+ny*.55
                candidate=Point(px,py)
                if len(walls.query(candidate.buffer(1.1),predicate='intersects')):
                    rejection['building']+=1;continue
                if water.intersects(candidate.buffer(1)):
                    rejection['water']+=1;continue
                key=(math.floor(px/18),math.floor(py/18))
                neighbors=[p for i in range(key[0]-1,key[0]+2) for j in range(key[1]-1,key[1]+2) for p in occupied.get((i,j),[])]
                if any((px-a)**2+(py-b)**2<18**2 for a,b in neighbors):rejection['spacing']+=1;continue
                hx,hy=px+nx*1.5,py+ny*1.5
                z=float(grid.height(px,py));head_ground=float(grid.height(hx,hy))
                if abs(head_ground-z)>1.5:rejection['slope']+=1;continue
                occupied.setdefault(key,[]).append((px,py))
                anchors.append([round(v,4) for v in [px,py,z,nx,ny,7.2,1]])
    return anchors,rejection


def stamp(field,x,y,colour,bounds,step,radius=POOL_RADIUS):
    x0,y0,x1,y1=bounds
    cx=(x-x0)/step-.5;cy=(y1-y)/step-.5
    r=radius/step
    left=max(0,math.floor(cx-r));right=min(field.shape[1],math.ceil(cx+r)+1)
    top=max(0,math.floor(cy-r));bottom=min(field.shape[0],math.ceil(cy+r)+1)
    if right<=left or bottom<=top:return
    xx,yy=np.meshgrid(np.arange(left,right),np.arange(top,bottom))
    distance=((xx-cx)**2+(yy-cy)**2)/r**2
    weight=np.maximum(0,1-distance)**2
    field[top:bottom,left:right]+=weight[:,:,None]*np.asarray(colour)


def main():
    parser=argparse.ArgumentParser();parser.add_argument('--root',type=Path,required=True)
    parser.add_argument('--source',type=Path,required=True);parser.add_argument('--name',default='night-v1')
    parser.add_argument('--band');parser.add_argument('--limit',type=int)
    args=parser.parse_args();root=args.root.resolve();output=root/'derived'/args.name;output.mkdir(exist_ok=True)
    plan=json.loads((root/'tokyo-metro-plan.json').read_text())
    surfaces=sqlite3.connect(f'file:{root}/metro-surfaces.sqlite?mode=ro&immutable=1',uri=True)
    buildings=sqlite3.connect(f'file:{root}/metro-source.sqlite?mode=ro&immutable=1',uri=True)
    codes=dictionaries(root);reports=[]
    for band in plan['bands']:
        if args.band and band['id']!=args.band:continue
        grid=Grid(root,band['id']);occupied={};all_lamps=[];segments=[]
        windows=json.loads(gzip.decompress((args.source/(band['id']+'-windows.json.gz')).read_bytes()))
        assert windows['frame']==band['frame']
        light={row[0]:row[1:] for row in windows['buildings']}
        pool_mask=Image.new('L',(425,5000));pool_image=Image.new('RGB',(425,5000));wall_image=Image.new('RGB',(213,2500))
        for segment in range(args.limit or 10):
            y0=-20000+segment*4000;bounds=[-1700,y0,1700,y0+4000]
            crop=[band['bounds'][0],y0,band['bounds'][2],y0+4000]
            halo=[crop[0]-50,crop[1]-50,crop[2]+50,crop[3]+50]
            entries=source_ground(surfaces,codes,band,halo)
            road=union_all([s for _,_,s,label in entries if label=='道路用地'])
            water=union_all([s for _,_,s,label in entries if label=='水面']).difference(road)
            source=list(source_buildings(buildings,band,halo))
            lamps,rejected=plan_lamps(road,water,[b['shape'] for b in source],grid,crop,occupied)
            all_lamps.extend(lamps)
            field=np.zeros((500,425,3),np.float32)
            for x,y,z,nx,ny,h,power in lamps:stamp(field,x+nx*1.5,y+ny*1.5,[.115,.086,.052],bounds,POOL_STEP)
            # A mask clips distant pools to public road land, not rivers/roofs.
            mask=Image.new('L',(425,500));paint(mask,road,255,bounds,POOL_STEP)
            for b in source:paint(mask,b['shape'],0,bounds,POOL_STEP)
            pool_mask.paste(mask,(0,(9-segment)*500))
            field*=np.asarray(mask)[:,:,None]/255
            pool=Image.fromarray(np.uint8(np.clip(field*255,0,255)))
            wall=Image.new('RGB',(213,250))
            lit=0
            for b in source:
                rgb=light.get(b['id'])
                if rgb is None or not max(rgb):continue
                lit+=1
                paint(wall,b['shape'],tuple(int(min(255,c*255)) for c in rgb),bounds,WALL_STEP)
            pool_image.paste(pool,(0,(9-segment)*500));wall_image.paste(wall,(0,(9-segment)*250))
            segments.append(dict(segment=segment,lamps=len(lamps),litBuildings=lit,rejected=rejected))
            print(band['id'],segment,'lamps',len(lamps),'lit buildings',lit,flush=True)
        field=np.zeros((5000,425,3),np.float32)
        for x,y,z,nx,ny,h,power in all_lamps:stamp(field,x+nx*1.5,y+ny*1.5,[.115,.086,.052],[-1700,-20000,1700,20000],POOL_STEP)
        field*=np.asarray(pool_mask)[:,:,None]/255
        Image.fromarray(np.uint8(np.clip(field*255,0,255))).save(output/(band['id']+'-pools.png'),optimize=True)
        wall_image.save(output/(band['id']+'-walls.png'),optimize=True)
        descriptor=save_tile(root/'derived',f'{args.name}/{band["id"]}-lamps.bin.gz',[dict(name='lamp-anchors',attributes={'instances':np.asarray(all_lamps,dtype=np.float32).flatten()})])
        report=dict(id=band['id'],ready=len(segments)==10,lamps=descriptor,count=len(all_lamps),segments=segments,
            windowsHash=windows['recipeHash'],pools=f'{args.name}/{band["id"]}-pools.png',walls=f'{args.name}/{band["id"]}-walls.png',
            bounds=[-1700,-20000,1700,20000],poolSize=[425,5000],wallSize=[213,2500])
        write(output/(band['id']+'.json'),report);reports.append(report)
    bands={}
    for b in plan['bands']:
        f=output/(b['id']+'.json')
        if f.exists():bands[b['id']]=json.loads(f.read_text())
    write(output/'manifest.json',dict(version=1,ready=len(bands)==3 and all(b['ready'] for b in bands.values()),
        frames=[[b['id'],b['band'],b['frame']] for b in plan['bands']],bands=bands,
        design='PLATEAU road-edge fixtures + area mean of the shared facade occupancy',poolStepM=POOL_STEP,wallStepM=WALL_STEP,
        maxFixtureInstances=512,maxConcurrent=1,maxTextureBytes=3*(425*5000+213*2500)*4*4//3))


if __name__=='__main__':main()
