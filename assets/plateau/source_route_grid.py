"""Road-grid edges are actual clear line segments, not just clear endpoints."""
import heapq,math
from collections import deque
import numpy as np
from shapely import covers,linestrings,prepare

OFFSETS=[(1,0),(-1,0),(0,1),(0,-1),(1,1),(-1,-1),(-1,1),(1,-1)]


def edges_for(domain,mask,xs,ys):
    prepare(domain);rows,cols=mask.shape;edges=np.zeros_like(mask,dtype=np.uint8)
    for direction in [0,2,4,6]:
        dx,dy=OFFSETS[direction];i0=max(0,-dx);i1=min(cols,cols-dx);j0=max(0,-dy);j1=min(rows,rows-dy)
        valid=mask[j0:j1,i0:i1]&mask[j0+dy:j1+dy,i0+dx:i1+dx];j,i=np.nonzero(valid);j+=j0;i+=i0
        for first in range(0,len(i),30000):
            ii=i[first:first+30000];jj=j[first:first+30000]
            segments=np.stack([np.column_stack([xs[ii],ys[jj]]),np.column_stack([xs[ii+dx],ys[jj+dy]])],axis=1)
            allowed=covers(domain,linestrings(segments));a=ii[allowed];b=jj[allowed]
            edges[b,a]|=1<<direction;edges[b+dy,a+dx]|=1<<(direction+1)
    return edges


def connected(edges,start):
    seen=np.zeros_like(edges,dtype=bool);queue=deque([start]);seen[start[1],start[0]]=True
    while queue:
        i,j=queue.popleft();bits=int(edges[j,i])
        for bit,(dx,dy) in enumerate(OFFSETS):
            if bits&(1<<bit) and not seen[j+dy,i+dx]:seen[j+dy,i+dx]=True;queue.append((i+dx,j+dy))
    return seen


def astar(edges,start,end,step):
    rows,cols=edges.shape;total=rows*cols;cost=np.full(total,np.inf);previous=np.full(total,-1,dtype=np.int32);closed=np.zeros(total,dtype=bool)
    a=start[1]*cols+start[0];goal=end[1]*cols+end[0];cost[a]=0;queue=[(0.,a)]
    while queue:
        _,a=heapq.heappop(queue)
        if closed[a]:continue
        if a==goal:break
        closed[a]=True;x=a%cols;y=a//cols;bits=int(edges[y,x])
        for bit,(dx,dy) in enumerate(OFFSETS):
            if not bits&(1<<bit):continue
            nx=x+dx;ny=y+dy;b=ny*cols+nx;candidate=cost[a]+step*(math.sqrt(2) if dx and dy else 1)
            if candidate>=cost[b]:continue
            cost[b]=candidate;previous[b]=a;heapq.heappush(queue,(candidate+math.hypot(nx-end[0],ny-end[1])*step,b))
    if goal!=start[1]*cols+start[0] and previous[goal]<0:raise ValueError(f'No connected public route {start} -> {end}')
    out=[];a=goal
    while a>=0:out.append((a%cols,a//cols));a=int(previous[a])
    return out[::-1]
