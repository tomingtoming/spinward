"""Measure actual source polygons per 500 m cell; catalog boxes are not coverage.

The land-use union classifies ground including built-up parcels, parks, rivers
and roads. Counts of buildings are separately reported, never interpreted as
land-cover area. Incomplete cells remain explicitly pending.
"""
import argparse
import gzip
import json
import math
import sqlite3
import zipfile
import io
import xml.etree.ElementTree as ET
from pathlib import Path
from shapely import from_wkb, union_all
from shapely.geometry import Polygon, mapping
from plan_tokyo_metro import write, receipt_paths


def projected_cell(band,bounds):
    f=band['frame'];ox,oy=f['origin'];c,s=math.cos(f['angle']),math.sin(f['angle'])
    x0,y0,x1,y1=bounds
    return Polygon([(ox+x*s+y*c,oy-x*c+y*s) for x,y in [(x0,y0),(x1,y0),(x1,y1),(x0,y1)]])


def query(db,table,shape,columns,condition=''):
    x0,y0,x1,y1=shape.bounds
    index='building_index' if table=='buildings' else 'surface_index'
    return db.execute(f'SELECT {columns} FROM {table} s JOIN {index} i ON s.rowid=i.rowid '
        f'WHERE i.max_x>=? AND i.min_x<=? AND i.max_y>=? AND i.min_y<=? {condition}',(x0,x1,y0,y1))


def dictionaries(root):
    codes={}
    for path in receipt_paths(root):
        row=json.loads(path.read_text())
        if row['kind']!='codelist' or row['status']!='acquired':continue
        path=root/row['path'];data=path.read_bytes()
        if row.get('compression')=='gzip':data=gzip.decompress(data)
        with zipfile.ZipFile(io.BytesIO(data)) as archive:
            for name in archive.namelist():
                if not name.endswith('.xml'):continue
                values={}
                for element in ET.fromstring(archive.read(name)).iter('{http://www.opengis.net/gml}Definition'):
                    key=element.findtext('{http://www.opengis.net/gml}name');value=element.findtext('{http://www.opengis.net/gml}description')
                    if key and value:values[key]=value
                codes[(row['cityCode'],Path(name.replace('\\','/')).name)]=values
    return codes


def main():
    parser=argparse.ArgumentParser();parser.add_argument('--root',type=Path,required=True);parser.add_argument('--stride',type=int,default=1)
    args=parser.parse_args();root=args.root.resolve();plan=json.loads((root/'tokyo-metro-plan.json').read_text())
    buildings=sqlite3.connect(f'file:{root}/metro-source.sqlite?mode=ro',uri=True)
    surfaces=sqlite3.connect(f'file:{root}/metro-surfaces.sqlite?mode=ro',uri=True)
    codes=dictionaries(root);classes=[];unknown=[]
    for city,code,space,count in surfaces.execute("SELECT city_code,class_code,code_space,count(*) FROM surfaces WHERE kind='luse' GROUP BY city_code,class_code,code_space"):
        label=codes.get((city,Path(space).name),{}).get(code) if space else None
        item=dict(sourceCityCode=city,code=code,dictionary=space,label=label,features=count)
        classes.append(item)
        if not label:unknown.append(item)
    report=dict(version=1,scope='Actual loaded geometry; not a full-data or runtime acceptance',
                stride=args.stride,complete=False,classes=classes,unknownClasses=unknown,bands=[])
    gaps=[]
    for band in plan['bands']:
        cells=[]
        for cell in band['cells'][::args.stride]:
            shape=projected_cell(band,cell['bounds']);polygons={kind:[] for kind in ['luse','tran','wtr']}
            for kind,blob in query(surfaces,'surfaces',shape,'s.kind,s.geometry'):
                polygon=from_wkb(blob)
                if polygon.intersects(shape):polygons[kind].append(polygon.intersection(shape))
            coverage={kind:union_all(parts) for kind,parts in polygons.items()}
            actual=union_all(list(coverage.values()));gap=shape.difference(actual)
            count=sum(from_wkb(blob).intersects(shape) for (blob,) in query(buildings,'buildings',shape,'s.footprint'))
            row=dict(id=cell['id'],areaM2=shape.area,buildingCount=int(count),
                fractions={kind:coverage[kind].area/shape.area for kind in polygons},
                classifiedGroundFraction=actual.area/shape.area,unclassifiedAreaM2=gap.area)
            cells.append(row)
            if gap.area>1: gaps.append(dict(type='Feature',properties=dict(band=band['id'],cell=cell['id'],areaM2=gap.area),geometry=mapping(gap)))
        summary=dict(id=band['id'],cells=cells,checkedCells=len(cells),totalCells=len(band['cells']),
                     classifiedGroundFraction=sum(c['areaM2']-c['unclassifiedAreaM2'] for c in cells)/sum(c['areaM2'] for c in cells),
                     cellsWithUnclassifiedGround=sum(c['unclassifiedAreaM2']>1 for c in cells))
        report['bands'].append(summary);print(band['id'],{k:v for k,v in summary.items() if k!='cells'},flush=True)
    write(root/'geometry-coverage-audit.json',report)
    write(root/'geometry-coverage-gaps.geojson',dict(type='FeatureCollection',crs=dict(type='name',properties=dict(name='EPSG:6677')),features=gaps))
    buildings.close();surfaces.close()


if __name__=='__main__':main()
