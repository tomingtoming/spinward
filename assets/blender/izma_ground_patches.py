"""Split small lot surfaces at the saved terrain's actual triangle boundaries.

Sampling only a paving rectangle's corners can bridge a terrain ridge and put
the drawn paving below the physical ground. Preserve each ridge in the mesh;
Each piece carries radial heights from its own saved terrain triangle. A
second BVH lookup at a shared edge can miss through floating-point cracks.
"""
import math


def area(polygon):
    return sum(a[0]*b[1]-b[0]*a[1] for a,b in zip(polygon,polygon[1:]+polygon[:1]))/2


def clip(subject, boundary):
    for a,b in zip(boundary,boundary[1:]+boundary[:1]):
        result=[]
        for p,q in zip(subject,subject[1:]+subject[:1]):
            dp=(b[0]-a[0])*(p[1]-a[1])-(b[1]-a[1])*(p[0]-a[0])
            dq=(b[0]-a[0])*(q[1]-a[1])-(b[1]-a[1])*(q[0]-a[0])
            if dp>=-1e-7:result.append(p)
            if (dp>1e-7 and dq < -1e-7) or (dp < -1e-7 and dq>1e-7):
                t=dp/(dp-dq);result.append(tuple(p[k]+(q[k]-p[k])*t for k in range(2)))
        subject=result
        if len(subject)<3:return []
    return subject if abs(area(subject))>1e-6 else []


class GroundPatches:
    def __init__(self, base):
        self.triangles=[];self.planes=[];self.cells={};pool=base['vertices'];ids=base['meshes']['earth']
        for i in range(0,len(ids),3):
            corners=[pool[k*3:k*3+3] for k in ids[i:i+3]]
            polygon=[p[:2] for p in corners]
            radial=[((3200-h)*math.cos(x/3200),y,(3200-h)*math.sin(x/3200)) for x,y,h in corners]
            a,b,c=radial;u=[b[k]-a[k] for k in range(3)];v=[c[k]-a[k] for k in range(3)]
            normal=(u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0])
            self.planes.append((normal,sum(normal[k]*a[k] for k in range(3))))
            if area(polygon)<0:polygon.reverse()
            index=len(self.triangles);self.triangles.append(polygon)
            for key in self.keys(polygon):self.cells.setdefault(key,[]).append(index)

    @staticmethod
    def keys(polygon):
        for x in range(math.floor(min(p[0] for p in polygon)/128),math.floor(max(p[0] for p in polygon)/128)+1):
            for y in range(math.floor(min(p[1] for p in polygon)/128),math.floor(max(p[1] for p in polygon)/128)+1):
                yield x,y

    def split(self, polygon):
        indices={i for key in self.keys(polygon) for i in self.cells.get(key,[])}
        for i in sorted(indices):
            piece=clip(polygon,self.triangles[i])
            if piece:
                normal,d=self.planes[i]
                yield [(x,y,3200-(d-normal[1]*y)/(normal[0]*math.cos(x/3200)+normal[2]*math.sin(x/3200))) for x,y in piece]
