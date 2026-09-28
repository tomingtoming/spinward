"""Pin three adjoining, full-size Tokyo strips before acquiring bulk geometry.

The output separates requested land, catalog extent, acquired source, and
rendered coverage. A building tileset bounding box never proves complete land.
All dimensions are in JGD2011 / Japan Plane Rectangular CS IX metres.
"""
import argparse
import concurrent.futures
import hashlib
import json
import math
import os
import zipfile
import tempfile
import errno
import shutil
from pathlib import Path
from urllib.parse import urlparse, urljoin

from pyproj import Transformer
from shapely.geometry import Polygon, Point, box, shape, mapping
from shapely import union_all
from shapely.ops import transform
from shapely.affinity import affine_transform

from geo import Frame, WIDTH, SPAN, RADIUS
from fetch_study import fetch
from fetch_band_sources import mesh_bounds

PINS = {
    'tachikawa': {'name': 'JR立川駅', 'position': [139.413944, 35.697889]},
    'kudanshita': {'name': '九段下駅', 'position': [139.751278, 35.695917]},
    'shimbashi': {'name': '新橋駅', 'position': [139.7581551, 35.6663485]},
}
SOURCES = [
    'https://mapfan.com/spots/SCH,J,J3N',
    'https://ja.dbpedia.org/page/九段下駅',
    'https://mapfan.com/spots/SCH,J,540',
]
REGIONS = [('south', '東京南帯'), ('central', '東京中央帯'), ('north', '東京北帯')]


def write(path, value):
    # Independent acquisition kinds may checkpoint concurrently.
    with tempfile.NamedTemporaryFile(mode='w',dir=path.parent,prefix=path.name+'.',suffix='.next',delete=False) as stream:
        temporary=Path(stream.name)
        stream.write(json.dumps(value,ensure_ascii=False,indent=2)+'\n')
    try:temporary.replace(path)
    finally:temporary.unlink(missing_ok=True)


def receipt_paths(root):
    # macOS writes binary AppleDouble ._*.json sidecars on exFAT volumes.
    return sorted(p for p in (root/'receipts').glob('*.json') if not p.name.startswith('.'))


def make_legacy_plan():
    project = Transformer.from_crs(6668, 6677, always_xy=True)
    pins = {key: {**pin, 'projected': list(project.transform(*pin['position']))} for key, pin in PINS.items()}
    west = pins['tachikawa']['projected']
    middle = [(a+b)/2 for a,b in zip(pins['kudanshita']['projected'], pins['shimbashi']['projected'])]
    direction = [middle[i]-west[i] for i in range(2)]
    length = math.hypot(*direction)
    east = [v/length for v in direction]
    north = [-east[1], east[0]]
    angle = math.atan2(east[1], east[0])
    base = [west[i] + east[i]*SPAN/2 for i in range(2)]
    # Reuse identical edge coordinates across neighbours. Independently
    # translated corners can differ by ulps and confuse polygon overlay.
    edges = [WIDTH/2-i*WIDTH for i in range(4)]
    inverse = Transformer.from_crs(6677, 6668, always_xy=True)
    bands = []
    for band, (id_, name) in enumerate(REGIONS):
        origin = [west[i] + east[i]*SPAN/2 + north[i]*WIDTH*band for i in range(2)]
        frame = Frame(6677, origin, angle)
        bounds = [-WIDTH/2, -SPAN/2, WIDTH/2, SPAN/2]
        # Frame.place has cross-band X positive to the south, axial Y east.
        projected_corners = [[base[i]-north[i]*x+east[i]*y for i in range(2)]
            for x,y in [(edges[band+1],-SPAN/2),(edges[band],-SPAN/2),(edges[band],SPAN/2),(edges[band+1],SPAN/2)]]
        corners = [list(inverse.transform(*p)) for p in projected_corners]
        bbox = [min(p[0] for p in corners), min(p[1] for p in corners), max(p[0] for p in corners), max(p[1] for p in corners)]
        cells = []
        for i in range(math.ceil(WIDTH/500)):
            for j in range(math.ceil(SPAN/500)):
                cells.append({'id': f'{i}-{j}', 'bounds': [-WIDTH/2+i*500, -SPAN/2+j*500,
                    min(WIDTH/2,-WIDTH/2+(i+1)*500), min(SPAN/2,-SPAN/2+(j+1)*500)],
                    'acquired': False, 'rendered': False})
        # Source X increases southward. Decreasing cylinder band indices keeps
        # adjoining Earth edges facing each other across one 60-degree window.
        bands.append(dict(id=id_, name=name, band=(-band)%3, sourceStripIndex=band, frame=dict(epsg=6677, origin=origin, angle=angle),
            bounds=bounds, anchor=dict(name=name,local=[0,0],position=list(frame.geographic(0,0))),
            corners=corners,projectedCorners=projected_corners,bbox=bbox,areaKm2=WIDTH*SPAN/1e6, cells=cells))
        if band == 0:
            for pin in pins.values():
                pin['southBandLocal'] = list(frame.place(*pin['position']))
                pin['crossBandMarginM'] = WIDTH/2-abs(pin['southBandLocal'][0])
    return dict(version=1, origin='collaborative', created='2026-09-23', radius=RADIUS, width=WIDTH, span=SPAN,
        areaKm2=3*WIDTH*SPAN/1e6, sourcePins=pins, pinSources=SOURCES,
        design='Three adjoining Earth strips; no designed-land substitute for missing source coverage',
        projection='JGD2011 / Japan Plane Rectangular CS IX (EPSG:6677)',
        axis=dict(east=east,north=north,projectedAngleRadians=angle), bands=bands,
        coverageStatus='boundaries only; source acquisition and runtime coverage unproven')


def make_plan(layout='inland-b'):
    if layout == 'legacy':return make_legacy_plan()
    assert layout == 'inland-b'
    # Accepted comparison B, measured in EPSG:6677 relative to Shibuya.
    # Increasing local X moves westward; increasing Y approaches the port.
    angle=math.radians(-80);left=-7203.167883363365;end=700.0
    project=Transformer.from_crs(6668,6677,always_xy=True)
    inverse=Transformer.from_crs(6677,6668,always_xy=True)
    shibuya=[139.70056,35.65950];base=project.transform(*shibuya)
    c,s=math.cos(angle),math.sin(angle)
    point=lambda x,y:[base[0]+x*s+y*c,base[1]-x*c+y*s]
    edges=[left+i*WIDTH for i in range(4)];bands=[]
    for i,(id_,name) in enumerate([('east','東帯・皇居方面'),('central','中央帯'),('west','西帯・渋谷／大宮方面')]):
        origin=point((edges[i]+edges[i+1])/2,end-SPAN/2)
        frame=Frame(6677,origin,angle);bounds=[-WIDTH/2,-SPAN/2,WIDTH/2,SPAN/2]
        corners_xy=[point(x,y) for x,y in [(edges[i],end-SPAN),(edges[i+1],end-SPAN),(edges[i+1],end),(edges[i],end)]]
        corners=[list(inverse.transform(*p)) for p in corners_xy]
        cells=[dict(id=f'{a}-{b}',bounds=[-WIDTH/2+a*500,-SPAN/2+b*500,
                    min(WIDTH/2,-WIDTH/2+(a+1)*500),min(SPAN/2,-SPAN/2+(b+1)*500)],acquired=False,rendered=False)
               for a in range(math.ceil(WIDTH/500)) for b in range(math.ceil(SPAN/500))]
        bands.append(dict(id=id_,name=name,band=i,sourceStripIndex=i,frame=dict(epsg=6677,origin=origin,angle=angle),
            bounds=bounds,anchor=dict(name=name,local=[0,0],position=list(frame.geographic(0,0))),
            corners=corners,projectedCorners=corners_xy,bbox=list(Polygon(corners).bounds),areaKm2=WIDTH*SPAN/1e6,cells=cells))
    pins={
        'shibuya':dict(name='渋谷スクランブル交差点',position=shibuya),
        'imperialPalace':dict(name='皇居・北の丸（保全範囲の中心）',position=[139.75325,35.685]),
        'omiya':dict(name='JR大宮駅',position=[139.6238012332773,35.90628126122779]),
        'saitamaShintoshin':dict(name='JRさいたま新都心駅',position=[139.6339,35.893595]),
    }
    for pin in pins.values():
        pin['projected']=list(project.transform(*pin['position']))
        matches=[b for b in bands if Polygon(b['projectedCorners']).covers(Point(pin['projected']))]
        assert len(matches)==1,pin['name']
        b=matches[0];pin['band']=b['id'];pin['local']=list(Frame(**b['frame']).place(*pin['position']))
        pin['boundaryMarginM']=Polygon(b['projectedCorners']).boundary.distance(Point(pin['projected']))
    protected=[dict(id='shibuya-neighbourhood',band='west',minimumMarginM=120,
                    geometry=mapping(Point(base).buffer(300))),
               dict(id='imperial-palace-envelope',band='east',minimumMarginM=120,
                    geometry=mapping(transform(project.transform,box(139.7425,35.6745,139.764,35.6955))))]
    return dict(version=2,origin='collaborative',created='2026-09-24',layout=layout,
        radius=RADIUS,width=WIDTH,span=SPAN,areaKm2=3*WIDTH*SPAN/1e6,defaultRegion='west',sourcePins=pins,
        protectedAreas=protected,pinSources=['https://www.gotokyo.org/jp/spot/78/',
            'https://nlftp.mlit.go.jp/ksj/gml/datalist/KsjTmplt-N02-v3_1.html'],
        design='Accepted inland B: palace and Shibuya, no coast, downtown at the port end',
        projection='JGD2011 / Japan Plane Rectangular CS IX (EPSG:6677)',
        axis=dict(along=[c,s],cross=[s,-c],projectedAngleRadians=angle),
        selection=dict(origin=shibuya,crossMinM=left,alongMaxM=end),bands=bands,
        coverageStatus='boundaries only; source acquisition and runtime coverage unproven')


def verify_boundaries(plan):
    polygons=[]
    for b in plan['bands']:
        f=b['frame']
        polygons.append(Polygon(b['projectedCorners']))
        cells=[box(*cell['bounds']) for cell in b['cells']]
        assert abs(sum(cell.area for cell in cells)-WIDTH*SPAN)<.01
        assert box(*b['bounds']).symmetric_difference(union_all(cells)).area<.01
        frame=Frame(f['epsg'],f['origin'],f['angle'])
        c,s=math.cos(f['angle']),math.sin(f['angle'])
        expected=[[f['origin'][0]+x*s+y*c,f['origin'][1]-x*c+y*s]
                  for x,y in [(-WIDTH/2,-SPAN/2),(WIDTH/2,-SPAN/2),(WIDTH/2,SPAN/2),(-WIDTH/2,SPAN/2)]]
        assert all(math.dist(a,b)<.001 for a,b in zip(expected,b['projectedCorners'])), 'Frame and boundary disagree'
        for x,y in [(-WIDTH/2,-SPAN/2),(WIDTH/2,SPAN/2),(0,0)]:
            assert math.dist(frame.place(*frame.geographic(x,y)),(x,y))<.001
    area=sum(p.area for p in polygons)
    union=union_all(polygons)
    assert abs(area-union.area)<.01, 'Overlapping strips'
    assert abs(union.convex_hull.area-area)<.01, 'Gap between strips'
    assert abs(area-plan['areaKm2']*1e6)<.01
    if plan.get('layout')=='inland-b':
        by_id={b['id']:Polygon(b['projectedCorners']) for b in plan['bands']}
        for protected in plan['protectedAreas']:
            protected_shape=shape(protected['geometry']);band=by_id[protected['band']]
            assert band.covers(protected_shape) and band.boundary.distance(protected_shape)>=protected['minimumMarginM'],protected['id']+' outside protected margin'
        for pin in plan['sourcePins'].values():
            assert by_id[pin['band']].covers(Point(pin['projected'])),pin['name']+' outside band'
    else:
        for key in ['kudanshita','shimbashi']:
            assert plan['sourcePins'][key]['crossBandMarginM']>0, key+' outside south band'
    return dict(passed=True,areaKm2=area/1e6,unionAreaKm2=union.area/1e6,
                overlapM2=area-union.area,gapM2=union.convex_hull.area-union.area,
                cells=sum(len(b['cells']) for b in plan['bands']),scope='boundaries, not source completeness')


def cached_fetch(root, source, url, limit=80_000_000):
    name=hashlib.sha256(url.encode()).hexdigest()[:24]+Path(urlparse(url).path).suffix
    target=root/'raw'/name
    old=source/'raw'/name
    if not target.exists() and old.exists():
        target.parent.mkdir(parents=True,exist_ok=True)
        reuse_file(old,target)
    return fetch(root,url,limit)


def reuse_file(source,target):
    """Keep old caches immutable; external volumes may not support hardlinks."""
    try:os.link(source,target)
    except OSError as error:
        if error.errno not in (errno.EXDEV,errno.EPERM,errno.ENOTSUP):raise
        with tempfile.NamedTemporaryFile(dir=target.parent,prefix=target.name+'.',suffix='.next',delete=False) as stream:
            temporary=Path(stream.name)
            try:
                with source.open('rb') as original:shutil.copyfileobj(original,stream,1024*1024)
            except BaseException:temporary.unlink(missing_ok=True);raise
        try:temporary.replace(target)
        finally:temporary.unlink(missing_ok=True)


def building_datasets(catalog,code):
    return [d for d in catalog if (d.get('ward_code') or d.get('city_code'))==code
            and d['type_en']=='bldg' and d['format']=='3D Tiles' and d['lod']=='1']


def municipal_sources(municipalities,catalog,metadata):
    result=[]
    for code,municipality in municipalities.items():
        options=building_datasets(catalog,code)
        parent=next((d['city_code'] for d in options if d.get('ward_code')==code),code)
        source=metadata.get(code) or metadata.get(parent)
        source=source or dict(cityCode=parent,files={},metadataZipUrls=[])
        result.append({**source,'cityCode':code,'cityName':municipality['cityName'],'surfaceCityCode':source['cityCode']})
    return result


def region_polygon(frame, region):
    lo,la,hi,ha=map(math.degrees,region[:4])
    return Polygon([frame.place(x,y) for x,y in [(lo,la),(hi,la),(hi,ha),(lo,ha)]])


def administrative_inventory(plan, source, root):
    """Independent municipal polygons prevent catalog absence hiding a city."""
    projector = Transformer.from_crs(6668, 6677, always_xy=True)
    requested = union_all([Polygon(b['projectedCorners']) for b in plan['bands']])
    by_code = {}; receipts = []
    for prefecture in ('11', '13'):
        url = f'https://nlftp.mlit.go.jp/ksj/gml/data/N03/N03-2026/N03-20260101_{prefecture}_GML.zip'
        receipt = cached_fetch(root, source, url); receipts.append(receipt)
        with zipfile.ZipFile(root / receipt['path']) as archive:
            names = [name for name in archive.namelist() if name.endswith('.geojson')]
            assert len(names) == 1, names
            data = json.loads(archive.read(names[0]))
        for feature in data['features']:
            geometry = transform(projector.transform, shape(feature['geometry']))
            if not geometry.intersects(requested): continue
            cut = geometry.intersection(requested)
            if cut.area < .01: continue
            props = feature['properties']; code = str(props['N03_007'])
            record = by_code.setdefault(code, dict(cityCode=code,
                cityName=props.get('N03_005') or props['N03_004'], prefecture=props['N03_001'], pieces=[]))
            record['pieces'].append(cut)
    municipalities = {}
    for code, record in by_code.items():
        municipalities[code] = {k:v for k,v in record.items() if k != 'pieces'}
        municipalities[code]['geometry'] = union_all(record['pieces'])
    covered = union_all([c['geometry'] for c in municipalities.values()])
    if plan.get('layout')=='inland-b':
        assert requested.difference(covered).area<1, 'Inland crop crosses the coast or lacks administrative coverage'
    plan['administrativeAudit'] = dict(sources=receipts, municipalities=len(municipalities),
        requestedAreaKm2=requested.area/1e6, coveredAreaKm2=covered.area/1e6,
        unclassifiedAreaM2=requested.difference(covered).area,
        source='MLIT National Land Numerical Information N03, 2026-01-01',
        interpretation='Administrative extent only; not buildings/land-use completeness')
    write(root/'administrative-boundaries.geojson', dict(type='FeatureCollection',
        crs=dict(type='name', properties=dict(name='EPSG:6677')),
        features=[dict(type='Feature', properties={k:v for k,v in c.items() if k!='geometry'},
                       geometry=mapping(c['geometry'])) for c in municipalities.values()]))
    print('municipalities', json.dumps(plan['administrativeAudit'], ensure_ascii=False), flush=True)
    return municipalities


def inventory(plan, source, root):
    municipalities=administrative_inventory(plan,source,root)
    catalog_path=source/'catalog.json'
    catalog=json.loads(catalog_path.read_text())['datasets']
    # A bounding box around all slanted strips includes unrelated cities and
    # exceeds the API's 50-city cap. Query individual strips and union by URL.
    metadata_receipts=[];raw_cities={}
    for band in plan['bands']:
        url='https://api.plateauview.mlit.go.jp/datacatalog/citygml/r:'+','.join(map(str,band['bbox']))+'?types=tran,luse,wtr'
        receipt=cached_fetch(root,source,url);metadata_receipts.append(receipt)
        metadata=json.loads((root/receipt['path']).read_text())
        for city in metadata['cities']:
            existing=raw_cities.setdefault(city['cityCode'],{**city,'files':{},'metadataZipUrls':[]})
            for kind,files in city['files'].items():
                by_url={f['url']:f for f in existing['files'].get(kind,[])}
                by_url.update({f['url']:f for f in files});existing['files'][kind]=list(by_url.values())
            existing['metadataZipUrls']=sorted(set(existing['metadataZipUrls'])|set(city['metadataZipUrls']))
    # Keep absent metadata as an explicit missing municipality, never omit it.
    raw_cities=municipal_sources(municipalities,catalog,raw_cities)
    plan['catalog']=dict(path=str(catalog_path.resolve()),sha256=hashlib.sha256(catalog_path.read_bytes()).hexdigest())
    plan['metadata']=metadata_receipts

    def city_inventory(city):
        code=city['cityCode']
        options=building_datasets(catalog,code)
        if not options:return code,dict(cityCode=code,cityName=city.get('cityName',code),error='No LOD1 buildings in pinned catalog')
        year=max(int(d['year']) for d in options)
        dataset=sorted([d for d in options if int(d['year'])==year],key=lambda d:(bool(d.get('texture')),d['url']))[0]
        receipt=cached_fetch(root,source,dataset['url'])
        return code,dict(cityCode=code,cityName=city.get('cityName',code),dataset=dataset,tileset=receipt,
                         files=city['files'],metadataZipUrls=city['metadataZipUrls'],surfaceCityCode=city['surfaceCityCode'])

    with concurrent.futures.ThreadPoolExecutor(max_workers=3) as pool:
        cities=dict(pool.map(city_inventory,raw_cities))
    unique_buildings={};unique_surfaces={}
    for band in plan['bands']:
        f=band['frame'];frame=Frame(f['epsg'],f['origin'],f['angle']);corridor=box(*band['bounds'])
        band['cities']=[];band['missing']=[];building_regions=[];surface_regions=[]
        for code,city in cities.items():
            c,s=math.cos(f['angle']),math.sin(f['angle']);ox,oy=f['origin']
            municipal=affine_transform(municipalities[code]['geometry'],[s,-c,c,s,-ox*s+oy*c,-ox*c-oy*s])
            municipal_cut=municipal.intersection(corridor)
            if municipal_cut.area<.01:continue
            if 'error' in city:
                band['missing'].append(city);continue
            tree=json.loads((root/city['tileset']['path']).read_text());leaves=[]
            def walk(node):
                assert 'transform' not in node, 'Tile transform needs explicit handling'
                assert 'region' in node['boundingVolume'], 'Non-geographic tile needs explicit handling'
                polygon=region_polygon(frame,node['boundingVolume']['region'])
                if not polygon.intersects(corridor):return
                if node.get('children'):
                    assert node.get('refine','REPLACE')=='REPLACE'
                    for child in node['children']:walk(child)
                elif node.get('content'):
                    # Geometric error is a renderer's screen-space metric, not source LOD.
                    # New 3D Tiles 1.1 GLBs may retain a non-zero error at their leaves.
                    uri=node['content']['uri']
                    record=dict(url=urljoin(city['dataset']['url'],uri),region=node['boundingVolume']['region'],
                        geometricError=node['geometricError'],contentFormat=Path(urlparse(uri).path).suffix[1:])
                    leaves.append(record);building_regions.append(polygon);unique_buildings[record['url']]=record
            walk(tree['root'])
            files={}
            for kind,items in city['files'].items():
                for item in items:
                    lo,la,hi,ha=mesh_bounds(item['code'])
                    polygon=Polygon([frame.place(x,y) for x,y in [(lo,la),(hi,la),(hi,ha),(lo,ha)]])
                    if not polygon.intersects(municipal_cut):continue
                    files.setdefault(kind,[]).append(item);unique_surfaces[item['url']]={**item,'kind':kind}
                    surface_regions.append(polygon.intersection(municipal_cut))
            band['cities'].append({**city,'areaKm2':municipal_cut.area/1e6,'buildings':leaves,'files':files})
        buildings=union_all(building_regions);surfaces=union_all(surface_regions)
        for cell in band['cells']:
            shape=box(*cell['bounds'])
            cell['buildingCatalogExtentFraction']=round(shape.intersection(buildings).area/shape.area,6)
            cell['surfaceFileMeshFraction']=round(shape.intersection(surfaces).area/shape.area,6)
        band['catalogSummary']=dict(cities=len(band['cities']),buildingTiles=sum(len(c['buildings']) for c in band['cities']),
            surfaceFiles=sum(len(v) for c in band['cities'] for v in c['files'].values()),
            cellsWithoutBuildingCatalogExtent=sum(c['buildingCatalogExtentFraction']==0 for c in band['cells']),
            cellsWithoutSurfaceFileMesh=sum(c['surfaceFileMeshFraction']==0 for c in band['cells']),
            interpretation='Index extents only. Water, parks and source gaps require actual geometry/mask auditing; acquired/rendered remain false.')
        print(band['id'],json.dumps(band['catalogSummary'],ensure_ascii=False),flush=True)
    plan['acquisitionEstimate']=dict(uniqueBuildingTiles=len(unique_buildings),uniqueSurfaceFiles=len(unique_surfaces),
        surfaceKnownOriginalBytes=sum(f.get('fileSize',0) for f in unique_surfaces.values()),
        surfaceFilesWithUnknownBytes=sum('fileSize' not in f for f in unique_surfaces.values()),
        buildingOriginalBytes=None,buildingBytesStatus='Not measured; HEAD/content receipts required',
        uniqueByURL=True)
    plan['coverageStatus']='catalog indexed; source acquisition and runtime coverage unproven'
    return plan


def main():
    parser=argparse.ArgumentParser();parser.add_argument('--root',type=Path,required=True)
    parser.add_argument('--source',type=Path);parser.add_argument('--metadata',action='store_true')
    parser.add_argument('--layout',choices=['inland-b','legacy'],default='inland-b')
    args=parser.parse_args();root=args.root.resolve();root.mkdir(parents=True,exist_ok=True)
    plan=make_plan(args.layout);audit=verify_boundaries(plan)
    prior_path=root/'tokyo-metro-plan.json'
    if prior_path.exists():
        prior=json.loads(prior_path.read_text())
        assert [(b['id'],b['frame']) for b in prior['bands']]==[(b['id'],b['frame']) for b in plan['bands']], 'Changed geographic crop requires a fresh data root'
    write(root/'boundary-audit.json',audit)
    features=[]
    for band in plan['bands']:
        features.append(dict(type='Feature',properties={k:band[k] for k in ['id','name','band','areaKm2']},
                             geometry=dict(type='Polygon',coordinates=[band['corners']+[band['corners'][0]]])))
    for id_,pin in plan['sourcePins'].items():
        features.append(dict(type='Feature',properties=dict(id=id_,name=pin['name']),geometry=dict(type='Point',coordinates=pin['position'])))
    write(root/'tokyo-metro-boundaries.geojson',dict(type='FeatureCollection',features=features))
    write(root/'tokyo-metro-plan.json',plan)
    if args.metadata:
        if not args.source:raise ValueError('--metadata requires --source for the pinned catalog')
        plan=inventory(plan,args.source.resolve(),root)
        write(root/'tokyo-metro-plan.json',plan)
    print(json.dumps(dict(boundaryAudit=audit,acquisitionEstimate=plan.get('acquisitionEstimate')),ensure_ascii=False),flush=True)


if __name__=='__main__':main()
