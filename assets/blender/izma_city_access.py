"""Keep a public footway clear before an entrance descends towards its door."""
import copy
import math
from izma_ground_patches import GroundPatches,area


def native_walk_patches(base):
    pool=base['vertices'];ids=base['meshes'].get('walk',[]);flat=[]
    for i in range(0,len(ids),3):
        if abs(area([pool[k*3:k*3+2]for k in ids[i:i+3]]))>1e-7:flat.extend(ids[i:i+3])
    return GroundPatches({'vertices':pool,'meshes':{'earth':flat}})


def footway_obstructs(parcel,walk):
    e=parcel['entrance'];a,b=e['start'],e['end'];length=math.dist(a[:2],b[:2])
    dx,dy=b[0]-a[0],b[1]-a[1];half=e['width']/2-.32
    def point(t,side):return [a[0]+dx*t-dy/length*side,a[1]+dy*t+dx/length*side]
    for lo,hi,start,end in entry_sections(parcel):
        polygon=[point(lo,half),point(lo,-half),point(hi,-half),point(hi,half)]
        for piece in walk.split(polygon):
            for x,y,h in piece:
                t=((x-a[0])*dx+(y-a[1])*dy)/(length*length)
                floor=start+(end-start)*(t-lo)/(hi-lo)
                if .18<h-floor<2.1:return True
    return False


def entry_sections(parcel):
    e=parcel['entrance'];a,b=e['start'],e['end']
    length=math.dist(a[:2],b[:2]);landing=min(1,e.get('landingLength',0)/length)
    if landing>0:yield 0,landing,a[2],a[2]
    if landing>=1:return
    count=1 if e['ramp'] else e['steps']
    for i in range(count):
        low=landing+(1-landing)*i/count;high=landing+(1-landing)*(i+1)/count
        end=a[2]+(b[2]-a[2])*(i+1)/count
        start=a[2]+(b[2]-a[2])*i/count if e['ramp'] else end
        yield low,high,start,end


def raised_footway_entry(parcel,walk):
    """Use the actual clipped footway, preserving its continuous public route.

    Start the stair flight beyond the footway. If its remaining run is too
    short, raise the building's threshold only enough to retain normal treads.
    The original foundation bottom and horizontal allocation are preserved.
    """
    p=copy.deepcopy(parcel);e=p['entrance'];a,b=e['start'],e['end']
    length=math.dist(a[:2],b[:2]);nx,ny=(b[0]-a[0])/length,(b[1]-a[1])/length
    half=e['width']/2+.02
    polygon=[[a[0]-ny*half,a[1]+nx*half],[a[0]+ny*half,a[1]-nx*half],
             [b[0]+ny*half,b[1]-nx*half],[b[0]-ny*half,b[1]+nx*half]]
    points=[q for piece in walk.split(polygon)for q in piece]
    if not points:raise ValueError('No actual footway intersects '+p['id'])
    top=max(a[2],max(q[2]for q in points)+.015)
    last=max((q[0]-a[0])*nx+(q[1]-a[1])*ny for q in points)
    landing=min(length,max(0,last)+.04)
    run=length-landing
    maximum_steps=max(0,math.floor((run+1e-8)/.28))
    floor=max(p['floor'],top-maximum_steps*.16)
    if run<.4:floor=max(floor,top)
    rise=floor-top
    if rise>1e-7:raise ValueError('Uphill threshold needs a separate graded landing: '+p['id'])
    ramp=abs(rise)<=run*.08+1e-8
    steps=1 if ramp else max(1,math.ceil(abs(rise)/.16-1e-8))
    assert ramp or run/steps>=.28-1e-7
    e.update(start=[a[0],a[1],top],end=[b[0],b[1],floor],landingLength=landing,ramp=ramp,steps=steps)
    p['floor']=floor
    p['accessClearance']={'version':1,'originalFloor':parcel['floor'],'floorRaise':floor-parcel['floor'],
                          'originalStart':parcel['entrance']['start'],'landingLength':landing,'flightRun':run}
    return p


def append_entry(builder,parcel):
    e=parcel['entrance'];a,b=e['start'],e['end'];length=math.dist(a[:2],b[:2])
    dx,dy=b[0]-a[0],b[1]-a[1];x,y=parcel['position'];c,s=math.cos(parcel['yaw']),math.sin(parcel['yaw'])
    def point(t,side,h):
        px=a[0]+dx*t-dy/length*side*e['width']/2-x
        py=a[1]+dy*t+dx/length*side*e['width']/2-y
        return c*px+s*py,-s*px+c*py,h-parcel['floor']
    previous=a[2]
    for lo,hi,start,end in entry_sections(parcel):
        left,right=point(lo,-1,start),point(lo,1,start)
        builder.face([left,right,point(hi,1,end),point(hi,-1,end)],'paving',True)
        if abs(start-previous)>1e-8:
            builder.face([point(lo,-1,previous),point(lo,1,previous),right,left],'foundation',True)
        previous=end
