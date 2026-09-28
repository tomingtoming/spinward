"""Split costly collision compounds without changing or dropping triangles."""
import math

def merge_adjacent_frontages(surfaces, parcels):
    """Pair cheap neighbouring addresses without discarding any native faces.

    Dense shop rows otherwise create dozens of tiny Rapier bodies inside the
    travel buffer. Only adjacent frontages on the same straight street edge
    may share a compound; no cell-wide grouping of distant roofs is used.
    """
    remaining=dict(surfaces);result={};by_route={}
    for p in parcels:
        if p.get('lot',{}).get('placement')=='block-frontage':
            by_route.setdefault((p['district'],p['route']),[]).append(p)
    for members in by_route.values():
        for p in members:
            vertices=remaining.get(p['id'])
            if not vertices or len(vertices)>160*3:continue
            c,s=math.cos(p['yaw']),math.sin(p['yaw']);choices=[]
            for q in members:
                other=remaining.get(q['id'])
                if q is p or not other or len(vertices)+len(other)>256*3:continue
                if abs(math.atan2(math.sin(p['yaw']-q['yaw']),math.cos(p['yaw']-q['yaw'])))>.025:continue
                dx,dy=q['frontage'][0]-p['frontage'][0],q['frontage'][1]-p['frontage'][1]
                if abs(-s*dx+c*dy)>1 or abs(c*dx+s*dy)>(p['lot']['width']+q['lot']['width'])/2+2:continue
                combined=vertices+other
                if any(max(v[k] for v in combined)-min(v[k] for v in combined)>48 for k in [0,1]):continue
                choices.append((math.hypot(dx,dy),q['id']))
            if choices:
                _,other_id=min(choices)
                result[p['id']+'+'+other_id]=remaining.pop(p['id'])+remaining.pop(other_id)
    result.update(remaining)
    assert sum(map(len,result.values()))==sum(map(len,surfaces.values()))
    return result

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


def refine_city_ground(packed):
    """Keep dense ground local, while pairing small fixed surface compounds.

    Faces and their winding stay unchanged. All pieces share the colony frame;
    merging is limited to nearby small compounds with identical support flags.
    Drawing geometry and building solids are not changed.
    """
    policy={'version':2,'cells':[32,16],'triangleThreshold':256,'mergeTriangles':256,'mergeSpan':48}
    if packed.get('collisionPartition')==policy:return packed
    result=refine_collision_surfaces(packed,32,256)
    result=refine_collision_surfaces(result,16,256)
    groups={};surfaces=[]
    for surface in result['surfaces']:
        if len(surface['indices'])>160*3:
            surfaces.append(surface);continue
        x0,y0,x1,y1=surface['bounds']
        key=(math.floor((x0+x1)/64),math.floor((y0+y1)/64))
        candidates=groups.setdefault(key,[])
        metadata={k:v for k,v in surface.items() if k not in ['indices','bounds']}
        for previous in candidates:
            if {k:v for k,v in previous.items() if k not in ['indices','bounds']}!=metadata:continue
            a,b,c,d=previous['bounds'];bounds=[min(a,x0),min(b,y0),max(c,x1),max(d,y1)]
            if len(previous['indices'])+len(surface['indices'])>256*3 or max(bounds[2]-bounds[0],bounds[3]-bounds[1])>48:continue
            previous['indices'].extend(surface['indices']);previous['bounds']=bounds
            break
        else:
            merged={**surface,'indices':list(surface['indices']),'bounds':list(surface['bounds'])}
            candidates.append(merged);surfaces.append(merged)
    assert sum(len(s['indices']) for s in surfaces)==sum(len(s['indices']) for s in packed['surfaces'])
    return {**result,'surfaces':surfaces,'collisionPartition':policy}
