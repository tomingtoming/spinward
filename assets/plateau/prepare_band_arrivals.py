"""Keep source-road arrivals, but face open streets when the station centre is a wall."""
import argparse,json,math
from pathlib import Path
from shapely.geometry import Polygon,Point,LineString
from shapely.strtree import STRtree

def main(root):
 d=root/'derived';study=json.loads((d/'study.json').read_text());report=[]
 for s in study['samples']:
  w=json.loads((d/s['walk']).read_text());shapes=[Polygon(v['rings'][0],v['rings'][1:]) for v in w['buildings']];tree=STRtree(shapes);p=d/s['navigation'];nav=json.loads(p.read_text())
  for stop in nav['destinations']:
   if not stop['id'].startswith('station-'):continue
   x,y=stop['point'];origin=Point(x,y);old=stop['yaw']
   def clearance(angle):
    line=LineString([(x,y),(x-40*math.sin(angle),y+40*math.cos(angle))]);near=tree.query(line,predicate='intersects')
    return min([40]+[origin.distance(shapes[int(i)].intersection(line)) for i in near])
   old_clear=clearance(old)
   if old_clear>=8:continue
   choices=[]
   for i in range(48):
    angle=i*math.tau/48;rays=[clearance(angle+offset) for offset in [-.55,-.25,0,.25,.55]];turn=abs(math.atan2(math.sin(angle-old),math.cos(angle-old)));score=min(rays)*3+sum(rays)/5+rays[2]-turn*2;choices.append((score,angle,rays))
   _,angle,rays=max(choices);stop['yaw']=angle;report.append(dict(region=s['id'],id=stop['id'],oldClearanceM=old_clear,newClearanceM=rays[2],yaw=angle,method='same safe arrival point; open street view instead of facing station wall'))
  p.write_text(json.dumps(nav,ensure_ascii=False,separators=(',',':')))
 (root/'band-arrival-views.json').write_text(json.dumps(report,ensure_ascii=False,indent=2));print(report)
if __name__=='__main__':
 p=argparse.ArgumentParser();p.add_argument('--root',type=Path,required=True);main(p.parse_args().root)
