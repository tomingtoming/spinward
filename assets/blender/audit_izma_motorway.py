"""Probe saved IC walking/driving faces; this is not runtime acceptance."""
import argparse
import hashlib
import json
import math
from pathlib import Path
import sys
import bpy
from mathutils.bvhtree import BVHTree


def audit(candidate):
    native=candidate/'assets/blender/izma-motorway.blend'
    plan=json.loads(native.with_name('izma-motorway-plan.json').read_text())
    bpy.ops.wm.open_mainfile(filepath=str(native))
    radius=plan['radius'];trees={};by_road={}
    for name in ['SW_izma_motorway','SW_izma_motorway_cylinder']:
        scene=bpy.data.scenes[name];scene.view_layers[0].update()
        floors=[];bodies=[]
        for obj in scene.objects:
            if obj.type!='MESH':continue
            obj.data.calc_loop_triangles();flags=obj.data.attributes['ground_surface'].data
            local_floors=[]
            for tri in obj.data.loop_triangles:
                vertices=[obj.matrix_world@obj.data.vertices[i].co for i in tri.vertices]
                points=[tuple(p) if name.endswith('cylinder') else (-p.y,p.x,p.z) for p in vertices]
                bodies.extend(points)
                if flags[tri.polygon_index].value:
                    floors.extend(points);local_floors.extend(points)
            if not name.endswith('cylinder'):
                by_road[(obj['motorway_id'],obj['role'])]=local_floors
        trees[name]=[BVHTree.FromPolygons(p,[tuple(range(i,i+3)) for i in range(0,len(p),3)],all_triangles=True)
                     for p in [floors,bodies]]
    samples=0;clearances=[];failures=[];maximum={'unrolled':0.,'cylinder':0.}
    travel_samples=0;support_samples=0
    for ic in plan['interchanges']:
        for road in ic['roads']:
            points=road['points']
            for a,b in zip(points,points[1:]):
                dx,dy=b[0]-a[0],b[1]-a[1];length=math.hypot(dx,dy)
                for t in [.25,.75]:
                    p=[a[k]+(b[k]-a[k])*t for k in range(3)]
                    for offset in [-road['width']/2+.35,0,road['width']/2-.35]:
                        x,y,h=p[0]-dy/length*offset,p[1]+dx/length*offset,p[2]
                        angle=x/radius;c,s=math.cos(angle),math.sin(angle)
                        unrolled=trees['SW_izma_motorway'][0].ray_cast((x,y,h+1),(0,0,-1),2)[0]
                        cylinder=trees['SW_izma_motorway_cylinder'][0].ray_cast((c*(radius-h-1),y,s*(radius-h-1)),(c,0,s),2)[0]
                        for space,hit in [('unrolled',unrolled),('cylinder',cylinder)]:
                            if hit is None:
                                failures.append({'id':ic['id'],'road':road['id'],'space':space,'kind':'missing-floor','position':[x,y,h]})
                                continue
                            actual=hit.z if space=='unrolled' else radius-math.hypot(hit.x,hit.z)
                            error=abs(actual-h);maximum[space]=max(maximum[space],error)
                            if error>.05:
                                failures.append({'id':ic['id'],'road':road['id'],'space':space,'kind':'floor-height','error':error,'position':[x,y,h]})
                        if road['kind']=='arterial' and abs(x-ic['node'][0])<11.5 and unrolled is not None:
                            top=trees['SW_izma_motorway'][1].ray_cast((x,y,unrolled.z+.5),(0,0,1),40)[0]
                            if top is None:
                                failures.append({'id':ic['id'],'kind':'missing-overpass','position':[x,y,h]})
                            else:
                                clearance=top.z-unrolled.z;clearances.append(clearance)
                                if clearance<6.2:failures.append({'id':ic['id'],'kind':'underpass-headroom','clearance':clearance})
                        samples+=1
                # Probe motion above the actual route, so a correctly painted
                # road cannot hide a railing or slab-end blocking its centre.
                lanes=[-4,4] if road['kind']=='arterial' else [0]
                for lane in lanes:
                    for height in [.4,1.6]:
                        p=(a[0]-dy/length*lane,a[1]+dx/length*lane,a[2]+height)
                        q=(b[0]-dy/length*lane,b[1]+dx/length*lane,b[2]+height)
                        direction=tuple(q[k]-p[k] for k in range(3));distance=math.sqrt(sum(v*v for v in direction))
                        direction=tuple(v/distance for v in direction)
                        hit=trees['SW_izma_motorway'][1].ray_cast(p,direction,max(0,distance-.01))[0]
                        if hit is not None:
                            failures.append({'id':ic['id'],'road':road['id'],'kind':'blocked-travel','height':height,'lane':lane,'point':tuple(hit)})
                        travel_samples+=1
        native_report=json.loads(native.with_suffix('.json').read_text())
        for support in [s for s in native_report['supports'] if s['ic']==ic['id']]:
            other=[p for (ident,road),points in by_road.items() if ident==ic['id'] and road!=support['road'] for p in points]
            other_tree=BVHTree.FromPolygons(other,[tuple(range(i,i+3)) for i in range(0,len(other),3)],all_triangles=True)
            x,y,h=support['position']
            for dx in [-.8,0,.8]:
                for dy in [-.8,0,.8]:
                    distance=support['top']-h-.4
                    hit=other_tree.ray_cast((x+dx,y+dy,h+.36),(0,0,1),max(.01,distance))[0]
                    if hit is not None:
                        failures.append({'id':ic['id'],'road':support['road'],'kind':'support-through-other-floor','point':tuple(hit)})
                    support_samples+=1
    report={'origin':'ai','created':'2026-09-20','nativeSha256':hashlib.sha256(native.read_bytes()).hexdigest(),
            'scope':'Saved native floor faces in both scenes, unrolled underpass headroom, centre travel rays and support shafts versus other candidate road floors. Retained source, runtime collision/export and traffic remain separate gates.',
            'samples':samples,'maximumFloorPlanError':maximum,'underpassSamples':len(clearances),
            'minimumNativeUnderpassClearance':min(clearances),'travelSamples':travel_samples,'supportSamples':support_samples,
            'failureCount':len(failures),'failures':failures}
    native.with_name('izma-motorway-audit.json').write_text(json.dumps(report,indent=2)+'\n')
    print(json.dumps({k:v for k,v in report.items() if k!='failures'}),flush=True)
    if failures:raise ValueError('Native candidate failed; preserve evidence and revise before integration')


if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--candidate-root',type=Path,required=True)
    args=parser.parse_args(sys.argv[sys.argv.index('--')+1:]);audit(args.candidate_root)
