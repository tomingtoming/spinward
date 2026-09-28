"""Extend an accepted edge DEM refinement instead of changing its interior taper."""
import argparse,json
from pathlib import Path
import numpy as np
from shapely.geometry import box,Polygon
from assemble import Terrain,Frame,Mesh,polygon_parts,PALETTE

def main(root,reference):
 d=root/'derived';r=reference/'derived';read=lambda p:json.loads(p.read_text());study=read(d/'study.json');old=read(r/'study.json');specs=read(root/'terrain-patches.json');imports=read(root/'imports.json');reports=[]
 for s in study['samples']:
  prior=next(p for p in old['samples'] if p['id']==s['id']);ow=read(r/prior['walk']);ob=ow.get('bounds',[-ow['half']]*2+[ow['half']]*2);changes=[]
  for spec,accepted in zip(specs.get(s['id'],[]),ow.get('heightPatches',[])):
   original=accepted['bounds'];bounds=list(original)
   for k in range(4):
    if original[k]==ob[k] and s['bounds'][k]!=ob[k]:bounds[k]+=(-40 if k<2 else 40)
   if bounds!=original:spec['bounds']=bounds;changes.append(bounds)
  if not changes:continue
  (root/'terrain-patches.json').write_text(json.dumps(specs,ensure_ascii=False,indent=2))
  imp=next(i for i in imports['samples'] if i['id']==s['id']);f=imp['frame'];t=Terrain(root,imp,Frame(f['epsg'],f['origin'],f['angle']));patches=[box(*b) for b in changes]
  for m in s['meshes']:
   name=m['name'];offset=.09 if name=='roads' else .035
   if name=='terrain':mesh=t.mesh()
   elif name in PALETTE and name!='buildings':
    p=np.fromfile(d/m['path']/m['positions'],dtype='<f4').reshape(-1,3);idx=np.fromfile(d/m['path']/m['indices'],dtype='<u4').reshape(-1,3);coords=p[idx,:2];lo=coords.min(axis=1);hi=coords.max(axis=1);hit=np.zeros(len(idx),dtype=bool)
    for a,b,c,e in changes:hit|=(lo[:,0]<=c)&(hi[:,0]>=a)&(lo[:,1]<=e)&(hi[:,1]>=b)
    if not hit.any():continue
    mesh=Mesh();mesh.add(p.tolist(),idx[~hit].ravel().tolist())
    for triangle in coords[hit]:
     polygon=Polygon(triangle)
     if polygon.area>1e-7:t.surface(polygon,mesh,offset)
   else:continue
   updated=mesh.save(d/m['path'],name);m.update(updated)
  w=read(d/s['walk']);w['heightPatches']=t.patches;w['heights']=t.z.tolist();(d/s['walk']).write_text(json.dumps(w,ensure_ascii=False,separators=(',',':')))
  maximum=0
  for patch in ow.get('heightPatches',[]):
   for j,row in enumerate(patch['heights']):
    for i,h in enumerate(row):
     x=patch['axis'][i];y=patch['terrainOrigin'][1]+j*patch['step'];maximum=max(maximum,abs(t.height(x,y)-h))
  assert maximum<1e-8,maximum
  reports.append(dict(id=s['id'],extendedPatches=changes,maxAcceptedHeightErrorM=maximum));print(reports[-1],flush=True)
 (d/'study.json').write_text(json.dumps(study,ensure_ascii=False));(root/'band-ground-preservation.json').write_text(json.dumps(reports,indent=2))
if __name__=='__main__':
 p=argparse.ArgumentParser();p.add_argument('--root',type=Path,required=True);p.add_argument('--reference',type=Path,required=True);a=p.parse_args();main(a.root,a.reference)
