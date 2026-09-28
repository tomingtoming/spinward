"""Publish a finish manifest only after checking every additional geometry tile."""
import argparse
import gzip
import hashlib
import json
import struct
from pathlib import Path

import numpy as np
from PIL import Image

from plan_tokyo_metro import write


def main():
    parser=argparse.ArgumentParser();parser.add_argument('--root',type=Path,required=True)
    args=parser.parse_args();root=args.root.resolve();derived=root/'derived';finish=derived/'finish-v1'
    read=lambda p:json.loads(p.read_text())
    plan=read(root/'tokyo-metro-plan.json');landmarks=read(finish/'landmarks.json')
    assert len(landmarks['crossings'])==5 and landmarks['crossingRoadFraction']>.9
    surfaces={};descriptors=[]
    for band in plan['bands']:
        manifest=read(finish/(band['id']+'-surfaces.json'))
        baseline=read(derived/band['id']/'base.json')
        assert manifest['ready'] and {t['id'] for t in manifest['tiles']}=={t['id'] for t in baseline['tiles']}
        assert len(manifest['tiles'])==3400
        descriptors.extend(manifest['tiles'])
        surfaces[band['id']]=dict(tiles=[{k:t[k] for k in ['id','path','bytes','decodedBytes','sha256']} for t in manifest['tiles']])
    descriptors.extend(landmarks['tiles'])
    for d in descriptors:
        p=derived/d['path'];assert p.resolve().is_relative_to(finish.resolve())
        raw=gzip.decompress(p.read_bytes())
        assert len(raw)==d['decodedBytes'] and hashlib.sha256(raw).hexdigest()==d['sha256'],p
        length=struct.unpack_from('<I',raw)[0];header=json.loads(raw[4:4+length]);offset=4+length+(-length)%4
        for mesh in header['meshes']:
            attrs=mesh['attributes'];v=attrs['position'];i=attrs['index']
            vertices=np.frombuffer(raw,dtype='<f4',count=v['count'],offset=offset+v['offset']).reshape(-1,3)
            indices=np.frombuffer(raw,dtype='<u4',count=i['count'],offset=offset+i['offset']).reshape(-1,3)
            assert np.isfinite(vertices).all() and indices.max()<len(vertices),p
            faces=vertices[indices];a,b=faces[:,1,:2]-faces[:,0,:2],faces[:,2,:2]-faces[:,0,:2]
            assert np.all(a[:,0]*b[:,1]-a[:,1]*b[:,0]>=0),('Reversed surface face',p)
    for path in landmarks['textures'].values():
        with Image.open(derived/path) as image:image.verify()
    assert read(derived/landmarks['trees'])['trees']
    manifest=dict(version=1,ready=True,frames=[[b['id'],b['band'],b['frame']] for b in plan['bands']],surfaces=surfaces,
        landmarks=landmarks['tiles'],textures=landmarks['textures'],trees=landmarks['trees'],
        attribution=landmarks['attribution'],license=landmarks['license'],derivedSource='finish-v1/osm-derived.geojson')
    write(finish/'manifest.json',manifest)
    report=dict(passed=True,tiles=len(descriptors),textures=len(landmarks['textures']),trees=landmarks['planting']['count'],
        winding='all faces upward',
        storedBytes=sum(d['bytes'] for d in descriptors),decodedBytes=sum(d['decodedBytes'] for d in descriptors),
        scope='Finish assets only; baseline retained and runtime validation separate')
    write(finish/'release-audit.json',report);print(json.dumps(report),flush=True)


if __name__=='__main__':main()
