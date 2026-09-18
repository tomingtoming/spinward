"""Native building mesh writer shared by placement and facade revisions."""
import math

class BuildingMeshBuilder:
    def __init__(self, scene, materials, existing=None):
        self.scene=scene;self.materials=materials;self.existing=existing
        self.v=[];self.f=[];self.m=[];self.g=[]
    def face(self,points,mat,floor=False):
        n=len(self.v);self.v.extend(points);self.f.append(tuple(range(n,n+len(points))));self.m.append(mat)
        self.g.append(floor)
    def quad(self,a,b,c,d,mat,floor=False):
        # At R=3200, a 12 m chord sags less than 6 mm. Share that
        # tessellation between drawing and collision instead of over-sampling roofs.
        count=max(1,math.ceil(max(math.dist(a,b),math.dist(c,d))/12))
        for i in range(count):
            def lerp(p,q,t):return tuple(p[k]+(q[k]-p[k])*t for k in range(3))
            self.face([lerp(a,b,i/count),lerp(a,b,(i+1)/count),lerp(d,c,(i+1)/count),lerp(d,c,i/count)],mat,floor)
    def box(self,x,y,z,w,d,h,mat,roof=False,cap=True,back=True):
        if min(w,d,h)<=0:return
        a,b=x-w/2,x+w/2;c,e=y-d/2,y+d/2;t=z+h
        self.quad((a,c,z),(b,c,z),(b,c,t),(a,c,t),mat)
        if back:self.quad((b,e,z),(a,e,z),(a,e,t),(b,e,t),mat)
        self.quad((a,e,z),(a,c,z),(a,c,t),(a,e,t),mat)
        self.quad((b,c,z),(b,e,z),(b,e,t),(b,c,t),mat)
        if not cap:return
        # Cross-split the top so a large pad follows the same mesh in all uses.
        rows=max(1,math.ceil(d/12))
        for i in range(rows):
            y0=c+d*i/rows;y1=c+d*(i+1)/rows
            self.quad((a,y0,t),(b,y0,t),(b,y1,t),(a,y1,t),mat,roof)
    def gable(self,x,y,z,w,d,h,mat):
        a,b=x-w/2,x+w/2;c,e=y-d/2,y+d/2
        rows=max(1,math.ceil(d/12))
        for i in range(rows):
            y0=c+d*i/rows;y1=c+d*(i+1)/rows
            self.quad((a,y0,z),(x,y0,z+h),(x,y1,z+h),(a,y1,z),mat,True)
            self.quad((x,y0,z+h),(b,y0,z),(b,y1,z),(x,y1,z+h),mat,True)
        self.face([(a,c,z),(b,c,z),(x,c,z+h)],mat)
        self.face([(b,e,z),(a,e,z),(x,e,z+h)],mat)
    def finish(self,name,parcel,lod):
        import bpy
        # Share exact native positions; shading stays flat per polygon. This
        # avoids storing a fresh copy of every corner for each adjacent face.
        vertices=[];lookup={};faces=[]
        for face in self.f:
            indices=[]
            for i in face:
                point=tuple(self.v[i])
                if point not in lookup:lookup[point]=len(vertices);vertices.append(point)
                indices.append(lookup[point])
            faces.append(indices)
        data=bpy.data.meshes.new(name);data.from_pydata(vertices,[],faces);data.update()
        used=sorted(set(self.m))
        for material in used:data.materials.append(self.materials[material])
        lookup={m:i for i,m in enumerate(used)}
        for p,m in zip(data.polygons,self.m):p.material_index=lookup[m]
        ground_faces=data.attributes.new('ground_surface','BOOLEAN','FACE')
        for value,flag in zip(ground_faces.data,self.g):value.value=flag
        obj=self.existing.get(name) if self.existing is not None else None
        if obj is None:
            obj=bpy.data.objects.new(name,data);self.scene.collection.objects.link(obj)
        else:
            old=obj.data;obj.data=data
            if old.users==0:bpy.data.meshes.remove(old)
            data.name=name
        obj.location=(parcel['position'][1],-parcel['position'][0],parcel['floor'])
        obj.rotation_euler.z=parcel['yaw']-math.pi/2
        obj['parcel_id']=parcel['id'];obj['lod']=lod;obj['district']=parcel['district']
        obj['family']=parcel['family'];obj.hide_render=lod==1
        return obj
