"""Convex corner addresses bounded by the two actual street directions.

These are Spinward planning dimensions, not measurements of the reference art.
The road-side edges survive clipping; an arbitrary leftover polygon is not a
corner address. Existing doors, gardens and public space remain reservations.
"""
import math
from izma_ground_patches import area
from izma_street_frontages import clean, half_plane, subtract


def clip_normal(polygon, normal, lower):
    """Keep dot(point, normal) >= lower, in a local metre coordinate frame."""
    length=math.hypot(*normal)
    nx,ny=normal[0]/length,normal[1]/length
    a=(nx*lower/length,ny*lower/length)
    return half_plane(polygon,a,(a[0]+ny,a[1]-nx),True)


def corner_outline(first, second, first_width, second_width, reach=24):
    """CCW sector between outgoing rays, with a clear walking verge on both."""
    angle=math.atan2(first[0]*second[1]-first[1]*second[0],sum(a*b for a,b in zip(first,second)))
    if not math.radians(35)<angle<math.radians(165):return [],[]
    polygon=[(-reach,-reach),(reach,-reach),(reach,reach),(-reach,reach)]
    frontages=[((-first[1],first[0]),first_width/2+2.15),
               ((second[1],-second[0]),second_width/2+2.15)]
    for normal,lower in frontages:
        polygon=clip_normal(polygon,normal,lower)
    # A shallow rear boundary leaves a separate block interior, rather than
    # running each frontage through the entire depth of the block.
    bisector=(first[0]+second[0],first[1]+second[1])
    length=math.hypot(*bisector);bisector=tuple(v/length for v in bisector)
    polygon=clip_normal(polygon,tuple(-v for v in bisector),-reach)
    # Clip the sharp street corner for sight and a small door recess.
    if polygon:
        nearest=min(sum(p[k]*bisector[k] for k in range(2)) for p in polygon)
        polygon=clip_normal(polygon,bisector,nearest+1.5)
    return polygon,frontages


def frontage_edges(polygon, frontages):
    edges=[]
    for normal,lower in frontages:
        found=[]
        for i,(a,b) in enumerate(zip(polygon,polygon[1:]+polygon[:1])):
            if all(abs(sum(p[k]*normal[k] for k in range(2))-lower)<1e-5 for p in [a,b]):
                found.append((math.dist(a,b),i))
        edges.append(max(found,default=(0,-1)))
    return edges


def trim_corner(polygon, obstacles, frontages):
    """Choose one usable convex address while retaining both street fronts."""
    pieces=[polygon]
    for obstacle in obstacles:
        pieces=[p for piece in pieces for p in subtract(piece,obstacle)
                if abs(area(p))>=35 and all(length>=3.5 for length,_ in frontage_edges(p,frontages))]
        if not pieces:return []
    return max(pieces,key=lambda p:abs(area(p))) if pieces else []


def simplify(points,tolerance=.15):
    """Keep street bends, without treating every terrain-height row as a node."""
    if len(points)<=2:return [p[:2] for p in points]
    a,b=points[0],points[-1];dx,dy=b[0]-a[0],b[1]-a[1];length=dx*dx+dy*dy
    best=(0,0)
    for i,p in enumerate(points[1:-1],1):
        t=max(0,min(1,((p[0]-a[0])*dx+(p[1]-a[1])*dy)/length)) if length else 0
        distance=math.hypot(p[0]-a[0]-t*dx,p[1]-a[1]-t*dy)
        best=max(best,(distance,i))
    if best[0]<=tolerance:return [a[:2],b[:2]]
    i=best[1]
    return simplify(points[:i+1],tolerance)[:-1]+simplify(points[i:],tolerance)
