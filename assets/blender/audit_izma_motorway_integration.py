"""Probe new ICs together with retained full-source roads and support bodies."""
import argparse
from collections import defaultdict
import hashlib
import json
import math
from pathlib import Path
import sys
from mathutils.bvhtree import BVHTree

ASSETS=Path(__file__).resolve().parent;ROOT=ASSETS.parents[1]
sys.path.insert(0,str(ASSETS))
from colony_manifest_io import encoded,read_manifest


def audit(source_root,river_only=False):
    source=read_manifest(source_root/'src/worlds/generated/izmaColony.json')
    radius=source['radius'];plan=source['motorway']['interchanges'];collected={}
    if river_only:
        river=source['motorway']['riverConnection']
        profile=next(p for p in json.loads((ASSETS/'izma-transport.json').read_text())['profiles'] if p['id']=='a-river-access')
        route=[*[p for p in river['points']],*profile['points'][river['joinOriginalAt']+1:river['joinOriginalAt']+5]]
        route=[[80,-80,river['newEntry'][2]],*route]
        plan=[{'id':river['id'],'node':[10000,0],'roads':[{'id':river['id'],'kind':'river-connection','width':8.,'points':route}], 'mainline':[]}]
    for ic in plan:
        all_points=[p for r in ic['roads'] for p in r['points']]+ic['mainline']
        collected[ic['id']]={'bounds':[min(p[0] for p in all_points)-40,min(p[1] for p in all_points)-40,
                                        max(p[0] for p in all_points)+40,max(p[1] for p in all_points)+40],
                             'draw_floor':[],'draw_body':[],'physical_floor':[],'physical_body':[]}
    grid=defaultdict(list)
    for ident,data in collected.items():
        x0,y0,x1,y1=data['bounds']
        for x in range(math.floor(x0/256),math.floor(x1/256)+1):
            for y in range(math.floor(y0/256),math.floor(y1/256)+1):grid[(x,y)].append(ident)
    def add(kind,tri):
        x0,y0,x1,y1=min(p[0] for p in tri),min(p[1] for p in tri),max(p[0] for p in tri),max(p[1] for p in tri)
        keys={ident for x in range(math.floor(x0/256),math.floor(x1/256)+1)
                    for y in range(math.floor(y0/256),math.floor(y1/256)+1) for ident in grid.get((x,y),[])}
        for ident in keys:
            data=collected[ident];a,b,c,d=data['bounds']
            if x0<=c and x1>=a and y0<=d and y1>=b:data[kind].extend(tri)
    # Include every fixed layer. A neighbouring court or city path is as real
    # an obstruction as a mainline slab, even though its authoring file differs.
    packed_layers={'base':source['base'],**{name:v['fixed'] for name,v in source.items() if isinstance(v,dict) and 'fixed' in v}}
    additional_solids=[]
    if river_only:
        study=json.loads((ROOT/'src/worlds/generated/worldLandscapes.json').read_text())['izma']
        packed_layers['study']={'vertices':study['vertices'],'meshes':study['lods'][0],'surfaces':study['surfaces']}
        additional_solids.extend([b['x'],b['y'],b['z'],b['width'],b['depth'],b['height'],b['yaw']] for b in study['solids'])
        bounds=collected[river['id']]['bounds']
        for tile in source['tiles']:
            a,b,c,d=tile['bounds'];x,y,xx,yy=bounds
            if a<=xx and c>=x and b<=yy and d>=y:
                packed_layers['tile-'+tile['id']]=json.loads((source_root/'public'/tile['url'].lstrip('/')).read_text())
                additional_solids.extend(box[:7] for box in tile.get('boxes',[]))
    road_materials={'earth','road','arterial','local','expressway','walk','verge','ballast','motorway-road','motorway-walk'}
    if river_only:road_materials-={'earth','verge','ballast'}
    for name,packed in packed_layers.items():
        points=[tuple(packed['vertices'][i:i+3]) for i in range(0,len(packed['vertices']),3)]
        for material,ids in packed['meshes'].items():
            if 'mark' in material or 'lamp' in material:continue
            for i in range(0,len(ids),3):
                tri=[points[v] for v in ids[i:i+3]]
                add('draw_body',tri)
                if name in ['base','motorway','study'] and material in road_materials:add('draw_floor',tri)
        for surface in packed['surfaces']:
            ids=surface['indices']
            for i in range(0,len(ids),3):
                tri=[points[v] for v in ids[i:i+3]];add('physical_body',tri)
                if surface.get('groundSurface',True):add('physical_floor',tri)
    faces=[(0,1,2,3),(4,5,6,7),(0,4,5,1),(1,5,6,2),(2,6,7,3),(3,7,4,0)]
    for x,y,z,w,d,h,yaw in [*source['structures'],*additional_solids]:
        c,s=math.cos(yaw),math.sin(yaw)
        vertices=[(x+dx*c-dy*s,y+dx*s+dy*c,z+up) for up in [0,h] for dx,dy in [(-w/2,-d/2),(w/2,-d/2),(w/2,d/2),(-w/2,d/2)]]
        for a,b,c,d in faces:
            add('physical_body',[vertices[a],vertices[b],vertices[c]])
            add('physical_body',[vertices[a],vertices[c],vertices[d]])
    failures=[];counts=defaultdict(int);maximum=defaultdict(float);headroom=[]
    def curved(p):
        x,y,h=p;angle=x/radius
        return (math.cos(angle)*(radius-h),y,math.sin(angle)*(radius-h))
    def tree(points):return BVHTree.FromPolygons(points,[tuple(range(i,i+3)) for i in range(0,len(points),3)],all_triangles=True)
    for ic in plan:
        data=collected.pop(ic['id']);trees={name:tree([curved(p) for p in points]) for name,points in data.items() if name!='bounds'}
        def floor(x,y,h,label,tolerance=.05,profile=True):
            angle=x/radius;direction=(math.cos(angle),0,math.sin(angle));origin=curved((x,y,h+.4))
            heights={}
            for key in ['draw_floor','physical_floor']:
                hit=trees[key].ray_cast(origin,direction,.8)[0];counts[key]+=1
                if hit is None:failures.append({'ic':ic['id'],'kind':'missing-'+key,'road':label,'position':[x,y,h]});continue
                actual=radius-math.hypot(hit.x,hit.z);heights[key]=actual
                maximum[key]=max(maximum[key],abs(actual-h))
                if profile and abs(actual-h)>tolerance:
                    failures.append({'ic':ic['id'],'kind':key+'-profile','road':label,'position':[x,y,h],'actual':actual})
            if len(heights)==2:
                difference=abs(heights['draw_floor']-heights['physical_floor']);maximum['drawPhysical']=max(maximum['drawPhysical'],difference)
                if difference>.025:failures.append({'ic':ic['id'],'kind':'draw-physical','road':label,'position':[x,y,h],**heights})
            return heights
        def travel(a,b,label,lateral,height):
            dx,dy=b[0]-a[0],b[1]-a[1];length=math.hypot(dx,dy)
            start=curved((a[0]-dy/length*lateral,a[1]+dx/length*lateral,a[2]+height))
            end=curved((b[0]-dy/length*lateral,b[1]+dx/length*lateral,b[2]+height))
            distance=math.dist(start,end);direction=tuple((end[k]-start[k])/distance for k in range(3))
            for key in ['draw_body','physical_body']:
                hit=trees[key].ray_cast(start,direction,max(.01,distance-.01))[0];counts['travel_'+key]+=1
                if hit is not None:
                    x=math.atan2(hit.z,hit.x)*radius
                    x+=round(((a[0]+b[0])/2-x)/(math.tau*radius))*math.tau*radius
                    failures.append({'ic':ic['id'],'kind':'blocked-'+key,'road':label,'lane':lateral,'height':height,
                                     'position':[x,hit.y,radius-math.hypot(hit.x,hit.z)]})
        for road in ic['roads']:
            for a,b in zip(road['points'],road['points'][1:]):
                dx,dy=b[0]-a[0],b[1]-a[1];length=math.hypot(dx,dy)
                for t in [.25,.75]:
                    p=[a[k]+(b[k]-a[k])*t for k in range(3)]
                    for lane in [-road['width']/2+.35,0,road['width']/2-.35]:
                        x,y,h=p[0]-dy/length*lane,p[1]+dx/length*lane,p[2]
                        # A junction may have crossfall. Its guide states the
                        # centreline elevation; side lanes must still have a
                        # painted deck agreeing with actual collision, with
                        # terrain excluded from the drawing floor oracle.
                        floor(x,y,h,road['id'],profile=not river_only or lane==0)
                        if road['kind']=='arterial' and abs(x-ic['node'][0])<11.5:
                            origin=curved((x,y,h+.5));direction=(-math.cos(x/radius),0,-math.sin(x/radius))
                            hit=trees['draw_body'].ray_cast(origin,direction,40)[0];counts['headroom']+=1
                            if hit is None:failures.append({'ic':ic['id'],'kind':'missing-overpass'})
                            else:
                                clearance=radius-math.hypot(hit.x,hit.z)-h;headroom.append(clearance)
                                if clearance<6.2:failures.append({'ic':ic['id'],'kind':'headroom','height':clearance})
                lanes=[-9.1,-4,4,9.1] if road['kind']=='arterial' else [-1.2,0,1.2]
                for lane in lanes:
                    for height in [.4,1.6]:travel(a,b,road['id'],lane,height)
            # Traverse the seam into the retained city road and all motorway
            # carriageways, beyond the original standalone candidate bounds.
            if road['kind']=='arterial':
                a,b=road['points'][:2];delta=[b[k]-a[k] for k in range(3)]
                previous=[a[k]-delta[k] for k in range(3)]
                for lane in [-4,4]:travel(previous,b,road['id']+'-retained-seam',lane,.5)
        for a,b in zip(ic['mainline'],ic['mainline'][1:]):
            if math.dist(a[:2],b[:2])<1e-6:continue
            p=[(a[k]+b[k])/2 for k in range(3)]
            for x in [-8,-4,4,8]:
                floor(p[0]+x,p[1],p[2],'retained-mainline')
                travel(a,b,'retained-mainline',x,.6)
        print(json.dumps({'ic':ic['id'],'failuresSoFar':len(failures)}),flush=True)
    result={'origin':'ai','created':'2026-09-20','sourceSha256':hashlib.sha256(encoded(source)).hexdigest(),
            'scope':'Curved drawing and collision of every fixed source layer plus structure boxes; new IC roads, retained mainline and seam travel. Runtime physics/XR are separate.',
            'counts':dict(counts),'maximumErrors':dict(maximum),'minimumUnderpassClearance':min(headroom) if headroom else None,
            'failureCount':len(failures),'failures':failures}
    result['scope']='River bridge connection including actual study and nearby building tiles' if river_only else result['scope']
    (source_root/('river-integration-audit.json' if river_only else 'motorway-integration-audit.json')).write_text(json.dumps(result,indent=2)+'\n')
    print(json.dumps({k:v for k,v in result.items() if k!='failures'}),flush=True)
    if failures:raise ValueError('Composed IC source failed; do not install')


if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--source-root',type=Path,required=True)
    parser.add_argument('--river-only',action='store_true')
    args=parser.parse_args(sys.argv[sys.argv.index('--')+1:]);audit(args.source_root,args.river_only)
