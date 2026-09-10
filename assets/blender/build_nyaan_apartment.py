"""Nyaan-inspired compact apartment. Contract dimensions are original Spinward staging."""
import bpy,math,json,sys,importlib
from pathlib import Path
sys.dont_write_bytecode=True
ROOT=Path(__file__).resolve().parents[2];sys.path.insert(0,str(ROOT/'assets/blender'))
import building_mesh_kit;importlib.reload(building_mesh_kit)
from building_mesh_kit import MeshBuilder,local,join,export
C=json.loads((ROOT/'assets/blender/nyaan-apartment.json').read_text());I=C['interior'];W,D,H=I['frontage'],I['depth'],I['building']['height'];F=D/2
scene=bpy.data.scenes.get('Spinward Nyaan Apartment') or bpy.data.scenes.new('Spinward Nyaan Apartment');bpy.context.window.scene=scene
scene.unit_settings.system='METRIC';scene.unit_settings.scale_length=1
for o in list(scene.objects):bpy.data.objects.remove(o,do_unlink=True)
def mat(name,h,rough=.8,emit=.04,alpha=1):
 m=bpy.data.materials.get('SWNY_'+name) or bpy.data.materials.new('SWNY_'+name);m.use_nodes=True
 c=[int(h[j:j+2],16)/255 for j in (0,2,4)];c=tuple(v/12.92 if v<=.04045 else ((v+.055)/1.055)**2.4 for v in c)+(alpha,)
 p=m.node_tree.nodes.get('Principled BSDF');p.inputs['Base Color'].default_value=c;p.inputs['Roughness'].default_value=rough;p.inputs['Emission Color'].default_value=c;p.inputs['Emission Strength'].default_value=emit;p.inputs['Alpha'].default_value=alpha
 if alpha<1:m.surface_render_method='DITHERED'
 return m
plaster=mat('plaster','b3b3a8');concrete=mat('concrete','8c9189');wood=mat('wood','7e644e');fabric=mat('fabric','8f9f9d');metal=mat('metal','4d6662',.5);glass=mat('glass','a4b9b3',.28,.02,.16);upper=mat('upper','9c9e94');light=mat('LIGHT','eee2b7',.4,.8);dark=mat('dark','293c3e');ivory=mat('ivory','d6d2ba',.5);red=mat('red','964f47');blue=mat('blue','4d7386');paper=mat('paper','d5c5a3');tile=mat('tile','cad0c2',.42);rust=mat('rust','857262')
mats=[plaster,concrete,wood,fabric,metal,glass,upper,light,dark,ivory,red,blue,paper,tile,rust];palette=dict(plaster=plaster,concrete=concrete,wood=wood,fabric=fabric,metal=metal,glass=glass,upper=upper,light=light,sign=dark)
font=bpy.data.fonts.load('/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc',check_existing=True)
def text(parts,body,x,y,z,size,material=ivory,side=0,jp=False):
 c=bpy.data.curves.new('SWNY_text','FONT');c.body=body;c.align_x='CENTER';c.align_y='CENTER';c.size=size;c.resolution_u=2
 if jp:c.font=font
 o=bpy.data.objects.new('SWNY_text',c);scene.collection.objects.link(o);o.location=local(x,y,z);o.rotation_euler=(math.pi/2,0,side*math.pi/2);c.materials.append(material)
 for a in list(bpy.context.selected_objects):a.select_set(False)
 o.select_set(True);bpy.context.view_layer.objects.active=o;bpy.ops.object.convert(target='MESH');parts.append(o)
def disk(b,x,y,z,r,material,n=16,side=0):
 for j in range(n):
  a=j*math.tau/n;c=(j+1)*math.tau/n
  p=[(0,0),(r*math.cos(a),r*math.sin(a)),(r*math.cos(c),r*math.sin(c))]
  b.face([local(x+(u if not side else 0),y+v,z+(u if side else 0)) for u,v in p],material)
def cylinder(b,x,y,z,r,h,material,n=16):
 for j in range(n):
  a=j*math.tau/n;c=(j+1)*math.tau/n
  b.face([local(x+r*math.cos(a),y,z+r*math.sin(a)),local(x+r*math.cos(c),y,z+r*math.sin(c)),local(x+r*math.cos(c),y+h,z+r*math.sin(c)),local(x+r*math.cos(a),y+h,z+r*math.sin(a))],material)
 b.face([local(x+r*math.cos(j*math.tau/n),y+h,z+r*math.sin(j*math.tau/n)) for j in reversed(range(n))],material)
def rounded_box(parts,x,y,z,w,h,d,material,radius):
 builder=MeshBuilder(scene,'soft_form',mats);builder.box(x,y,z,w,h,d,material);o=builder.finish()
 import bmesh
 bm=bmesh.new();bm.from_mesh(o.data);bmesh.ops.remove_doubles(bm,verts=list(bm.verts),dist=.00001);bm.to_mesh(o.data);bm.free()
 for selected in list(bpy.context.selected_objects):selected.select_set(False)
 o.select_set(True);bpy.context.view_layer.objects.active=o
 modifier=o.modifiers.new('Soft edges','BEVEL');modifier.width=radius;modifier.segments=3
 bpy.ops.object.modifier_apply(modifier=modifier.name);parts.append(o)
models=[];audit=[]
for lod in [0,1,2]:
 b=MeshBuilder(scene,'nyaan',mats);parts=[]
 for p in I['parts']:
  if lod>0 and p['detail']<2:continue
  if p['name'] in ['bookshelf','toilet'] and lod==0:continue
  if p['name']=='mattress' and lod==0:
   rounded_box(parts,p['x'],p['y'],p['z'],p['width'],p['height'],p['depth'],fabric,.045);continue
  b.box(p['x'],p['y'],p['z'],p['width'],p['height'],p['depth'],palette[p['finish']])
 # Cornices and slightly projecting window frames establish an older apartment block.
 for row in range(3):
  y=4.8+row*3.1
  for side in range(4):
   span=W if side<2 else D;n=(D if side<2 else W)/2
   bays=2 if side<2 else 6
   for j in range(bays):
    u=-span/2+(j+.5)*span/bays;ww=1.72 if side<2 else 1.40;hh=1.48
    def box(u,y,n,w,h,d,ma):
     if side==0:b.box(u,y,n,w,h,d,ma)
     elif side==1:b.box(-u,y,-n,w,h,d,ma)
     elif side==2:b.box(n,y,-u,d,h,w,ma)
     else:b.box(-n,y,u,d,h,w,ma)
    def plane(u,y,n,w,h,ma):
     points=[(u-w/2,y-h/2),(u+w/2,y-h/2),(u+w/2,y+h/2),(u-w/2,y+h/2)]
     def position(a,c):
      return local(a,c,n) if side==0 else local(-a,c,-n) if side==1 else local(n,c,-a) if side==2 else local(-n,c,a)
     b.face([position(a,c) for a,c in points],ma)
    if lod==0:
     box(u,y,n+.008,ww,hh,.012,dark)
     box(u-.03,y+.02,n+.018,ww-.12,hh-.12,.014,blue if (j+row)%4 else ivory)
     for dx in [-ww/2,0,ww/2]:box(u+dx,y,n+.035,.065,hh+.10,.075,metal)
     for dy in [-hh/2,hh/2]:box(u,y+dy,n+.035,ww+.10,.065,.075,metal)
    else:
     plane(u,y,n+.008,ww,hh,metal)
     plane(u,y,n+.010,ww-.12,hh-.12,blue if (j+row)%4 else ivory)
     if lod==1:plane(u,y,n+.012,.065,hh,metal)
    if lod==0:
     box(u,y-hh/2-.07,n+.07,ww+.23,.09,.22,concrete)
     box(u,y+hh/2+.18,n+.018,ww+.10,.045,.025,rust)
     if side==0:
      box(u,y-.43,n+.23,ww+.20,.055,.04,metal)
      for k in range(7):box(u-ww/2+k*ww/6,y-.67,n+.23,.025,.50,.025,metal)
  for side in [-1,1]:
   b.box(0,y-1.4,side*(F+.015),W,.10,.05,concrete)
   b.box(side*(W/2+.015),y-1.4,0,.05,.10,D,concrete)
 for side in [-1,1]:
  b.box(side*(W/2-.12),H+.15,0,.24,.3,D,concrete)
  b.box(0,H+.15,side*(F-.12),W-.48,.3,.24,concrete)
 b.box(0,2.66,F-.32,2.20,.12,.9,metal)
 b.box(0,2.59,F-.31,1.8,.035,.65,light)
 b.box(0,3.00,F+.012,1.70,.36,.035,dark)
 if lod<2:text(parts,'APARTMENTS',0,3.00,F+.037,.17)
 # Ground floor window trim and a narrow shared entry.
 wx=(-W/2-1)/2
 for dx in [-1.175,0,1.175]:b.box(wx+dx,1.72,F-.055,.055,1.69,.07,metal)
 for y in [.90,2.54]:b.box(wx,y,F-.055,2.40,.055,.07,metal)
 if lod==0:
  # Front wear/patches, pipes and a small mail/intercom panel.
  for x in [-W/2+.34,W/2-.30]:
   b.box(x,H/2,F+.085,.065,H,.065,metal)
   for y in [1.2,4.1,7.2,10.3,13.2]:b.box(x,y,F+.11,.15,.04,.045,rust)
  for j in range(9):b.box(-W/2+.5+j*.36,.40+.09*(j%3),F+.012,.24,.025,.009,rust)
  b.box(.96,1.50,F+.015,.26,.43,.045,metal);disk(b,.96,1.45,F+.042,.035,ivory,12)
  for row in range(3):
   b.box(.86,1.18+row*.28,F-1.12,.08,.22,.60,metal)
   b.box(.808,1.22+row*.28,F-1.12,.01,.023,.40,dark)
  # Door 101 is open; other ground-floor doors remain closed.
  dz=C['room']['doorZ']
  for z in [dz-.62,dz+.62]:b.box(-.88,1.28,z,.10,2.55,.07,metal)
  b.box(-.88,2.57,dz,.10,.07,1.31,metal)
  b.box(-.892,1.68,dz-1.02,.025,.36,.58,dark)
  text(parts,'101',-.873,1.74,dz-1.02,.12,ivory,1)
  text(parts,'ニャアン',-.871,1.57,dz-1.02,.12,ivory,1,True)
  for j in range(4):
   z=F-3.7-j*5.2
   b.box(.97,1.34,z,.025,2.20,1.02,wood)
   b.box(.95,1.35,z-.34,.035,.10,.06,metal)
   text(parts,str(102+j*2),.94,1.87,z,.12,ivory,-1)
  # A low bed, folded bedding and pillow; no floor clutter in the clear aisle.
  bx=-W/2+.88;b.box(bx,.67,F-2.20,1.00,.08,.63,blue)
  rounded_box(parts,bx,.72,F-.91,.74,.18,.37,ivory,.065)
  for j in range(5):b.box(bx-.4+j*.20,.717,F-2.20,.014,.005,.59,fabric)
  b.box(-2.63,.283,F-3.68,1.23,.018,1.72,fabric)
  # Cup and paper on the low table, notebook/pencil at the window desk.
  cylinder(b,-2.45,.685,F-3.63,.052,.09,ivory);cylinder(b,-2.45,.776,F-3.63,.042,.001,dark)
  b.box(-2.79,.692,F-3.64,.23,.018,.29,paper)
  b.box(-1.92,1.065,F-.56,.42,.02,.31,red);b.box(-1.92,1.079,F-.56,.38,.008,.28,paper)
  b.box(-1.61,1.06,F-.53,.016,.012,.22,metal)
  # Bookcase opens toward the room (+X), with ordinary paperbacks and study books.
  sx=-W/2+.39;sz=F-3.73
  b.box(sx-.17,.92,sz,.035,1.34,1.05,wood)
  for z in [sz-.5,sz+.5]:b.box(sx,.92,z,.38,1.34,.055,wood)
  for y in [.27,.69,1.11,1.55]:b.box(sx,y,sz,.38,.045,1.05,wood)
  for row in range(3):
   for j in range(8):
    z=sz-.42+j*.115;y=.31+row*.42;h=.25+.025*((j+row)%3)
    if row==2 and j in [1,4]:h=.31
    b.box(sx+.025,y+h/2,z,.26,h,.083,red if row==2 and j in [1,4] else [paper,red,blue,ivory][(j+row)%4])
  text(parts,'ジ\nオ\nン\n工\n科\n大\n学',sx+.159,1.32,sz-.305,.038,ivory,1,True)
  text(parts,'永\n住\n許\n可\n申\n請',sx+.159,1.32,sz+.04,.038,ivory,1,True)
  # Calendar and sale slips sit on the side wall. Text is original dressing.
  px=-W/2+.248
  b.box(px,1.96,F-4.28,.012,.60,.46,paper)
  text(parts,'09',px+.008,2.14,F-4.28,.10,dark,1)
  for row in range(4):
   for col in range(7):b.box(px+.010,2.01-row*.078,F-4.45+col*.055,.004,.032,.031,red if col==6 else concrete)
  for j in range(3):
   z=F-3.40+j*.28;b.box(px,1.98,z,.012,.31,.23,paper if j%2 else ivory)
   text(parts,['SALE','FOOD','DAILY'][j],px+.01,2.05,z,.048,red,1)
   text(parts,['-20%','2 FOR 1','-10%'][j],px+.01,1.93,z,.050,dark,1)
  # Compact kitchenette with a sink, hob and a kettle.
  b.box(-1.64,1.123,F-6.88,1.07,.045,.57,metal)
  b.box(-1.90,1.151,F-6.88,.40,.012,.34,dark)
  for x in [-2.11,-1.69]:b.box(x,1.17,F-6.88,.022,.035,.38,ivory)
  for z in [F-7.06,F-6.70]:b.box(-1.9,1.17,z,.44,.035,.022,ivory)
  b.box(-1.94,1.30,F-7.09,.025,.25,.025,metal);b.box(-1.94,1.42,F-7.01,.025,.025,.18,metal)
  cylinder(b,-1.36,1.15,F-6.90,.11,.015,dark)
  cylinder(b,-1.36,1.17,F-6.90,.075,.14,ivory)
  b.box(-1.42,.75,F-5.633,.46,.02,.02,metal);b.box(-1.22,.94,F-5.62,.03,.30,.035,metal)
  # Bathroom tub has a recessed visual basin over its simple solid volume.
  tx=-W/2+.93;tz=F-6.64
  b.box(tx,.719,tz,1.12,.01,.49,dark)
  for x in [tx-.62,tx+.62]:b.box(x,.76,tz,.12,.10,.69,tile)
  for z in [tz-.29,tz+.29]:b.box(tx,.76,z,1.2,.10,.11,tile)
  b.box(-W/2+.28,1.55,F-6.65,.035,1.48,.035,metal)
  b.box(-W/2+.40,2.28,F-6.65,.26,.035,.035,metal)
  b.box(-W/2+.43,1.39,F-5.16,.025,.45,.43,metal)
  for z in [F-5.43,F-4.95]:b.box(-W/2+.46,1.39,z,.04,.50,.025,ivory)
  # Recessed basin and tap distinguish the washstand from a plain shelf.
  sinkX=-W/2+.43;sinkZ=F-5.20
  b.box(sinkX,1.041,sinkZ,.34,.009,.26,dark)
  for x in [sinkX-.215,sinkX+.215]:b.box(x,1.055,sinkZ,.05,.04,.40,tile)
  for z in [sinkZ-.175,sinkZ+.175]:b.box(sinkX,1.055,z,.44,.04,.05,tile)
  b.box(sinkX-.19,1.16,sinkZ,.025,.19,.025,metal)
  b.box(sinkX-.12,1.25,sinkZ,.16,.025,.025,metal)
  cylinder(b,-3.0,.265,F-5.14,.18,.34,tile)
  rounded_box(parts,-3.0,.64,F-5.16,.44,.13,.52,tile,.06)
  b.box(-3.0,.712,F-5.17,.26,.008,.29,dark)
  rounded_box(parts,-3.0,.86,F-4.90,.43,.36,.15,tile,.025)
  b.box(-3.0,1.048,F-4.90,.12,.02,.04,metal)
  # Small towel over the bathroom partition and a bag kept against the bed wall.
  b.box(-W/2+2.055,1.25,F-5.23,.028,.46,.32,fabric)
  b.box(-W/2+2.06,1.49,F-5.23,.065,.025,.37,metal)
  b.box(-W/2+.54,.46,F-4.64,.43,.40,.30,blue)
  for z in [F-4.78,F-4.50]:b.box(-W/2+.54,.70,z,.24,.045,.018,dark)
  # An exposed conduit reinforces the modest room's scale.
  b.box(-W/2+.26,2.91,F-3.5,.025,.025,6.7,metal)
  b.box(-W/2+.26,2.10,F-4.94,.025,1.62,.025,metal)
 model=join(scene,f'nyaan_runtime_lod{lod}',[b.finish(),*parts]);models.append(model)
 audit.append({'name':model.name,'triangles':len(model.data.loop_triangles),'materials':len(set(p.material_index for p in model.data.polygons))})
path=ROOT/'public/assets/buildings/nyaan-apartment.glb';export(scene,models,path)
bpy.data.libraries.write(str(ROOT/'assets/blender/nyaan-apartment.blend'),{scene},fake_user=True,compress=True)
report={'bytes':path.stat().st_size,'models':audit,'room':'Compact ground-floor 101; inferred layout and exterior, not a measured set reconstruction','collision':'Contract solid parts, shared entry and open room doorway; other units remain closed'}
(ROOT/'assets/blender/nyaan-apartment-audit.json').write_text(json.dumps(report,indent=2)+'\n');print(json.dumps(report))
