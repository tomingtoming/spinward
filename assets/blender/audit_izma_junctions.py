"""Ray-probe saved native JCT meshes, including barriers and support bodies.

This certifies the isolated candidate only. Retained source, streaming, physics
budgets and actual VR traversal need separate integration checks.
"""
import argparse
from collections import Counter
import hashlib
import json
import math
from pathlib import Path
import sys
import bpy
from mathutils.bvhtree import BVHTree


def audit(candidate):
    native=candidate/'assets/blender/izma-junctions.blend'
    plan=json.loads(native.with_name('izma-junction-plan.json').read_text())
    edit=json.loads(native.with_suffix('.json').read_text())
    assert hashlib.sha256(native.read_bytes()).hexdigest()==edit['nativeSha256']
    bpy.ops.wm.open_mainfile(filepath=str(native));scene=bpy.data.scenes['SW_izma_junctions_cylinder']
    floors=[];bodies=[];owners=[]
    for obj in scene.objects:
        if obj.type!='MESH':continue
        obj.data.calc_loop_triangles();physical=obj.data.attributes['physical'].data;ground=obj.data.attributes['ground_surface'].data
        for tri in obj.data.loop_triangles:
            if not physical[tri.polygon_index].value:continue
            points=[tuple(obj.matrix_world@obj.data.vertices[i].co) for i in tri.vertices]
            bodies.extend(points);owners.append(obj['junction_id'])
            if ground[tri.polygon_index].value:floors.extend(points)
    def tree(points):return BVHTree.FromPolygons(points,[tuple(range(i,i+3)) for i in range(0,len(points),3)],all_triangles=True)
    floor=tree(floors);body=tree(bodies);radius=plan['radius'];failures=[];counts=Counter();max_error=0.
    def curved(p):
        x,y,h=p
        return (math.cos(x/radius)*(radius-h),y,math.sin(x/radius)*(radius-h))
    routes=[*plan['rings'],*edit['mainlinePatches'],*[r for s in plan['sites'] for r in s['movements']]]
    for route in routes:
        width=route['width'];lanes=[-9.,-3.,3.,9.] if width==24 else [-1.2,0,1.2]
        for a,b in zip(route['points'],route['points'][1:]):
            dx,dy=b[0]-a[0],b[1]-a[1];distance=math.hypot(dx,dy)
            for lane in lanes:
                p=[(a[k]+b[k])/2 for k in range(3)];p[0]-=dy/distance*lane;p[1]+=dx/distance*lane
                hit=floor.ray_cast(curved((p[0],p[1],p[2]+.35)),(math.cos(p[0]/radius),0,math.sin(p[0]/radius)),.7)[0]
                counts['floor']+=1
                if hit is None:failures.append({'kind':'missing-floor','route':route['id'],'position':p})
                else:
                    error=abs(radius-math.hypot(hit.x,hit.z)-p[2]);max_error=max(max_error,error)
                    if error>.06:failures.append({'kind':'profile-error','route':route['id'],'position':p,'error':error})
                for height in [.4,1.6,4.5]:
                    start=curved((a[0]-dy/distance*lane,a[1]+dx/distance*lane,a[2]+height))
                    end=curved((b[0]-dy/distance*lane,b[1]+dx/distance*lane,b[2]+height))
                    d=math.dist(start,end);direction=tuple((end[k]-start[k])/d for k in range(3))
                    hit,normal,index,hit_distance=body.ray_cast(start,direction,max(.001,d-.005));counts['travel']+=1
                    if hit is not None:
                        x=math.atan2(hit.z,hit.x)*radius;x+=round((p[0]-x)/(math.tau*radius))*math.tau*radius
                        failures.append({'kind':'blocked','route':route['id'],'lane':lane,'height':height,
                                         'obstacle':owners[index],'position':[x,hit.y,radius-math.hypot(hit.x,hit.z)]})
    # The new columns/portal caps must also leave retained traffic and walking
    # routes open. Check the installed, exact-source profiles against the new
    # bodies, including the arterials directly beneath both end motorways.
    assets=Path(__file__).resolve().parent
    retained=json.loads((assets/'izma-motorway-routes.json').read_text())
    assert retained['sourceSha256']==plan['sourceSha256']
    widths={r['id']:r['width'] for r in retained['referenceRoutes']}
    for route in retained['profiles']:
        width=widths[route['id']]
        lanes=[-9.,-3.,3.,9.] if route['kind']=='expressway' else [-width*.25,width*.25]
        if route['kind'] in ['arterial','local']:lanes.extend([-width/2-1.1,width/2+1.1])
        for a,b in zip(route['points'],route['points'][1:]):
            dx,dy=b[0]-a[0],b[1]-a[1];distance=math.hypot(dx,dy)
            if distance<1e-7:continue
            for lane in lanes:
                for height in [.4,1.6,4.5,6.2]:
                    if abs(lane)>width/2 and height>1.6:continue
                    start=curved((a[0]-dy/distance*lane,a[1]+dx/distance*lane,a[2]+height))
                    end=curved((b[0]-dy/distance*lane,b[1]+dx/distance*lane,b[2]+height))
                    d=math.dist(start,end);direction=tuple((end[k]-start[k])/d for k in range(3))
                    hit,normal,index,hit_distance=body.ray_cast(start,direction,max(.001,d-.005));counts['retainedTravel']+=1
                    if hit is not None:
                        x=math.atan2(hit.z,hit.x)*radius;x+=round((a[0]-x)/(math.tau*radius))*math.tau*radius
                        failures.append({'kind':'blocked-retained','route':route['id'],'lane':lane,'height':height,
                                         'obstacle':owners[index],'position':[x,hit.y,radius-math.hypot(hit.x,hit.z)]})
    pending_retirement=[];unexpected=[]
    for failure in failures:
        retired=next((r for r in plan.get('terminalRetirements',[]) if
                      failure['kind']=='blocked-retained' and failure['route']==f"band-{r['band']}-expressway" and
                      min(r['from'],r['to'])-.002<=failure['position'][1]<=max(r['from'],r['to'])+.002 and
                      abs(failure['position'][0]-r['x'])<=r['width']/2+.1 and
                      failure['obstacle'].startswith(r['id']+'-')),None)
        (pending_retirement if retired else unexpected).append(failure)
    report={'origin':'ai','created':'2026-09-21','nativeSha256':edit['nativeSha256'],
            'scope':'Saved candidate drawing/physical flags plus installed transport profile rays against new bodies. Combined retained/new body geometry, streaming and runtime are not included.',
            'routes':len(routes),'counts':dict(counts),'maximumFloorError':max_error,
            'failureCount':len(failures),'failureKinds':dict(Counter(f['kind'] for f in failures)),
            'unexpectedFailureCount':len(unexpected),'pendingRetirementConflicts':pending_retirement,
            'integrationReady':not failures,'failures':failures}
    (candidate/'native-geometry-audit.json').write_text(json.dumps(report,separators=(',',':'))+'\n')
    return {k:v for k,v in report.items() if k not in ['failures','pendingRetirementConflicts']}|{
        'pendingRetirementConflictCount':len(pending_retirement),'examples':unexpected[:12]}


if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--candidate-root',type=Path,required=True)
    a=p.parse_args(sys.argv[sys.argv.index('--')+1:]);report=audit(a.candidate_root);print(json.dumps(report),flush=True)
    if report['failureCount']:raise ValueError('Native junction candidate failed')
