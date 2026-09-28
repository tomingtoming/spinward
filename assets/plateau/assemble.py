"""Build offline, metre-scale study meshes from source geometry, with provenance.

uv run --with pyproj==3.7.2 --with shapely==2.1.2 python assets/plateau/assemble.py --root PATH
No speculative buildings, roads or greenery are generated in uncovered areas.
"""
import argparse
import collections
import hashlib
import gzip
import json
import math
import subprocess
import xml.etree.ElementTree as ET
import zipfile
from pathlib import Path
import numpy as np
from pyproj import Transformer
from shapely import constrained_delaunay_triangles, make_valid
from shapely.geometry import Polygon, box
from geo import Frame, RADIUS, SPAN, WIDTH
from fetch_study import tile_xy

G = '{http://www.opengis.net/gml}'
STEP = 20.0
PALETTE = {'terrain':'#b6b7a6', 'buildings':'#ede6d6', 'roads':'#555b60',
           'water':'#628f99', '田':'#aabb76', '畑':'#b4a779', '山林':'#788e6e',
           'その他自然地':'#91a078', '公共空地':'#b5bea5'}


def source_open(path):
    return gzip.open(path,'rb') if str(path).endswith('.gz') else open(path,'rb')


def city_members(path):
    """Release each source feature after use, even for 500 MB municipality files."""
    with source_open(path) as stream:
        context=ET.iterparse(stream,events=('start','end'));root=None
        for event,element in context:
            if event=='start':
                if root is None:root=element
                if 'srsName' in element.attrib:assert element.attrib['srsName'].endswith('/6697')
            elif element.tag.endswith('cityObjectMember'):
                yield element
                element.clear();root.clear()


def polygon_parts(g):
    if g.is_empty: return
    if g.geom_type == 'Polygon': yield g
    elif hasattr(g,'geoms'):
        for p in g.geoms: yield from polygon_parts(p)


class Mesh:
    def __init__(self): self.positions=[];self.indices=[]
    def add(self, vertices, indices):
        start=len(self.positions);self.positions.extend(vertices)
        self.indices.extend((np.asarray(indices,dtype=np.uint32)+start).tolist())
    def save(self, folder, name):
        p=np.asarray(self.positions,dtype='<f4');i=np.asarray(self.indices,dtype='<u4')
        assert p.size and np.isfinite(p).all() and i.max()<len(p)
        p.tofile(folder/(name+'.positions.bin'));i.tofile(folder/(name+'.indices.bin'))
        return dict(name=name,vertices=len(p),triangles=len(i)//3,
                    positions=name+'.positions.bin',indices=name+'.indices.bin',
                    sha256=hashlib.sha256(p.tobytes()+i.tobytes()).hexdigest())


class Terrain:
    def __init__(self, root, sample, frame):
        self.frame=frame;self.sample=sample;self.half=sample['half'];self.stats=collections.Counter()
        self.bounds=sample.get('bounds',[-self.half,-self.half,self.half,self.half])
        self.tiles={}
        for d in sample['dem']:
            with source_open(root/d['path']) as stream:
                self.tiles[(d['layer'],d['z'],d['x'],d['y'])]=np.array([
                    [float(v) if v!='e' else np.nan for v in l.split(',')]
                    for l in stream.read().decode().splitlines()])
        self.cx,self.cy=sample['anchor']['local']
        self.baseline=self.raw(self.cx,self.cy)
        # The hill town needs the source DEM's finer relief; a 20 m mesh buries low outbuildings.
        spacing=5.0 if sample['id']=='tama' else STEP
        x0,y0,x1,y1=self.bounds
        self.axis=np.linspace(x0,x1,round((x1-x0)/spacing)+1)
        self.yaxis=np.linspace(y0,y1,round((y1-y0)/spacing)+1)
        self.z=np.array([[self.raw(self.cx+x,self.cy+y)-self.baseline for x in self.axis] for y in self.yaxis])
        self.step=self.axis[1]-self.axis[0]
        self.patches=[]
        patch_file=root/'terrain-patches.json'
        specs=json.loads(patch_file.read_text()).get(sample['id'],[]) if patch_file.exists() else []
        for spec in specs:
            x0,y0,x1,y1=spec['bounds'];step=spec['step'];xs=np.arange(x0,x1+step*.1,step);ys=np.arange(y0,y1+step*.1,step);rows=[]
            for y in ys:
                row=[]
                for x in xs:
                    edge=min(x-x0 if x0>self.bounds[0] else math.inf,x1-x if x1<self.bounds[2] else math.inf,y-y0 if y0>self.bounds[1] else math.inf,y1-y if y1<self.bounds[3] else math.inf)
                    blend=min(1,max(0,edge/20));blend=blend*blend*(3-2*blend)
                    coarse=self.coarse_height(x,y);raw=self.raw(self.cx+x,self.cy+y)-self.baseline
                    row.append(float(coarse+(raw-coarse)*blend))
                rows.append(row)
            self.patches.append(dict(bounds=[x0,y0,x1,y1],step=step,terrainOrigin=[x0,y0],axis=xs.tolist(),heights=rows))
        # Keep coarse-grid boundary samples consistent for the colony transition.
        for j,y in enumerate(self.yaxis):
            for i,x in enumerate(self.axis):
                patch=self.patch_at(x,y)
                if patch:self.z[j,i]=self.patch_height(patch,x,y)

    def raw(self,x,y):
        lon,lat=self.frame.geographic(x,y)
        # GSI elevation samples are at pixel centres. Bilinear interpolation needs all four.
        for layer in ('dem5a','dem'):
            tx,ty=tile_xy(lon,lat,14);px,py=tx*256-.5,ty*256-.5
            ix,iy=math.floor(px),math.floor(py);a,b=px-ix,py-iy;values=[]
            for ox,oy in [(0,0),(1,0),(0,1),(1,1)]:
                gx,gy=ix+ox,iy+oy;t=self.tiles.get((layer,14,gx//256,gy//256))
                values.append(t[gy%256,gx%256] if t is not None else np.nan)
            if np.isfinite(values).all():
                self.stats[layer]+=1
                return (1-b)*((1-a)*values[0]+a*values[1])+b*((1-a)*values[2]+a*values[3])
        raise ValueError(f'Uncovered DEM sample: {lon}, {lat}')

    def patch_at(self,x,y):
        return next((p for p in self.patches if p['bounds'][0]<=x<=p['bounds'][2] and p['bounds'][1]<=y<=p['bounds'][3]),None)

    @staticmethod
    def patch_height(p,x,y):
        u=(x-p['terrainOrigin'][0])/p['step'];v=(y-p['terrainOrigin'][1])/p['step'];z=p['heights'];i=max(0,min(len(p['axis'])-2,math.floor(u)));j=max(0,min(len(z)-2,math.floor(v)));a=u-i;b=v-j
        return z[j][i]+a*(z[j][i+1]-z[j][i])+b*(z[j+1][i+1]-z[j][i+1]) if a>=b else z[j][i]+b*(z[j+1][i]-z[j][i])+a*(z[j+1][i+1]-z[j+1][i])

    def height(self,x,y):
        p=self.patch_at(x,y)
        return self.patch_height(p,x,y) if p else self.coarse_height(x,y)

    def coarse_height(self,x,y):
        # Exact same two piecewise planar triangles as mesh(), also used by road/land overlays.
        u=(x-self.bounds[0])/self.step;v=(y-self.bounds[1])/self.step
        i=min(len(self.axis)-2,max(0,math.floor(u)));j=min(len(self.yaxis)-2,max(0,math.floor(v)))
        a,b=u-i,v-j
        z00,z10,z01,z11=self.z[j,i],self.z[j,i+1],self.z[j+1,i],self.z[j+1,i+1]
        return z00+a*(z10-z00)+b*(z11-z10) if a>=b else z00+b*(z01-z00)+a*(z11-z01)

    def cells(self,bounds):
        x0,y0,x1,y1=bounds;n=len(self.axis)-1;m=len(self.yaxis)-1
        i0=max(0,math.floor((x0-self.bounds[0])/self.step));i1=min(n-1,math.floor((x1-self.bounds[0])/self.step))
        j0=max(0,math.floor((y0-self.bounds[1])/self.step));j1=min(m-1,math.floor((y1-self.bounds[1])/self.step))
        for j in range(j0,j1+1):
            for i in range(i0,i1+1):
                x,y=self.axis[i],self.yaxis[j];patch=self.patch_at(x+self.step/2,y+self.step/2);step=patch['step'] if patch else self.step
                for yy in np.arange(y,y+self.step-step*.1,step):
                    for xx in np.arange(x,x+self.step-step*.1,step):yield xx,yy,step

    def mesh(self):
        mesh=Mesh();n=len(self.axis)
        if not self.patches:
            mesh.positions=[[float(x),float(y),float(self.z[j,i])] for j,y in enumerate(self.yaxis) for i,x in enumerate(self.axis)]
            for j in range(len(self.yaxis)-1):
                for i in range(n-1):
                    a=j*n+i;mesh.indices.extend([a,a+1,a+n+1,a,a+n+1,a+n])
            return mesh
        vertices={}
        for x,y,step in self.cells(self.bounds):
            quad=[]
            for xx,yy in [(x,y),(x+step,y),(x+step,y+step),(x,y+step)]:
                key=(float(xx),float(yy))
                if key not in vertices:vertices[key]=len(mesh.positions);mesh.positions.append([*key,float(self.height(xx,yy))])
                quad.append(vertices[key])
            mesh.indices.extend(quad[i] for i in [0,1,2,0,2,3])
        return mesh

    def surface(self,polygon,mesh,offset):
        # Road and ground use the same adaptive triangles, including refined DEM patches.
        for x,y,s in self.cells(polygon.bounds):
            for corners in [[(x,y),(x+s,y),(x+s,y+s)],[(x,y),(x+s,y+s),(x,y+s)]]:
                cut=polygon.intersection(Polygon(corners))
                for part in polygon_parts(cut):
                    if part.area<1e-7:continue
                    for t in constrained_delaunay_triangles(part).geoms:
                        xy=list(t.exterior.coords)[:3]
                        if (xy[1][0]-xy[0][0])*(xy[2][1]-xy[0][1])-(xy[1][1]-xy[0][1])*(xy[2][0]-xy[0][0])<0:xy.reverse()
                        mesh.add([[float(a),float(b),float(self.height(a,b)+offset)] for a,b in xy],[0,1,2])


def read_codes(root,sample):
    codes={}
    for f in sample['codelists']:
        with zipfile.ZipFile(root/f['path']) as z:
            for name in z.namelist():
                if not name.endswith('.xml'):continue
                entries={}
                for definition in ET.fromstring(z.read(name)).iter(G+'Definition'):
                    key=definition.findtext(G+'name');value=definition.findtext(G+'description')
                    if key and value:entries[key]=value
                codes[Path(name).name]=entries
    return codes


def read_surfaces(root,sample,frame,terrain,meshes):
    codes=read_codes(root,sample);stats=collections.Counter();seen=set();crop=box(*terrain.bounds)
    cx,cy=sample['anchor']['local']
    for f in sample['land']+[dict(f,kind='tran') for f in sample['roads']]:
        kind=f['kind']
        # Import LOD1 only, avoiding overlapping LOD2/3 carriageway geometries.
        for member in city_members(root/f['path']):
            feature=next(iter(member));id_=feature.attrib.get(G+'id');key=(kind,id_)
            if key in seen:continue
            seen.add(key)
            label='roads' if kind=='tran' else 'water'
            if kind=='luse':
                cl=next((e for e in feature if e.tag.endswith('}class')),None)
                if cl is None:raise ValueError('Land use without class')
                label=codes.get(Path(cl.attrib['codeSpace']).name,{}).get(cl.text)
                if not label:raise ValueError(f'Unknown land-use classification {cl.text}')
                label=label.split('（')[0]
                if label=='水面':label='water'
                # Display only verified natural/agricultural classes; never colour unknown ground green.
                if label not in PALETTE:continue
            surfaces=[el for el in feature if el.tag.endswith('}lod1MultiSurface')]
            included=False
            for surface in surfaces:
                if any('href' in a for el in surface.iter() for a in el.attrib):raise ValueError('Unhandled xlink surface')
                for polygon in surface.iter(G+'Polygon'):
                    rings=[]
                    for ring in polygon:
                        if ring.tag not in (G+'exterior',G+'interior'):continue
                        pos=ring.find('.//'+G+'posList');assert pos is not None
                        ll=np.array(list(map(float,pos.text.split()))).reshape(-1,3)
                        x,y=frame.place(ll[:,1],ll[:,0]);rings.append(np.column_stack([x-cx,y-cy]).tolist())
                    if not rings:continue
                    p=Polygon(rings[0],rings[1:]);
                    if not p.intersects(crop):continue
                    for part in polygon_parts(make_valid(p).intersection(crop)):
                        if part.area<.01:continue
                        terrain.surface(part,meshes.setdefault(label,Mesh()),.09 if kind=='tran' else .035)
                        included=True
            if included:stats[label]+=1
        print(sample['id'],'surface file',kind,dict(stats),flush=True)
    return dict(stats)


def subdivide(vertices,indices,max_edge=40):
    # Linear subdivision retains source shape; makes curvature of large roofs/walls render correctly.
    out=Mesh()
    stack=[np.asarray([vertices[i] for i in indices[k:k+3]]) for k in range(0,len(indices),3)]
    while stack:
        t=stack.pop();edges=[np.linalg.norm(t[(i+1)%3]-t[i]) for i in range(3)];i=int(np.argmax(edges))
        if edges[i]<=max_edge:out.add(t.tolist(),[0,1,2]);continue
        a,b,c=t[i],t[(i+1)%3],t[(i+2)%3];m=(a+b)/2
        stack.extend([np.array([a,m,c]),np.array([m,b,c])])
    return out


def read_buildings(root,sample,frame,terrain):
    mesh=Mesh();features=[];seen=set();bounds_errors=[];height_errors=[];ground_gaps=[]
    ecef=Transformer.from_crs(4978,4979,always_xy=True);cx,cy=sample['anchor']['local'];h=sample['half']
    tmp=root/'decoded-next.json'
    for f in sample['buildings']:
        subprocess.run(['node',str(Path(__file__).with_name('decode_b3dm.mjs')),str(root/f['path']),str(tmp)],check=True,stdout=subprocess.DEVNULL)
        d=json.loads(tmp.read_text());tmp.unlink()
        a=np.asarray(d['positions']).reshape(-1,3);a=np.column_stack([a[:,0],-a[:,2],a[:,1]])+d['rtc']
        lon,lat,alt=ecef.transform(*a.T);x,y=frame.place(lon,lat)
        ll=np.column_stack([lon,lat]);positions=np.column_stack([x-cx,y-cy,alt]);b=np.asarray(d['batches'],dtype=int);tri=np.asarray(d['indices'],dtype=int).reshape(-1,3)
        assert np.equal(b[tri[:,0]],b[tri[:,1]]).all() and np.equal(b[tri[:,0]],b[tri[:,2]]).all()
        for i,feature in enumerate(d['features']):
            if feature['id'] in seen:continue
            vi=np.flatnonzero(b==i)
            if not len(vi):continue
            p=positions[vi].copy();mid=(p[:,:2].min(0)+p[:,:2].max(0))/2
            # Keep whole buildings only; boundary-crossing buildings are recorded outside this sample.
            x0,y0,x1,y1=terrain.bounds
            if p[:,0].min() < x0 or p[:,0].max()>x1 or p[:,1].min() < y0 or p[:,1].max()>y1:continue
            seen.add(feature['id']);bounds=feature['bounds']
            error=float(max(np.abs(np.r_[ll[vi].min(0),ll[vi].max(0)]-np.array(bounds[:4])))*111320)
            bounds_errors.append(error);height_errors.append(float(abs(np.ptp(p[:,2])-(bounds[5]-bounds[4]))))
            assert error<.5 and height_errors[-1]<.5, (feature['id'],error,height_errors[-1])
            # RTC geometry uses ellipsoidal heights; original batch bounds retain CityGML orthometric heights.
            p[:,2]+=bounds[4]-p[:,2].min()-terrain.baseline
            ground_gaps.append(float(p[:,2].min()-terrain.height(*mid)))
            remap={int(old):new for new,old in enumerate(vi)}
            indices=[remap[int(v)] for v in tri[b[tri[:,0]]==i].flat]
            refined=subdivide(p,indices)
            first=len(mesh.indices);mesh.add(refined.positions,refined.indices)
            features.append(dict(id=feature['id'],usage=feature['usage'],sourceLod=feature['sourceLod'],
                                 bounds=bounds,firstIndex=first,indexCount=len(refined.indices)))
        print(sample['id'],'building tile',len(features),flush=True)
    return mesh,features,dict(maxBoundsErrorM=max(bounds_errors),maxHeightRangeErrorM=max(height_errors),
         groundBaseGapPercentilesM=np.percentile(ground_gaps,[0,5,50,95,100]).tolist())


def main(root,regions=None):
    imports=json.loads((root/'imports.json').read_text());out=root/'derived';out.mkdir(exist_ok=True)
    report=dict(version=1,origin='ai',created='2026-09-22',radius=RADIUS,span=SPAN,bandWidth=WIDTH,
                status='three source-data samples; full bands unimported',samples=[])
    previous=json.loads((out/'study.json').read_text()) if regions and (out/'study.json').exists() else {'samples':[]}
    for band,s in enumerate(imports['samples']):
        if regions and s['id'] not in regions:
            report['samples'].append(next(v for v in previous['samples'] if v['id']==s['id']));continue
        frame=Frame(s['frame']['epsg'],s['frame']['origin'],s['frame']['angle']);terrain=Terrain(root,s,frame)
        meshes={'terrain':terrain.mesh()};meshes['buildings'],features,audit=read_buildings(root,s,frame,terrain)
        counts=read_surfaces(root,s,frame,terrain,meshes);folder=out/s['id'];folder.mkdir(exist_ok=True)
        row=dict(id=s['id'],band=band,name=s['name'],station=s['station'],half=s['half'],bounds=terrain.bounds,anchor=s['anchor'],frame=s['frame'],
                 buildingCount=len(features),surfaceCounts=counts,baselineM=terrain.baseline,
                 reliefM=[float(terrain.z.min()),float(terrain.z.max())],demSamples=dict(terrain.stats),audit=audit,
                 meshes=[dict(m.save(folder,name),material=color,path=s['id']+'/') for name,color in PALETTE.items() if (m:=meshes.get(name)) and m.indices],
                 sourceDataset=s['dataset'],neighborDatasets=s.get('neighborDatasets',[]),features=s['id']+'/features.json')
        (folder/'features.json').write_text(json.dumps(features,ensure_ascii=False))
        report['samples'].append(row);(out/'study.json').write_text(json.dumps(report,ensure_ascii=False,indent=2))
        print('COMPLETE',s['id'],row['buildingCount'],row['reliefM'],audit,flush=True)
    # Selected-region rebuilds also append unchanged later samples. Persist after
    # the loop, otherwise the last per-region checkpoint omits those samples.
    (out/'study.json').write_text(json.dumps(report,ensure_ascii=False,indent=2))
    (out/'survey.json').write_bytes((root/'survey.json').read_bytes())
    return report


if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--root',required=True,type=Path)
    parser.add_argument('--region',action='append');args=parser.parse_args();main(args.root,args.region)
