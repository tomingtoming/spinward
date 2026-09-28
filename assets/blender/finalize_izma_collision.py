"""Finalize all composed physical layers before building the regional runtime.

Run in an isolated Blender with -- --source-root ABSOLUTE_STAGING_DIRECTORY.
The native meshes and existing frozen previews are not modified.
"""
import argparse
import hashlib
import json
import sys
from pathlib import Path

ASSETS=Path(__file__).resolve().parent
sys.path.insert(0,str(ASSETS))
from colony_manifest_io import encoded,read_manifest,write_manifest
from colony_spatial_data import fixed_layers
from izma_collision_mesh import finalize_packed_collision


def finalize(root):
    if not root.is_absolute() or root.resolve()==ASSETS.parents[1]:
        raise ValueError('Use a separate absolute staging root')
    source=root/'src/worlds/generated/izmaColony.json';manifest=read_manifest(source)
    report={'sourceBefore':hashlib.sha256(encoded(manifest)).hexdigest(),'layers':{}}
    for name,packed in fixed_layers(manifest).items():
        result,audit=finalize_packed_collision(packed)
        assert result['meshes']==packed['meshes']
        assert result['vertices'][:len(packed['vertices'])]==packed['vertices']
        assert len(result['surfaces'])==len(packed['surfaces'])
        if name=='base':manifest[name]=result
        else:
            manifest[name]['fixed']=result
            counts=manifest[name].get('counts',{})
            if 'collisionTriangles' in counts:
                counts['collisionTriangles']=sum(len(s['indices'])//3 for s in result['surfaces'])
        report['layers'][name]=audit
        print(json.dumps({'layer':name,**audit}),flush=True)
    report['sourceAfter']=hashlib.sha256(encoded(manifest)).hexdigest()
    write_manifest(source,manifest)
    (root/'collision-finalization.json').write_text(json.dumps(report,indent=2)+'\n')
    print(json.dumps(report),flush=True)


if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--source-root',type=Path,required=True)
    args=parser.parse_args(sys.argv[sys.argv.index('--')+1:]);finalize(args.source_root)
