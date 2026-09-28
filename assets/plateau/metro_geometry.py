"""Metric rendering helpers for the three continuous Tokyo source strips.

Source coordinates stay in metres. Geometry is clipped only at colony edges;
tile ownership never cuts a building into independently loaded pieces.
"""
import gzip
import hashlib
import json
import math
import struct
from pathlib import Path

import numpy as np
from shapely import build_area, constrained_delaunay_triangles, set_precision, union_all
from shapely.affinity import affine_transform
from shapely.geometry import LineString, Polygon
from shapely.geometry.polygon import orient


def polygons(shape):
    if shape.is_empty:
        return
    if shape.geom_type == 'Polygon':
        yield shape
    elif hasattr(shape, 'geoms'):
        for part in shape.geoms:
            yield from polygons(part)


class Frame:
    def __init__(self, band):
        self.origin = np.asarray(band['frame']['origin'])
        angle = band['frame']['angle']
        c, s = math.cos(angle), math.sin(angle)
        self.matrix = np.array([[s, -c], [c, s]])
        offset = -self.matrix @ self.origin
        self.affine = [s, -c, c, s, *offset]

    def points(self, points):
        result = np.asarray(points, dtype=np.float64).copy()
        result[..., :2] = (result[..., :2] - self.origin) @ self.matrix.T
        return result

    def shape(self, shape):
        return affine_transform(shape, self.affine)


class Grid:
    def __init__(self, root, band):
        self.meta = json.loads((root / 'terrain' / (band + '.json')).read_text())
        assert self.meta['ready'] and self.meta['sampleCounts']['missing'] == 0
        self.step = self.meta['step']
        self.origin = self.meta['origin']
        self.z = np.memmap(root / self.meta['heights'], dtype='<f4', mode='r',
                           shape=tuple(reversed(self.meta['grid'])))

    def height(self, x, y):
        x, y = np.broadcast_arrays(np.asarray(x), np.asarray(y))
        u, v = (x-self.origin[0])/self.step, (y-self.origin[1])/self.step
        if np.any(u < -1e-7) or np.any(v < -1e-7) or np.any(u > self.z.shape[1]-1+1e-7) or np.any(v > self.z.shape[0]-1+1e-7):
            raise ValueError('Terrain query outside acquired samples')
        i = np.clip(np.floor(u).astype(int), 0, self.z.shape[1]-2)
        j = np.clip(np.floor(v).astype(int), 0, self.z.shape[0]-2)
        a, b = u-i, v-j
        z00, z10, z01, z11 = self.z[j, i], self.z[j, i+1], self.z[j+1, i], self.z[j+1, i+1]
        result=np.where(a >= b, z00+a*(z10-z00)+b*(z11-z10), z00+b*(z01-z00)+a*(z11-z01))
        return float(result) if result.ndim==0 else result

    def normals(self, x, y):
        # Shared source gradients, also on independently loaded tile edges.
        ex = np.clip(np.asarray(x)+2.5, self.origin[0], self.origin[0]+(self.z.shape[1]-1)*self.step)
        wx = np.clip(np.asarray(x)-2.5, self.origin[0], self.origin[0]+(self.z.shape[1]-1)*self.step)
        ny = np.clip(np.asarray(y)+2.5, self.origin[1], self.origin[1]+(self.z.shape[0]-1)*self.step)
        sy = np.clip(np.asarray(y)-2.5, self.origin[1], self.origin[1]+(self.z.shape[0]-1)*self.step)
        n = np.column_stack([-(self.height(ex,y)-self.height(wx,y))/(ex-wx),
                             -(self.height(x,ny)-self.height(x,sy))/(ny-sy), np.ones(np.size(x))])
        return n / np.linalg.norm(n, axis=1)[:, None]


def weld(positions, indices):
    p = np.asarray(positions, dtype='<f4').reshape(-1, 3)
    idx = np.asarray(indices, dtype='<u4').reshape(-1)
    # Float32 is the runtime contract; do not merge merely nearby source vertices.
    unique, inverse = np.unique(p, axis=0, return_inverse=True)
    return unique, inverse[idx].astype('<u4')


def curve_subdivide(positions, indices, maximum=40):
    """Keep planar source faces, adding vertices only for cylinder curvature."""
    positions=np.asarray(positions);indices=np.asarray(indices).reshape(-1,3)
    faces=positions[indices]
    large=np.ptp(faces[:,:,0],axis=1)>maximum
    if not large.any():return positions,indices.reshape(-1)
    result=list(faces[~large]);stack=list(faces[large])
    while stack:
        face=stack.pop();lengths=[abs(face[a,0]-face[b,0]) for a,b in [(0,1),(1,2),(2,0)]]
        edge=int(np.argmax(lengths))
        if lengths[edge]<=maximum:result.append(face);continue
        a,b,c=face[edge],face[(edge+1)%3],face[(edge+2)%3];mid=(a+b)/2
        stack.extend([np.array([a,mid,c]),np.array([mid,b,c])])
    p=np.asarray(result).reshape(-1,3)
    return weld(p,np.arange(len(p),dtype='<u4'))


def clip_mesh(positions, indices, bounds):
    """Clip and close an arbitrary triangulated solid at vertical band planes."""
    p, idx = np.asarray(positions), np.asarray(indices).reshape(-1,3)
    for axis, limit, sign in [(0,bounds[0],1),(0,bounds[2],-1),(1,bounds[1],1),(1,bounds[3],-1)]:
        d = sign*(p[:,axis]-limit)
        if d.min() >= -1e-8:
            continue
        triangles = []
        cuts = []
        other = [a for a in range(3) if a != axis]
        for face in p[idx]:
            result, crossings = [], []
            previous = face[-1]
            pd = sign*(previous[axis]-limit)
            for current in face:
                cd = sign*(current[axis]-limit)
                if (pd >= 0) != (cd >= 0):
                    crossing = previous+(current-previous)*(pd/(pd-cd))
                    crossing[axis] = limit
                    result.append(crossing); crossings.append(crossing)
                if cd >= 0:
                    result.append(current)
                previous, pd = current, cd
            for i in range(1,len(result)-1):
                triangles.append([result[0],result[i],result[i+1]])
            if len(crossings) == 2 and np.linalg.norm(crossings[0]-crossings[1]) > 1e-5:
                cuts.append(LineString([a[other] for a in crossings]))
        if not triangles:
            return np.empty((0,3),dtype='<f4'), np.empty(0,dtype='<u4')
        if cuts:
            # Millimetre snap closes independent source-face roundoff at the cut.
            lines = union_all([set_precision(line,.002) for line in cuts])
            sections = build_area(lines)
            for section in polygons(sections):
                for triangle in constrained_delaunay_triangles(section).geoms:
                    points = np.zeros((3,3)); points[:,axis] = limit
                    points[:,other] = np.asarray(triangle.exterior.coords)[:3]
                    if np.cross(points[1]-points[0],points[2]-points[0])[axis]*sign > 0:
                        points = points[::-1]
                    triangles.append(points)
        p = np.asarray(triangles).reshape(-1,3)
        idx = np.arange(len(p)).reshape(-1,3)
    return weld(p,idx)


def prism(shape, bottom, top):
    """Far volume follows the source footprint, including courtyard holes."""
    positions, indices = [], []
    for part in polygons(shape):
        part = orient(part, sign=1)
        for triangle in constrained_delaunay_triangles(part).geoms:
            start = len(positions)
            positions.extend([[x,y,top] for x,y in list(triangle.exterior.coords)[:3]])
            indices.extend([start,start+1,start+2])
        for ring in [part.exterior,*part.interiors]:
            for a,b in zip(ring.coords, list(ring.coords)[1:]):
                start = len(positions)
                positions.extend([[*a,bottom],[*b,bottom],[*b,top],[*a,top]])
                indices.extend([start,start+1,start+2,start,start+2,start+3])
    return weld(positions,indices)


def terrain_mesh(grid, bounds, step=5, boundary_step=5):
    """All LODs retain identical 5 m tile edges; coarser interiors meet them."""
    x0,y0,x1,y1 = bounds
    axis = lambda lo,hi,s: np.r_[lo,np.arange(math.floor(lo/s)*s+s,hi-1e-6,s),hi]
    xs,ys = axis(x0,x1,step),axis(y0,y1,step)
    vertices, indices, lookup = [], [], {}
    def vertex(x,y):
        key=(float(x),float(y))
        if key not in lookup:
            lookup[key]=len(vertices); vertices.append(key)
        return lookup[key]
    for j in range(len(ys)-1):
        for i in range(len(xs)-1):
            a,b,c,d = xs[i],ys[j],xs[i+1],ys[j+1]
            if step == boundary_step or (0<i<len(xs)-2 and 0<j<len(ys)-2):
                q = [vertex(a,b),vertex(c,b),vertex(c,d),vertex(a,d)]
                indices.extend(q[k] for k in [0,1,2,0,2,3])
            else:
                # Fan only boundary cells. Shared external edges exactly match
                # the fine mesh, so mixed LOD does not open cracks or need skirts.
                ring = []
                ring.extend((x,b) for x in (axis(a,c,boundary_step)[:-1] if j==0 else [a]))
                ring.extend((c,y) for y in (axis(b,d,boundary_step)[:-1] if i==len(xs)-2 else [b]))
                ring.extend((x,d) for x in (axis(a,c,boundary_step)[:0:-1] if j==len(ys)-2 else [c]))
                ring.extend((a,y) for y in (axis(b,d,boundary_step)[:0:-1] if i==0 else [d]))
                mid = vertex((a+c)/2,(b+d)/2)
                q = [vertex(x,y) for x,y in ring]
                for k in range(len(q)):
                    indices.extend([mid,q[k],q[(k+1)%len(q)]])
    xy = np.asarray(vertices)
    p = np.column_stack([xy,grid.height(*xy.T)])
    return dict(position=p.astype('<f4'),normal=grid.normals(*xy.T).astype('<f4'),index=np.asarray(indices,dtype='<u4'))


def merge(parts):
    parts = [p for p in parts if len(p['index'])]
    if not parts:
        return None
    keys = set(parts[0]) - {'index'}
    assert all(set(p)-{'index'}==keys for p in parts)
    count=0; indices=[]
    for p in parts:
        indices.append(p['index'].reshape(-1)+count);count+=len(p['position'])
    return {**{k:np.concatenate([p[k] for p in parts]).astype('<f4') for k in keys},
            'index':np.concatenate(indices).astype('<u4')}


def pack(meshes):
    arrays=[];offset=0;rows=[]
    for mesh in meshes:
        attributes={}
        for key,value in mesh['attributes'].items():
            value=np.asarray(value,dtype='<u4' if key=='index' else '<f4')
            attributes[key]=dict(type='u32' if key=='index' else 'f32',offset=offset,count=value.size)
            raw=value.tobytes();arrays.append(raw);offset+=len(raw)
        rows.append({**mesh,'attributes':attributes})
    header=json.dumps(dict(version=1,meshes=rows),separators=(',',':')).encode()
    return struct.pack('<I',len(header))+header+b'\0'*((-len(header))%4)+b''.join(arrays)


def save_tile(root, name, meshes):
    path=root/name;path.parent.mkdir(parents=True,exist_ok=True)
    raw=pack(meshes);compressed=gzip.compress(raw,compresslevel=5,mtime=0)
    temporary=path.with_suffix('.next');temporary.write_bytes(compressed);temporary.replace(path)
    return dict(path=name,bytes=len(compressed),decodedBytes=len(raw),sha256=hashlib.sha256(raw).hexdigest())
