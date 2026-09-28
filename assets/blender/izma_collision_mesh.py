"""Reduce redundant physical faces in the actual curved habitat coordinates.

The native drawing mesh is unchanged. Dissolve only low-angle internal edges,
retain the boundary, and compare vertices, edge midpoints and centroids in both
directions. A candidate exceeding the sampled error limit falls back intact.
This audit is supplemented by rendered-height and live-body traversal tests.
"""
import math
import hashlib
import json
import struct
import bmesh
from mathutils.bvhtree import BVHTree
from izma_street_frontages import triangle_altitude


def simplify_collision_surface(original,radius=3200,max_error=.005,angle_limit=.01):
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
    bmesh.ops.dissolve_limit(bm,angle_limit=angle_limit,use_dissolve_boundaries=False,verts=list(bm.verts),edges=list(bm.edges),delimit=set())
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


def simplify_collision_candidates(original):
    """Keep the smallest candidate that satisfies the same sampled 5 mm bound.

    A large dissolve angle can remove too much curvature and fall back to the
    full mesh. Smaller angles can still remove redundant terrain subdivisions.
    Each candidate is compared with the original, never a previous reduction.
    """
    best,error=original,0
    for angle in [.01,.003,.001,.0003]:
        points,deviation=simplify_collision_surface(original,angle_limit=angle)
        if len(points)<len(best):best,error=points,deviation
    return best,error


def simplify_packed_collision(packed, threshold=64):
    """Reduce redundant faces before small adjacent compounds are merged.

    A single entrance pad can be cheap but many such pads share the player's
    travel buffer. Include these medium compounds in the same error-bounded
    reduction; the drawing mesh remains unchanged.
    """
    pool=list(packed['vertices']);lookup={tuple(pool[i:i+3]):i//3 for i in range(0,len(pool),3)}
    surfaces=[];report={'tested':0,'accepted':0,'removedTriangles':0,'maximumSampledError':0}
    for surface in packed['surfaces']:
        ids=surface['indices']
        if len(ids)<=threshold*3:
            surfaces.append(surface);continue
        report['tested']+=1
        original=[tuple(pool[i*3:i*3+3]) for i in ids]
        points,error=simplify_collision_candidates(original)
        if len(points)>=len(original):
            surfaces.append(surface);continue
        report['accepted']+=1;report['removedTriangles']+=(len(original)-len(points))//3
        report['maximumSampledError']=max(report['maximumSampledError'],error)
        indices=[]
        for point in points:
            key=tuple(point)
            if key not in lookup:lookup[key]=len(pool)//3;pool.extend(point)
            indices.append(lookup[key])
        a,b,c,d=surface['bounds'];xs=[p[0] for p in points];ys=[p[1] for p in points]
        surfaces.append({**surface,'indices':indices,'bounds':[min(a,min(xs)),min(b,min(ys)),max(c,max(xs)),max(d,max(ys))]})
    result={**packed,'vertices':pool,'surfaces':surfaces}
    result.pop('collisionPartition',None)
    return result,report


def collision_signature(packed):
    """Hash physical coordinates and metadata independently of drawing indices."""
    digest=hashlib.sha256();vertices=packed['vertices']
    for surface in packed['surfaces']:
        metadata={k:v for k,v in surface.items()if k!='indices'}
        digest.update(json.dumps(metadata,sort_keys=True,separators=(',',':')).encode())
        digest.update(struct.pack('!I',len(surface['indices'])))
        for i in surface['indices']:
            digest.update(struct.pack('!ddd',*vertices[i*3:i*3+3]))
    return digest.hexdigest()


def finalize_packed_collision(packed):
    """Simplify the final compounds once, after neighbouring faces are joined.

    The 5 mm sampled bound is relative to this compiled input, not a continuous
    bound against the native drawing. Repeated finalization must not accumulate
    further approximation; changed finalized geometry needs a fresh native export.
    """
    signature=collision_signature(packed)
    previous=packed.get('collisionFinalization')
    if previous is not None:
        if previous.get('version')!=1 or previous.get('geometrySha256')!=signature:
            raise ValueError('Finalized collision geometry changed; export this layer from its native source again')
        return packed,{**previous['audit'],'reused':True}
    result,audit=simplify_packed_collision(packed)
    if 'collisionPartition' in packed:result['collisionPartition']=packed['collisionPartition']
    result['collisionFinalization']={'version':1,'sourceGeometrySha256':signature,
                                    'geometrySha256':collision_signature(result),'audit':audit}
    return result,{**audit,'reused':False}
