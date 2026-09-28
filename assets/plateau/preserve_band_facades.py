"""Retain accepted recipes after proving recomputed thresholds differ only numerically."""
import argparse,json
from pathlib import Path

def main(root,reference):
 d=root/'derived';old=reference/'derived';read=lambda p:json.loads(p.read_text());study=read(d/'study.json');prior=read(old/'study.json');report=[]
 for s in study['samples']:
  p=next(v for v in prior['samples'] if v['id']==s['id'])
  if not p.get('facadeSites'):continue
  manifest=read(d/s['facadeSites']);sites={v['id']:v for v in manifest['sites']};maximum=0
  for site in read(old/p['facadeSites'])['sites']:
   raw=(old/site['path']).read_bytes();a=json.loads(raw);meta=sites[site['id']];b=read(d/meta['path'])
   assert len(a['buildings'])==len(b['buildings'])
   for before,after in zip(a['buildings'],b['buildings']):
    assert len(before['walls'])==len(after['walls'])
    for u,v in zip(before['walls'],after['walls']):
     if 'entryGround' in u:
      difference=abs(u['entryGround']-v['entryGround']);maximum=max(maximum,difference);assert difference<1e-8,(s['id'],site['id'],difference);v['entryGround']=u['entryGround']
   assert a==b,(s['id'],site['id'],'Non-numerical facade change')
   (d/meta['path']).write_bytes(raw);meta['bytes']=len(raw)
  (d/s['facadeSites']).write_text(json.dumps(manifest,ensure_ascii=False));report.append(dict(id=s['id'],maxThresholdRoundingDifferenceM=maximum,policy='Preserve exact accepted bytes after structural/numerical comparison'))
 (root/'facade-preservation-rounding.json').write_text(json.dumps(report,indent=2));print(report)
if __name__=='__main__':
 p=argparse.ArgumentParser();p.add_argument('--root',type=Path,required=True);p.add_argument('--reference',type=Path,required=True);a=p.parse_args();main(a.root,a.reference)
