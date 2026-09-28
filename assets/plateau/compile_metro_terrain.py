"""Full-strip GSI elevation grids with bounded raster residency and explicit gaps.

Pixel-centre bilinear sampling requires all four real samples. A missing tile
never becomes zero elevation. Preserve the orthometric datum used by PLATEAU.
"""
import argparse
import collections
import gzip
import hashlib
import json
import math
from pathlib import Path
import numpy as np
from pyproj import Transformer
from plan_tokyo_metro import write, receipt_paths


class DemSampler:
    def __init__(self,root,receipts,capacity=32):
        self.root=root;self.receipts={(r['layer'],r['x'],r['y']):r for r in receipts if r['status']=='acquired'}
        self.capacity=capacity;self.cache=collections.OrderedDict();self.peak_resident=0
    def tile(self,key):
        if key in self.cache:self.cache.move_to_end(key);return self.cache[key]
        receipt=self.receipts.get(key)
        if not receipt:return None
        assert receipt['z']==14
        path=self.root/receipt['path'];open_=gzip.open if receipt.get('compression')=='gzip' else open
        with open_(path,'rb') as stream:
            data=np.genfromtxt(stream,delimiter=',',missing_values='e',filling_values=np.nan)
        assert data.shape==(256,256)
        self.cache[key]=data
        while len(self.cache)>self.capacity:self.cache.popitem(last=False)
        self.peak_resident=max(self.peak_resident,len(self.cache));return data
    def sample(self,lon,lat):
        lon,lat=np.broadcast_arrays(np.asarray(lon),np.asarray(lat));shape=lon.shape
        px=(lon.ravel()+180)/360*16384*256-.5
        py=(1-np.arcsinh(np.tan(np.radians(lat.ravel())))/math.pi)/2*16384*256-.5
        ix=np.floor(px).astype(np.int64);iy=np.floor(py).astype(np.int64);a=px-ix;b=py-iy
        output=np.full(len(px),np.nan);sources=np.zeros(len(px),dtype=np.uint8)
        for layer,code in [('dem5a',1),('dem',2)]:
            missing=np.flatnonzero(sources==0)
            if not len(missing):break
            values=[]
            for dx,dy in [(0,0),(1,0),(0,1),(1,1)]:
                gx=ix[missing]+dx;gy=iy[missing]+dy;tx=gx//256;ty=gy//256;sample=np.full(len(gx),np.nan)
                for x,y in np.unique(np.column_stack([tx,ty]),axis=0):
                    raster=self.tile((layer,int(x),int(y)))
                    if raster is None:continue
                    mask=(tx==x)&(ty==y);sample[mask]=raster[gy[mask]%256,gx[mask]%256]
                values.append(sample)
            valid=np.isfinite(values).all(axis=0);dest=missing[valid];v=np.asarray(values)[:,valid]
            output[dest]=(1-b[dest])*((1-a[dest])*v[0]+a[dest]*v[1])+b[dest]*((1-a[dest])*v[2]+a[dest]*v[3])
            sources[dest]=code
        return output.reshape(shape),sources.reshape(shape)


def main():
    parser=argparse.ArgumentParser();parser.add_argument('--root',type=Path,required=True);parser.add_argument('--step',type=float,default=5)
    args=parser.parse_args();root=args.root.resolve();plan=json.loads((root/'tokyo-metro-plan.json').read_text())
    receipts=[json.loads(p.read_text()) for p in receipt_paths(root)]
    receipts=[r for r in receipts if r['kind']=='dem'];assert receipts,'DEM acquisition has not started'
    sampler=DemSampler(root,receipts);inverse=Transformer.from_crs(6677,6668,always_xy=True)
    folder=root/'terrain';folder.mkdir(exist_ok=True);report=dict(step=args.step,datum='orthometric metres',bands=[],complete=False)
    for band in plan['bands']:
        f=band['frame'];ox,oy=f['origin'];c,s=math.cos(f['angle']),math.sin(f['angle']);x0,y0,x1,y1=band['bounds'];step=args.step
        xs=np.arange(math.floor(x0/step)*step,math.ceil(x1/step)*step+step*.1,step)
        ys=np.arange(math.floor(y0/step)*step,math.ceil(y1/step)*step+step*.1,step)
        heights=np.full((len(ys),len(xs)),np.nan,dtype='<f4');counts=collections.Counter();gaps=[]
        for row in range(0,len(ys),128):
            x,y=np.meshgrid(xs,ys[row:row+128]);lon,lat=inverse.transform(ox+x*s+y*c,oy-x*c+y*s)
            z,source=sampler.sample(lon,lat);heights[row:row+len(z)]=z
            counts.update({int(key):int(value) for key,value in zip(*np.unique(source,return_counts=True))})
            missing=np.argwhere(source==0)
            for j,i in missing[:max(0,100-len(gaps))]:gaps.append(dict(local=[float(x[j,i]),float(y[j,i])],geographic=[float(lon[j,i]),float(lat[j,i])]))
        path=folder/(band['id']+'.heights.f32');temporary=path.with_suffix('.next');heights.tofile(temporary);temporary.replace(path)
        finite=heights[np.isfinite(heights)]
        manifest=dict(version=1,id=band['id'],band=band['band'],bounds=band['bounds'],origin=[float(xs[0]),float(ys[0])],step=step,
            grid=[len(xs),len(ys)],heights=str(path.relative_to(root)),bytes=path.stat().st_size,
            sha256=hashlib.sha256(path.read_bytes()).hexdigest(),datum='orthometric metres',baselineM=0,
            rangeM=[float(finite.min()),float(finite.max())] if finite.size else None,
            sampleCounts=dict(dem5a=counts[1],dem=counts[2],missing=counts[0]),firstMissingSamples=gaps,
            ready=counts[0]==0,source='https://cyberjapandata.gsi.go.jp/xyz/',peakResidentRasters=sampler.peak_resident)
        write(folder/(band['id']+'.json'),manifest);report['bands'].append(manifest);write(root/'terrain-grid-audit.json',report)
        print(band['id'],manifest['grid'],manifest['sampleCounts'],manifest['rangeM'],flush=True)
    report['complete']=all(b['ready'] for b in report['bands']);write(root/'terrain-grid-audit.json',report)


if __name__=='__main__':main()
