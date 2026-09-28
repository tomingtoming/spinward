"""Set doorway thresholds against actual local pavement, road or soil height."""
import argparse,json,math
from pathlib import Path
from shapely.geometry import Polygon,Point
from shapely import union_all
from shapely.prepared import prep
from assemble import Terrain,Frame

def main(root,region='tokyo'):
 d=root/'derived';read=lambda p:json.loads(p.read_text());s=next(s for s in read(d/'study.json')['samples'] if s['id']==region);w=read(d/s['walk']);manifest=read(d/s['facadeSites']);imp=next(s for s in read(root/'imports.json')['samples'] if s['id']==region);f=imp['frame'];t=Terrain(root,imp,Frame(f['epsg'],f['origin'],f['angle']))
 indexes={key:prep(union_all([Polygon(p['rings'][0],p['rings'][1:]) for p in w.get(key,[])])) for key in ['roads','pavements']};maximum=0;count=0
 for site in manifest['sites']:
  path=d/site['path'];recipe=read(path)
  for row in recipe['buildings']:
   office=row['usage'] in ['業務施設','官公庁施設','文教厚生施設'];bay=2.1+row['seed']%3*.23 if office else 2.9+row['seed']%3*.35
   for wall in row['walls']:
    length=wall['length'];bays=max(1,math.floor((length-.8)/bay));spacing=(length-.8)/bays;along=.4+spacing*(math.floor(bays/2)+.5);u=[(wall['b'][k]-wall['a'][k])/length for k in [0,1]];point=[wall['a'][k]+u[k]*along+wall['normal'][k]*.1 for k in [0,1]];pt=Point(*point)
    offset=.20 if indexes['pavements'].covers(pt) else .09 if indexes['roads'].covers(pt) else .035
    if site['id'].startswith('extension-'):wall['ground']=[t.height(*(wall['a'][k]+(wall['b'][k]-wall['a'][k])*v for k in [0,1])) for v in [0,.5,1]]
    target=t.height(*point)+offset;maximum=max(maximum,abs(wall['ground'][1]+.20-target));count+=1
    if 'entryGround' not in wall or abs(wall['entryGround']-target)>1e-8:wall['entryGround']=target
  blob=json.dumps(recipe,ensure_ascii=False,separators=(',',':'));path.write_text(blob);site['bytes']=len(blob.encode())
 (d/s['facadeSites']).write_text(json.dumps(manifest,ensure_ascii=False));(root/f'{region}-entry-ground-audit.json').write_text(json.dumps(dict(origin='ai',created='2026-09-23',walls=count,maxThresholdAdjustmentM=maximum,sampleDistanceFromWallM=.1),indent=2));print(count,'walls; maximum adjustment',maximum)
if __name__=='__main__':
 p=argparse.ArgumentParser();p.add_argument('--root',type=Path,required=True);p.add_argument('--region',default='tokyo');a=p.parse_args();main(a.root,a.region)
