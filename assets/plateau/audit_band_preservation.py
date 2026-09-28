"""Compare accepted source geometry and authored detail against the expanded core."""
import argparse,json,hashlib
from pathlib import Path
import numpy as np
from prepare_walk_tiles import terrain

def main(root,reference):
 d=root/'derived';r=reference/'derived';read=lambda p:json.loads(p.read_text());study=read(d/'study.json');old=read(r/'study.json');report=[]
 for s in study['samples']:
  prior=next(p for p in old['samples'] if p['id']==s['id']);fs=read(d/s['features']);pfs=read(r/prior['features']);lookup={f['id']:f for f in fs}
  def mesh(folder,s):
   m=next(v for v in s['meshes'] if v['name']=='buildings');return np.fromfile(folder/m['path']/m['positions'],dtype='<f4').reshape(-1,3),np.fromfile(folder/m['path']/m['indices'],dtype='<u4')
  p,i=mesh(d,s);op,oi=mesh(r,prior);maximum=0
  for f in pfs:
   assert f['id'] in lookup,('Lost accepted building',f['id']);n=lookup[f['id']]
   a=op[oi[f['firstIndex']:f['firstIndex']+f['indexCount']]];b=p[i[n['firstIndex']:n['firstIndex']+n['indexCount']]]
   assert a.shape==b.shape,(f['id'],a.shape,b.shape)
   error=float(np.max(np.abs(a-b)));maximum=max(maximum,error);assert error<.03,(f['id'],error)
  w=read(d/s['walk']);ow=read(r/prior['walk'])
  for key in ['pavements','pavementRoute','arrival','obstacles']:
   assert w.get(key)==ow.get(key),(s['id'],key)
  for patch in ow.get('heightPatches',[]):
   for j,row in enumerate(patch['heights']):
    for i,h in enumerate(row):assert abs(terrain(w,patch['axis'][i],patch['terrainOrigin'][1]+j*patch['step'])-h)<1e-8
  for m in prior['meshes']:
   if m['name'] in ['footways','kerbs'] or m['name'].startswith('park-'):
    for k in ['positions','indices']:assert (r/m['path']/m[k]).read_bytes()==(d/m['path']/m[k]).read_bytes()
  if prior.get('exploration'):assert (r/prior['exploration']).read_bytes()==(d/s['exploration']).read_bytes()
  preserved_recipes=0
  if prior.get('facadeSites') and s.get('facadeSites'):
   manifest=read(d/s['facadeSites']);meta={x['id']:x for x in manifest['sites']}
   for site in read(r/prior['facadeSites'])['sites']:
    a=read(r/site['path']);b=read(d/meta[site['id']]['path'])
    assert a==b,('Accepted facade changed',site['id']);preserved_recipes+=len(a['buildings'])
  report.append(dict(id=s['id'],acceptedBuildings=len(pfs),expandedBuildings=len(fs),maxSourceVertexErrorM=maximum,preservedFacadeRecipes=preserved_recipes))
  print(report[-1],flush=True)
 (root/'band-preservation-audit.json').write_text(json.dumps(dict(passed=True,regions=report),indent=2))
if __name__=='__main__':
 p=argparse.ArgumentParser();p.add_argument('--root',type=Path,required=True);p.add_argument('--reference',type=Path,required=True);a=p.parse_args();main(a.root,a.reference)
