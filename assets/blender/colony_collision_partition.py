"""Split costly collision compounds without changing or dropping triangles."""
import math

def refine_collision_surfaces(packed, cell=128, threshold=256):
    vertices=packed['vertices'];surfaces=[]
    for surface in packed['surfaces']:
        ids=surface['indices']
        if len(ids)<=threshold*3:
            surfaces.append(surface);continue
        groups={}
        for i in range(0,len(ids),3):
            triangle=ids[i:i+3]
            x=sum(vertices[v*3]for v in triangle)/3
            y=sum(vertices[v*3+1]for v in triangle)/3
            groups.setdefault((math.floor(x/cell),math.floor(y/cell)),[]).extend(triangle)
        for indices in groups.values():
            xs=[vertices[i*3]for i in indices];ys=[vertices[i*3+1]for i in indices]
            surfaces.append({**surface,'indices':indices,'bounds':[min(xs),min(ys),max(xs),max(ys)]})
    return {**packed,'surfaces':surfaces}

def refine_colony_base(packed):
    policy={'version':1,'cells':[128,64],'triangleThreshold':256}
    if packed.get('collisionPartition')==policy:return packed
    # First reduce the old 256 m compounds; only still-costly children need
    # finer cells. This avoids multiplying cheap terrain descriptors globally.
    result=refine_collision_surfaces(packed,128)
    result=refine_collision_surfaces(result,64)
    return {**result,'collisionPartition':policy}
