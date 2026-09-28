"""Source-located crossings and palace greenery; planting dimensions are design.

Keep OSM additions separately distributable from the unchanged PLATEAU source.
The manifest records the exact source ways and the geometric masks applied.
"""
import argparse
import collections
import hashlib
import json
import math
import sqlite3
from pathlib import Path

import numpy as np
from PIL import Image
from pyproj import Transformer
from shapely import make_valid, union_all
from shapely.geometry import LineString, Point, Polygon, box, mapping, shape
from shapely.affinity import affine_transform
from shapely.ops import linemerge, polygonize, transform

from audit_metro_coverage import dictionaries
from metro_geometry import Frame, Grid, merge, polygons, save_tile
from metro_surface_details import SurfaceDraper
from plan_tokyo_metro import write
from prepare_metro_overview import paint, source_buildings, source_ground, tile_specs

GREEN = {'wood':'#788a66','grass':'#9eaa80','scrub':'#879574'}


def geographic_features(features, bands):
    """Export standard GeoJSON longitude/latitude, not the colony's local metres."""
    geographic = Transformer.from_crs(6677,4326,always_xy=True)
    result = []
    for feature in features:
        frame = Frame(bands[feature['properties']['band']])
        matrix = frame.matrix.T
        projected = affine_transform(shape(feature['geometry']), [*matrix[0],*matrix[1],*frame.origin])
        result.append({**feature,'geometry':mapping(transform(geographic.transform,projected))})
    return result


def osm_geometries(path):
    data = json.loads(path.read_text())['elements']
    nodes = {e['id']:e for e in data if e['type']=='node'}
    ways = {e['id']:e for e in data if e['type']=='way'}
    project = Transformer.from_crs(4326,6677,always_xy=True)
    def points(way):
        if any(n not in nodes for n in way['nodes']):return None
        return [project.transform(nodes[n]['lon'],nodes[n]['lat']) for n in way['nodes']]
    for e in data:
        if e['type']=='way':
            p = points(e)
            if not p or len(p)<2:continue
            closed = e['nodes'][0]==e['nodes'][-1] and len(p)>3
            yield e, make_valid(Polygon(p)) if closed else LineString(p)
        elif e['type']=='relation' and e.get('tags',{}).get('type')=='multipolygon':
            rings = collections.defaultdict(list); complete = True
            for member in e['members']:
                if member['type']!='way':continue
                way = ways.get(member['ref']);p = points(way) if way else None
                if not p:complete=False;break
                rings[member.get('role') or 'outer'].append(LineString(p))
            if not complete or not rings['outer']:continue
            outer = union_all(list(polygonize(rings['outer'])))
            inner = union_all(list(polygonize(rings['inner'])))
            yield e, make_valid(outer.difference(inner))


def main():
    parser=argparse.ArgumentParser();parser.add_argument('--root',type=Path,required=True)
    args=parser.parse_args();root=args.root.resolve();output=root/'derived'/'finish-v1'
    refs=root/'finish-20260924'/'reference';plan=json.loads((root/'tokyo-metro-plan.json').read_text())
    surface=sqlite3.connect(f'file:{root}/metro-surfaces.sqlite?mode=ro&immutable=1',uri=True)
    buildings=sqlite3.connect(f'file:{root}/metro-source.sqlite?mode=ro&immutable=1',uri=True)
    codes=dictionaries(root);bands={b['id']:b for b in plan['bands']}
    records=[];geography=[];palace=bands[plan['sourcePins']['imperialPalace']['band']];pf=Frame(palace)
    green=collections.defaultdict(list);paths=[];source_ids=[]
    geo=Transformer.from_crs(4326,6677,always_xy=True)
    projected_box=box(*geo.transform(139.7425,35.6745),*geo.transform(139.764,35.6955))
    region=pf.shape(projected_box).intersection(box(*palace['bounds']))
    for e,shape in osm_geometries(refs/'palace-map.json'):
        t=e.get('tags',{});shape=pf.shape(shape).intersection(region)
        kind='wood' if t.get('natural')=='wood' or t.get('landuse')=='forest' else 'grass' if t.get('natural')=='grassland' or t.get('landuse')=='grass' else 'scrub' if t.get('natural')=='scrub' else None
        if kind and shape.area>1:
            green[kind].append(shape);source_ids.append(f'{e["type"]}/{e["id"]}')
        if t.get('highway') in ['footway','path','pedestrian'] and t.get('area')!='yes' and t.get('layer','0')=='0' and t.get('level','0')=='0' and t.get('tunnel')!='yes' and shape.geom_type in ['LineString','MultiLineString']:
            width=min(8,max(1.5,float(t.get('width','3').split()[0]))) if t.get('width','3').split()[0].replace('.','',1).isdigit() else 3
            paths.append(shape.buffer(width/2,cap_style=2,join_style=2))
    native=source_ground(surface,codes,palace,region.bounds)
    road=union_all([s for _,_,s,label in native if label=='道路用地'])
    water=union_all([s for _,_,s,label in native if label=='水面']).difference(road)
    buildings_mask=union_all([b['shape'] for b in source_buildings(buildings,palace,region.bounds)])
    hard=union_all([road,water,buildings_mask.buffer(.2)])
    cover={k:union_all(v).difference(hard) for k,v in green.items()}
    footways=union_all(paths).intersection(union_all(list(cover.values())).buffer(3)).difference(union_all([water,buildings_mask]))
    # The woods/grass data describe cover, not the outline of an entire park.
    # A park boundary may include plazas; do not paint that whole area green.
    occupied=footways
    for k in ['wood','scrub','grass']:
        cover[k]=cover.get(k,Polygon()).difference(occupied)
        occupied=union_all([occupied,cover[k]])
    garden=[(k,s,GREEN[k]) for k,s in cover.items()]+[('paths',footways,'#bbb5a4')]
    for kind,shape,colour in garden:
        geography.append(dict(type='Feature',properties=dict(kind=kind,band=palace['id'],colour=colour),geometry=mapping(shape)))

    shibuya=bands[plan['sourcePins']['shibuya']['band']];sf=Frame(shibuya);lines=[];crossing_ids=[]
    centre=Point(plan['sourcePins']['shibuya']['local'])
    for e,shape in osm_geometries(refs/'shibuya-map.json'):
        tags=e.get('tags',{})
        if tags.get('crossing:scramble')!='yes' or tags.get('crossing:markings')!='zebra':continue
        line=sf.shape(shape)
        if line.distance(centre)>65:continue
        lines.append(line);crossing_ids.append(f'{e["type"]}/{e["id"]}')
    lines=list(linemerge(union_all(lines)).geoms)
    assert len(lines)==5,('Expected five marked crossing paths after joining source splits',len(lines))
    stripes=[];crossings=[]
    for line in lines:
        diagonal=line.distance(centre)<5; width=9.5 if diagonal else 8
        for distance in np.arange(.5,line.length-.4,.9):
            a=line.interpolate(distance);b=line.interpolate(min(line.length,distance+.45))
            stripes.append(LineString([a,b]).buffer(width/2,cap_style=2,join_style=2))
        crossings.append(dict(centreline=mapping(line),widthM=width,lengthM=line.length))
    sbounds=centre.buffer(85).bounds;ground=source_ground(surface,codes,shibuya,sbounds)
    crossing_road=union_all([s for _,_,s,label in ground if label=='道路用地'])
    obstacles=union_all([b['shape'] for b in source_buildings(buildings,shibuya,sbounds)])
    original=union_all(stripes);markings=original.intersection(crossing_road).difference(obstacles.buffer(.25))
    assert markings.area/original.area>.90,('Crossings conflict with the original road/buildings',markings.area/original.area)
    geography.append(dict(type='Feature',properties=dict(kind='crossings',band=shibuya['id'],colour='#dcded7'),geometry=mapping(markings)))

    # Detail meshes use the very same 5 m triangles as the existing collision.
    for band,features in [(palace,garden),(shibuya,[('crossings',markings,'#dcded7')])]:
        grid=Grid(root,band['id']);all_shapes=union_all([s for _,s,_ in features])
        for tile in tile_specs(band):
            crop=box(*tile['bounds'])
            if not all_shapes.intersects(crop):continue
            draper=SurfaceDraper(grid,tile['bounds']);parts=[]
            for _,shape,colour in features:
                part=draper.paint(shape.intersection(crop),colour,lift=.04)
                if part:parts.append(part)
            merged=merge(parts)
            if not merged:continue
            descriptor=save_tile(root/'derived',f'finish-v1/landmarks/{band["id"]}-{tile["id"]}.bin.gz',
                [dict(name='landmark-surface-detail',colour='#ffffff',roughness=1,attributes=merged)])
            records.append(dict(id=tile['id'],band=band['id'],**descriptor,triangles=len(merged['index'])//3))

    # Keep distant LOD colours coherent without replacing or copying baseline tiles.
    overrides={}; textures=[]
    for tile in tile_specs(palace):
        if not occupied.intersects(box(*tile['bounds'])):continue
        for suffix,resolution,pixels in [('',.5,400),('-far',2,100)]:
            name=f'{palace["id"]}/tiles/{tile["id"]}{suffix}.png'
            textures.append((name,tile['gridBounds'],resolution))
    for segment in range(10):
        bounds=[-1700,-20000+segment*4000,1700,-16000+segment*4000]
        if occupied.intersects(box(*bounds)):
            textures.append((f'{palace["id"]}/overview-{segment}.png',bounds,4))
    for name,bounds,resolution in textures:
        with Image.open(root/'derived'/name) as source:
            image=source.convert('RGB')
        for _,shape,colour in garden:paint(image,shape,colour,bounds,resolution)
        destination='finish-v1/textures/'+name
        path=root/'derived'/destination;path.parent.mkdir(parents=True,exist_ok=True);image.save(path,optimize=True)
        overrides[name]=destination

    # A reproducible scatter inside mapped woodland; tree height and spacing
    # are artistic approximations, not a claim about individual real trees.
    planting=cover['wood'].difference(union_all([footways.buffer(3),hard.buffer(3)])).buffer(-3.2)
    grid=Grid(root,palace['id']);trees=[];x0,y0,x1,y1=planting.bounds
    for j in range(math.floor(y0/12),math.ceil(y1/12)):
        for i in range(math.floor(x0/12),math.ceil(x1/12)):
            seed=int(hashlib.sha256(f'{i}:{j}'.encode()).hexdigest()[:8],16)
            x=(i+.5)*12+((seed%101)/100-.5)*6;y=(j+.5)*12+(((seed//101)%101)/100-.5)*6
            if not planting.contains(Point(x,y)):continue
            height=6.5+((seed//10201)%101)/100*5
            trees.append([round(x,3),round(y,3),round(grid.height(x,y),3),round(height,3),round(height*.36,3),seed%4])
    tree_path='finish-v1/palace-trees.json'
    write(root/'derived'/tree_path,dict(band=palace['id'],trees=trees,source='Mapped woodland; designed tree spacing and heights'))
    # Distribute the OSM-derived geometry and conversion along with its credit.
    write(output/'osm-derived.geojson',dict(type='FeatureCollection',features=geographic_features(geography,bands)))
    write(output/'landmarks.json',dict(version=1,tiles=records,textures=overrides,trees=tree_path,
        sources=dict(vegetation=source_ids,crossings=crossing_ids),crossings=crossings,
        planting=dict(count=len(trees),woodlandAreaM2=cover['wood'].area),
        crossingRoadFraction=markings.area/original.area,
        attribution='© OpenStreetMap contributors / ODbL',license='https://www.openstreetmap.org/copyright',
        interpretation='Source lines/land cover retained. Stripe dimensions, path widths and individual tree planting are Spinward designs.'))
    print(json.dumps(dict(detailTiles=len(records),trees=len(trees),crossings=len(lines),textureOverrides=len(overrides),crossingRoadFraction=markings.area/original.area)),flush=True)
    surface.close();buildings.close()


if __name__=='__main__':main()
