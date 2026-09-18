"""Reduce redundant physical faces in the actual curved habitat coordinates.

The native drawing mesh is unchanged. Dissolve only low-angle internal edges,
retain the boundary, and compare vertices, edge midpoints and centroids in both
directions. A candidate exceeding the sampled error limit falls back intact.
This audit is supplemented by rendered-height and live-body traversal tests.
"""
import math
import bmesh
from mathutils.bvhtree import BVHTree
from izma_street_frontages import triangle_altitude


def simplify_collision_surface(original,radius=3200,max_error=.005):
    def curved(v,origin):
        a=v[0]/radius;r=radius-v[2]-origin[2]
        return (math.cos(a)*r-radius,v[1],math.sin(a)*r)
    def tree(points):return BVHTree.FromPolygons(points,[(i,i+1,i+2) for i in range(0,len(points),3)],all_triangles=True)
    def error(source,target):
        distance=0
        for i in range(0,len(source),3):
            a,b,c=source[i:i+3]
            for v in [a,b,c,tuple((a[k]+b[k]+c[k])/3 for k in range(3)),*[tuple((u[k]+v[k])/2 for k in range(3)) for u,v in [(a,b),(b,c),(c,a)]]]:
                hit=target.find_nearest(v)
                if not hit[0]:return math.inf
                distance=max(distance,hit[3])
                if distance>max_error:return distance
        return distance
    pool=[n for p in original for n in p];ids=list(range(len(original)));origin=list(original[0])
    bm=bmesh.new();vs={i:bm.verts.new(curved([pool[i*3+j]-origin[j] for j in range(3)],origin)) for i in ids}
    for k in range(0,len(ids),3):
        try:bm.faces.new([vs[i] for i in ids[k:k+3]])
        except ValueError:pass
    bmesh.ops.remove_doubles(bm,verts=list(bm.verts),dist=.00001)
    bm.normal_update()
    bmesh.ops.dissolve_limit(bm,angle_limit=.01,use_dissolve_boundaries=False,verts=list(bm.verts),edges=list(bm.edges),delimit=set())
    bmesh.ops.triangulate(bm,faces=list(bm.faces))
    points=[]
    for f in bm.faces:
        ps=[[round(math.atan2(v.co.z,v.co.x+radius)*radius+origin[0],5),round(v.co.y+origin[1],5),round(radius-math.hypot(v.co.x+radius,v.co.z),5)] for v in f.verts]
        if triangle_altitude(ps)>1e-6:points.extend(ps)
    bm.free()
    if len(points)<len(original):
        a=[curved([v[k]-origin[k] for k in range(3)],origin) for v in original]
        b=[curved([v[k]-origin[k] for k in range(3)],origin) for v in points]
        deviation=max(error(a,tree(b)),error(b,tree(a)))
        if deviation>max_error:return original,0
        return points,deviation
    return original,0
