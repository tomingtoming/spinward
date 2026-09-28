"""Separate resampling artefacts from source elevation disagreements."""
import argparse,json,math
from pathlib import Path
import numpy as np
from shapely.geometry import Polygon
from assemble import Terrain,Frame

def main(root):
 read=lambda p:json.loads(p.read_text());study=read(root/'derived/study.json');imports=read(root/'imports.json');report=[]
 for sample,imp in zip(study['samples'],imports['samples']):
  w=read(root/'derived'/sample['walk']);issues=w['audit']['roofConcerns']
  if not issues:continue
  f=imp['frame'];t=Terrain(root,imp,Frame(f['epsg'],f['origin'],f['angle']));features={v['id']:v for v in read(root/'derived'/sample['features'])};polys={}
  for b in w['buildings']:polys.setdefault(b['id'],[]).append(b)
  ids=set(v['id'] for v in issues)
  for id in ids:
   for b in polys[id]:
    points=[]
    for ring in b['rings']:
     for a,c in zip(ring,ring[1:]):
      for k in range(max(1,math.ceil(math.dist(a,c)/2))):points.append(np.array(a)+(np.array(c)-a)*k/max(1,math.ceil(math.dist(a,c)/2)))
    raw=[t.raw(t.cx+x,t.cy+y)-t.baseline for x,y in points];coarse=[t.height(x,y) for x,y in points];poly=Polygon(b['rings'][0],b['rings'][1:]);result=dict(region=sample['id'],id=id,usage=features[id]['usage'],height=b['top']-b['base'],area=poly.area,bounds=b['bounds'],top=b['top'],base=b['base'],coarseRoofClearance=b['top']-max(coarse),rawRoofClearance=b['top']-max(raw),maxHeightDifference=max(abs(a-b) for a,b in zip(raw,coarse)))
    result['classification']='source-low-volume' if result['height']<1 else 'coarse-grid-conflict' if result['coarseRoofClearance']<0<=result['rawRoofClearance'] else 'source-elevation-conflict' if result['rawRoofClearance']<0 else 'low-clearance-not-buried'
    report.append(result)
 from collections import Counter
 output=dict(origin='ai',created='2026-09-23',classification=dict(Counter(v['classification'] for v in report)),cases=report);(root/'city-ground-audit.json').write_text(json.dumps(output,ensure_ascii=False,indent=2));print(output['classification']);print(json.dumps([v for v in report if v['coarseRoofClearance']<0],ensure_ascii=False,indent=2))
if __name__=='__main__':
 p=argparse.ArgumentParser();p.add_argument('--root',type=Path,required=True);main(p.parse_args().root)
