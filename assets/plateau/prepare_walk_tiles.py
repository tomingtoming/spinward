"""Bound collision residency without changing the source movement/height contract."""
import argparse,gzip,hashlib,json,math
from pathlib import Path
from shapely.geometry import Polygon,box
from shapely.strtree import STRtree
from prepare_walk import rings
from assemble import polygon_parts

def terrain(w,x,y):
    d=next((p for p in w.get('heightPatches',[]) if p['bounds'][0]<=x<=p['bounds'][2] and p['bounds'][1]<=y<=p['bounds'][3]),w)
    origin=d.get('terrainOrigin',[-w['half'],-w['half']]);n=len(d['axis']);u=(x-origin[0])/d['step'];v=(y-origin[1])/d['step'];z=d['heights']
    i=max(0,min(n-2,math.floor(u)));j=max(0,min(len(z)-2,math.floor(v)));a=u-i;b=v-j
    return z[j][i]+a*(z[j][i+1]-z[j][i])+b*(z[j+1][i+1]-z[j][i+1]) if a>=b else z[j][i]+b*(z[j+1][i]-z[j][i])+a*(z[j+1][i+1]-z[j+1][i])

def ground(w,x,y):
    h=terrain(w,x,y)
    from shapely.geometry import Point
    point=Point(x,y)
    h+=.20 if any(Polygon(p['rings'][0],p['rings'][1:]).covers(point) for p in w.get('pavements',[])) else .09 if any(Polygon(p['rings'][0],p['rings'][1:]).covers(point) for p in w['roads']) else .035
    for s in w.get('heightSupports',[]):
        b=s['bounds']
        if not b[0]<=x<=b[2] or not b[1]<=y<=b[3]:continue
        for i in range(0,len(s['indices']),3):
            a,b,c=[s['vertices'][j] for j in s['indices'][i:i+3]];dx=b[0]-a[0];dy=b[1]-a[1];ex=c[0]-a[0];ey=c[1]-a[1];det=dx*ey-dy*ex
            if abs(det)<1e-10:continue
            u=((x-a[0])*ey-(y-a[1])*ex)/det;v=(dx*(y-a[1])-dy*(x-a[0]))/det
            if u>=-1e-7 and v>=-1e-7 and u+v<=1.0000001:h=max(h,a[2]+u*(b[2]-a[2])+v*(c[2]-a[2]));break
    return h

def main(root):
    study=json.loads((root/'study.json').read_text());folder=root/'walk-tiles';folder.mkdir(exist_ok=True);report=[]
    for s in study['samples']:
        w=json.loads((root/s['walk']).read_text());size=200;axis=w['axis'];yaxis=w.get('yaxis',axis);step=w['step'];h=w['half']
        bounds=w.get('bounds',[-h,-h,h,h]);bx,by,ex,ey=bounds;nx=math.ceil((ex-bx)/size);ny=math.ceil((ey-by)/size)
        shapes={key:[Polygon(p['rings'][0],p['rings'][1:]) for p in w.get(key,[])] for key in ['buildings','water','roads','pavements','obstacles']}
        trees={key:STRtree(value) for key,value in shapes.items()}
        arrival=dict(w['arrival'],ground=ground(w,*w['arrival']['spawn']))
        # Include refined boundary samples where a DEM patch reaches the sample edge.
        horizontal=sorted(set(axis+[x for p in w.get('heightPatches',[]) for x in p['axis']]))
        vertical=sorted(set(yaxis+[p['terrainOrigin'][1]+j*p['step'] for p in w.get('heightPatches',[]) for j in range(len(p['heights']))]))
        edge=[[x,by,terrain(w,x,by)] for x in horizontal]+[[ex,y,terrain(w,ex,y)] for y in vertical][1:]+[[x,ey,terrain(w,x,ey)] for x in reversed(horizontal)][1:]+[[bx,y,terrain(w,bx,y)] for y in reversed(vertical)][1:]
        manifest=dict(version=2,edge=edge,half=h,bounds=bounds,tileSize=size,grid=nx,gridShape=[nx,ny],arrival=arrival,pavementRoute=w.get('pavementRoute'),tiles=[])
        for ix in range(nx):
            for iy in range(ny):
                x0,y0=bx+ix*size,by+iy*size;x1,y1=min(ex,x0+size),min(ey,y0+size)
                # The artificial polygon edge stays outside a player's collision radius.
                crop=box(x0-1,y0-1,x1+1,y1+1);data=dict(version=1,half=h,bounds=bounds,step=step,arrival=arrival,heightPatches=[p for p in w.get('heightPatches',[]) if box(*p['bounds']).intersects(crop)])
                data['heightSupports']=[dict(p,bounds=list(box(*p['bounds']).intersection(crop).bounds)) for p in w.get('heightSupports',[]) if box(*p['bounds']).intersects(crop)]
                for key,tree in trees.items():
                    data[key]=[]
                    for index in tree.query(crop,predicate='intersects'):
                        original=w[key][int(index)]
                        for poly in polygon_parts(shapes[key][int(index)].intersection(crop)):
                            if poly.area<1e-8:continue
                            data[key].append({**{k:v for k,v in original.items() if k not in ['rings','bounds']},'rings':rings(poly),'bounds':list(poly.bounds)})
                i0=max(0,math.floor((x0-bx)/step)-1);j0=max(0,math.floor((y0-by)/step)-1)
                i1=min(len(axis)-1,math.ceil((x1-bx)/step)+1);j1=min(len(yaxis)-1,math.ceil((y1-by)/step)+1)
                data.update(terrainOrigin=[axis[i0],yaxis[j0]],axis=axis[i0:i1+1],heights=[row[i0:i1+1] for row in w['heights'][j0:j1+1]])
                blob=json.dumps(data,ensure_ascii=False,separators=(',',':')).encode();compressed=gzip.compress(blob,mtime=0)
                file=f"walk-tiles/{s['id']}-{ix}-{iy}.json.gz";(root/file).write_bytes(compressed)
                manifest['tiles'].append(dict(id=f'{ix}-{iy}',bounds=[x0,y0,x1,y1],path=file,bytes=len(compressed),decodedBytes=len(blob),sha256=hashlib.sha256(blob).hexdigest()))
        file=f"walk-tiles/{s['id']}.json";(root/file).write_text(json.dumps(manifest,ensure_ascii=False,separators=(',',':')));s['walkTiles']=file
        report.append(dict(id=s['id'],tiles=nx*ny,gzipBytes=sum(t['bytes'] for t in manifest['tiles']),maxDecodedTileBytes=max(t['decodedBytes'] for t in manifest['tiles'])))
    (root/'study.json').write_text(json.dumps(study,ensure_ascii=False,indent=2));(root.parent/'walk-tiles-audit.json').write_text(json.dumps(report,indent=2));print(json.dumps(report,indent=2))

if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--root',type=Path,required=True);main(p.parse_args().root)
