"""Normalize only finish-v1 face winding; positions and source data are retained.

Run with the finishing preview idle, then audit_metro_finish.py before release.
The normal generator now emits the same positive winding from the outset.
"""
import argparse
import gzip
import json
import struct
from pathlib import Path
import numpy as np
from metro_geometry import save_tile
from plan_tokyo_metro import write


def main():
    parser=argparse.ArgumentParser();parser.add_argument('--root',required=True,type=Path)
    root=parser.parse_args().root/'derived';finish=root/'finish-v1'
    files=[finish/(band+'-surfaces.json') for band in ['east','central','west']]+[finish/'landmarks.json']
    counts=dict(tiles=0,repaired=0,reversedFaces=0)
    for path in files:
        manifest=json.loads(path.read_text())
        for d in manifest['tiles']:
            raw=gzip.decompress((root/d['path']).read_bytes());length=struct.unpack_from('<I',raw)[0]
            header=json.loads(raw[4:4+length]);offset=4+length+(-length)%4;changed=0
            for mesh in header['meshes']:
                mesh['attributes']={k:np.frombuffer(raw,dtype='<u4' if v['type']=='u32' else '<f4',count=v['count'],offset=offset+v['offset']).copy().reshape(-1 if k=='index' else (-1,3)) for k,v in mesh['attributes'].items()}
                a=mesh['attributes'];indices=a['index'].reshape(-1,3);p=a['position'][indices]
                u,v=p[:,1,:2]-p[:,0,:2],p[:,2,:2]-p[:,0,:2]
                reverse=u[:,0]*v[:,1]-u[:,1]*v[:,0]<0
                indices[reverse]=indices[reverse][:,[0,2,1]];changed+=int(reverse.sum())
            if changed:
                d.update(save_tile(root,d['path'],header['meshes']))
                if path.name!='landmarks.json':write(finish/manifest['id']/(d['id']+'.json'),d)
                counts['repaired']+=1;counts['reversedFaces']+=changed
            counts['tiles']+=1
        write(path,manifest);print(path.name,counts,flush=True)
    write(finish/'winding-audit.json',dict(**counts,winding='upward-ccw'))


if __name__=='__main__':main()
