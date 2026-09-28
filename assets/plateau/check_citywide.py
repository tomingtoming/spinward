"""Source preservation, facade coverage and refined terrain contact acceptance."""
import argparse,hashlib,json,math
from pathlib import Path
import numpy as np
from assemble import Terrain,Frame

def main(root,reference):
 read=lambda p:json.loads(p.read_text());d=root/'derived';old=reference/'derived';study=read(d/'study.json');imp=read(root/'imports.json');checks=[]
 for s in study['samples']:
  # Tokyo ground is intentionally refined; the complete original building mesh
  # and every non-Tokyo source mesh must remain byte-identical.
  for m in s['meshes']:
   if s['id']=='tokyo' and m['name']!='buildings':continue
   for field in ['positions','indices']:
    path=Path(m['path'])/m[field];assert (d/path).read_bytes()==(old/path).read_bytes(),str(path);checks.append(str(path))
  if s['id']!='tokyo':
   for field in ['walk','features']:
    path=s[field];assert (d/path).read_bytes()==(old/path).read_bytes(),path;checks.append(path)
 s=study['samples'][0];sample=imp['samples'][0];f=sample['frame'];terrain=Terrain(root,sample,Frame(f['epsg'],f['origin'],f['angle']));w=read(d/s['walk'])
 # Triangle centroids test the actual adaptive mesh, not merely its vertices.
 m=next(m for m in s['meshes'] if m['name']=='terrain');p=np.fromfile(d/m['path']/m['positions'],dtype='<f4').reshape(-1,3);i=np.fromfile(d/m['path']/m['indices'],dtype='<u4').reshape(-1,3);centres=p[i].astype(float).mean(axis=1)
 errors=[abs(z-terrain.height(x,y)) for x,y,z in centres];assert max(errors)<.0001
 seams=[]
 for patch in terrain.patches:
  x0,y0,x1,y1=patch['bounds']
  for x in np.arange(x0,x1+.1,.625):
   for y in [y0,y1]:
    if abs(y)<terrain.half:seams.append(abs(terrain.height(x,y-.00001)-terrain.height(x,y+.00001)))
  for y in np.arange(y0,y1+.1,.625):
   for x in [x0,x1]:
    if abs(x)<terrain.half:seams.append(abs(terrain.height(x-.00001,y)-terrain.height(x+.00001,y)))
 assert max(seams)<.001
 repaired=[]
 for v in read(root/'city-ground-before.json')['cases']:
  if v['classification']!='coarse-grid-conflict':continue
  b=next(b for b in w['buildings'] if b['id']==v['id'] and b['bounds']==v['bounds']);points=[]
  for ring in b['rings']:
   for a,c in zip(ring,ring[1:]):
    n=max(1,math.ceil(math.dist(a,c)/.25));points.extend(np.array(a)+(np.array(c)-a)*k/n for k in range(n))
  clearance=b['top']-max(terrain.height(x,y) for x,y in points);assert clearance>0;repaired.append(dict(id=v['id'],bounds=v['bounds'],before=v['coarseRoofClearance'],after=clearance))
 manifest=read(d/s['facadeSites']);audit=read(root/'city-facades-audit.json');ids=set();counts=[]
 for site in manifest['sites']:
  blob=(d/site['path']).read_bytes();assert len(blob)==site['bytes'];rows=json.loads(blob)['buildings'];these={b['id'] for b in rows};assert not ids&these;ids.update(these);counts.append(len(these))
 assert len(ids)==audit['appliedBuildings'];assert len(ids)+len(audit['excluded'])==audit['sourceBuildings'];assert ids==set(manifest['bodyColours'])
 # The approved 766 recipes retain their exact design (entryGround may be
 # recalculated from the same source pavement sampling).
 old_manifest=read(old/'facade-sites.json')
 for site in old_manifest['sites']:assert read(d/site['path'])==read(old/site['path'])
 # Original tour geometry and landmark locations must also survive expansion.
 assert read(d/'exploration.json')==read(old/'exploration.json')
 out=dict(origin='ai',created='2026-09-23',preservedFiles=checks,terrainTriangles=len(i),maxTerrainContactErrorM=max(errors),seamSamples=len(seams),maxSeamDifferenceM=max(seams),repaired=repaired,sourceBuildings=audit['sourceBuildings'],facadeBuildings=len(ids),excludedBuildings=len(audit['excluded']),preservedFacadeBuildings=766)
 (root/'citywide-preservation.json').write_text(json.dumps(out,ensure_ascii=False,indent=2));print(json.dumps(out,ensure_ascii=False,indent=2))

if __name__=='__main__':
 p=argparse.ArgumentParser();p.add_argument('--root',type=Path,required=True);p.add_argument('--reference',type=Path,required=True);a=p.parse_args();main(a.root,a.reference)
