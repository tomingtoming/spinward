"""Refresh source ground/surfaces while retaining exact imported building buffers."""
import argparse
import json
from pathlib import Path
from assemble import Frame,Terrain,read_surfaces,PALETTE

def main(root):
    report=json.loads((root/'derived/study.json').read_text())
    imports=json.loads((root/'imports.json').read_text())
    for s,imp in zip(report['samples'],imports['samples']):
        if s['id']!='tama':continue
        f=imp['frame'];t=Terrain(root,imp,Frame(f['epsg'],f['origin'],f['angle']))
        meshes={'terrain':t.mesh()};counts=read_surfaces(root,imp,t.frame,t,meshes)
        folder=root/'derived'/s['id']
        s['meshes']=[m for m in s['meshes'] if m['name'] not in meshes]+[
            dict(m.save(folder,n),material=PALETTE[n],path=s['id']+'/') for n,m in meshes.items()]
        s['surfaceCounts']=counts;s['terrainStepM']=t.step
        s['reliefM']=[float(t.z.min()),float(t.z.max())];s['demSamples']=dict(t.stats)
        print(s['id'],t.step,'m terrain; meshes',[(m['name'],m['triangles']) for m in s['meshes']],flush=True)
    (root/'derived/study.json').write_text(json.dumps(report,ensure_ascii=False,indent=2))

if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--root',type=Path,required=True);main(p.parse_args().root)
