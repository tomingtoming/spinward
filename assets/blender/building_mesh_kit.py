"""Native-metre facade surfaces shared by the cafe and office pilots.
Coordinates match Spinward: X across the frontage, Y up, Z towards the street.
"""
import bpy, math

def local(x,y,z): return (x,-z,y)
def facade(u,y,n,side):
 if side==0:return local(u,y,n)
 if side==1:return local(-u,y,-n)
 if side==2:return local(n,y,-u)
 return local(-n,y,u)
def atlas_uv(u,y,side,w,d,h):
 span=w if side<2 else d
 return ((side+(u/span+.5)*.984+.008)/4,.004+y/h*.992)

class MeshBuilder:
 def __init__(self,scene,name,materials):
  self.scene,self.name,self.materials=scene,name,materials
  self.vertices=[];self.faces=[];self.indices=[];self.uvs=[]
 def face(self,points,material,uvs=None):
  n=len(self.vertices);self.vertices.extend(points);self.faces.append(tuple(range(n,n+len(points))))
  self.indices.append(self.materials.index(material));self.uvs.append(uvs or [(0,0)]*len(points))
 def box(self,x,y,z,w,h,d,material):
  pts=[local(x+sx*w/2,y+sy*h/2,z+sz*d/2) for sx,sy,sz in [(-1,-1,-1),(1,-1,-1),(1,1,-1),(-1,1,-1),(-1,-1,1),(1,-1,1),(1,1,1),(-1,1,1)]]
  for face in [(0,3,2,1),(4,5,6,7),(0,1,5,4),(1,2,6,5),(2,3,7,6),(3,0,4,7)]:self.face([pts[i] for i in face],material)
 def finish(self):
  me=bpy.data.meshes.new(self.name+'_mesh');me.from_pydata(self.vertices,[],self.faces);me.update()
  o=bpy.data.objects.new(self.name,me);self.scene.collection.objects.link(o)
  for m in self.materials:me.materials.append(m)
  layer=me.uv_layers.new(name='UVMap')
  for p,material,coords in zip(me.polygons,self.indices,self.uvs):
   p.material_index=material
   for i,uv in zip(p.loop_indices,coords):layer.data[i].uv=uv
  me.calc_loop_triangles();return o

def detailed_facade(builder,w,d,h,stone,reveal,glass,lit,trim,baked=False,office=False,mullions=False):
 """Continuous wall bands, recessed panes and closed wedge sills.
 No ray-based culling: topology follows known surfaces and occupied wall volumes.
 """
 floors=max(1,round((h-4.2)/3.35));fh=(h-4.2)/floors
 for side in range(4):
  span=w if side<2 else d;depth=d/2 if side<2 else w/2
  bays=max(3,round(span/3.2));pitch=span/bays;ww=pitch*(.76 if office else .64);wh=fh*.54
  def face(points,material):
   if material is None:return
   builder.face([facade(u,y,n,side) for u,y,n in points],material,[atlas_uv(u,y,side,w,d,h) for u,y,n in points])
  def quad(x0,x1,y0,y1,n,material):face([(x0,y0,n),(x1,y0,n),(x1,y1,n),(x0,y1,n)],material)
  # Long horizontal bands become chords after cylinder wrapping. Use narrow
  # vertical piers and per-window spandrels so every horizontal edge has a
  # short angular span; long vertical edges remain linear on the cylinder.
  previous=-span/2
  for col in range(bays):
   u=-span/2+(col+.5)*pitch;left=u-ww/2;right=u+ww/2
   quad(previous,left,4.2,h,depth,stone);previous=right
   last=4.2
   for row in range(floors):
    wy=4.2+row*fh+fh*.49;lo=wy-wh/2;hi=wy+wh/2
    quad(left,right,last,lo,depth,stone);last=hi
   quad(left,right,last,h,depth,stone)
  quad(previous,span/2,4.2,h,depth,stone)
  for row in range(floors):
   bottom=4.2+row*fh;wy=bottom+fh*.49;lo=wy-wh/2;hi=wy+wh/2
   for col in range(bays):
    u=-span/2+(col+.5)*pitch;left=u-ww/2;right=u+ww/2
    for ps in [[(left,lo,depth),(left,lo,depth-.19),(left,hi,depth-.19),(left,hi,depth)],[(right,lo,depth-.19),(right,lo,depth),(right,hi,depth),(right,hi,depth-.19)],[(left,lo,depth-.19),(left,lo,depth),(right,lo,depth),(right,lo,depth-.19)],[(left,hi,depth),(left,hi,depth-.19),(right,hi,depth-.19),(right,hi,depth)]]:face(ps,reveal)
    pane=lit if (row*11+col*7+side*13)%9<3 else glass
    quad(left,right,lo,hi,depth-.19,pane)
    if not baked or mullions:quad(u-.0175,u+.0175,lo,hi,depth-.105,trim)
    # A closed triangular sill profile: projecting top/front, sloped underside,
    # and two end triangles. Its back meets the opaque wall, not empty space.
    a,b=left-.04,right+.04;outer=depth-.005 if office else depth+.065
    A=(lo+.0425,depth-.08 if office else depth-.01);B=(lo+.0425,outer);C=(lo-.0425,outer)
    for p,q in [(A,B),(B,C),(C,A)]:face([(a,*p),(b,*p),(b,*q),(a,*q)],stone)
    face([(a,*A),(a,*C),(a,*B)],stone);face([(b,*A),(b,*B),(b,*C)],stone)

def join(scene,name,objects):
 for o in list(bpy.context.selected_objects):o.select_set(False)
 for o in objects:o.hide_set(False);o.select_set(True)
 bpy.context.view_layer.objects.active=objects[0];bpy.ops.object.join();o=bpy.context.object;o.name=name;o.data.calc_loop_triangles();return o

def export(scene,objects,path):
 for o in list(bpy.context.selected_objects):o.select_set(False)
 for o in objects:o.hide_set(False);o.hide_render=False;o.select_set(True)
 bpy.context.view_layer.objects.active=objects[0]
 bpy.ops.export_scene.gltf(filepath=str(path),export_format='GLB',use_selection=True,use_active_scene=True,export_yup=True,export_materials='EXPORT',export_cameras=False,export_lights=False)
