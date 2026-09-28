"""Temporary land-cover shell shown while the full source terrain streams.

It is always below the study's valid terrain, has no collision, and is removed
once all exact-edge overview segments are installed. No arrival uses this as
its ground: local native terrain and native collision remain mandatory.
"""
import argparse
import json
from pathlib import Path

import numpy as np
from PIL import Image

from metro_geometry import save_tile
from plan_tokyo_metro import write


def main():
    parser=argparse.ArgumentParser();parser.add_argument('--root',type=Path,required=True)
    args=parser.parse_args();root=args.root.resolve();derived=root/'derived'
    study=json.loads((derived/'metro-overview.json').read_text());descriptors={}
    for band in study['samples']:
        image=Image.new('RGB',(128,1500))
        for segment in range(10):
            with Image.open(derived/band['id']/f'overview-{segment}.png') as source:
                image.paste(source.resize((128,150),Image.Resampling.BOX),(0,(9-segment)*150))
        name=f'render-v2/bootstrap/{band["id"]}'
        target=derived/(name+'.png');target.parent.mkdir(parents=True,exist_ok=True);image.quantize(colors=64).save(target,optimize=True)
        x0,y0,x1,y1=band['bounds'];xs=np.linspace(x0,x1,35);ys=np.linspace(y0,y1,41)
        xx,yy=np.meshgrid(xs,ys);positions=np.column_stack([xx.ravel(),yy.ravel(),np.full(xx.size,-16.)]).astype('<f4')
        normals=np.tile([0.,0.,1.],(xx.size,1)).astype('<f4');indices=[]
        for y in range(40):
            for x in range(34):
                a=y*35+x;indices.extend([a,a+1,a+36,a,a+36,a+35])
        meshes=[dict(name='terrain',colour='#ffffff',roughness=1,texture=name+'.png',textureBounds=[-1700,-20000,1700,20000],
            attributes=dict(position=positions,normal=normals,index=np.asarray(indices,dtype='<u4')))]
        descriptors[band['id']]=save_tile(derived,name+'.bin.gz',meshes)
        print(band['id'],'wire',descriptors[band['id']]['bytes']+target.stat().st_size,flush=True)
    path=derived/'render-v2/lowrise/manifest.json';data=json.loads(path.read_text());data['bootstrap']=descriptors
    data['bootstrapApproximation']=dict(heightM=-16,temporary=True,collision=False,groundPixelM=40_000/1500)
    write(path,data)


if __name__=='__main__':main()
