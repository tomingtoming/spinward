"""Authored street finish: useful frontages, bounded night lighting, public edges.

Runs in the landscape recipe namespace. All geometry remains editable in the
blend; the runtime only wraps/exported meshes and selects nearby lamp lights.
"""


def finish_materials(scene):
    extra={
        'window_off':'#425359','window_warm':'#82908b','window_neutral':'#829096',
        'window_cool':'#7d909d','office_glass':'#88999f','shop_glass':'#758b8a','lamp_glass':'#dbc59a',
        'frame':'#5c6564','concrete':'#a9a79e','masonry':'#94978b',
        'red_brick':'#967461','navy':'#4d5c65','terracotta':'#a58672',
        'garden_leaf':'#667b50','leaf_light':'#718257','leaf_dark':'#425d48',
        'produce':'#8a9b64','paper':'#c9bd9f','drain_slot':'#363f3d'
    }
    for key,colour in extra.items():
        mat=bpy.data.materials.get('SWL_'+key) or bpy.data.materials.new('SWL_'+key)
        rgb=[int(colour[i:i+2],16)/255 for i in (1,3,5)]
        mat.diffuse_color=(*rgb,1);mat['srgb']=colour
    groups={'grass':['earth'],'asphalt':['road'],'paving':['walk'],
            'stone':['stone','masonry'],'plaster':['cream','wall','plaster','ochre','concrete'],
            'brick':['red_brick','brick'],'roof':['tile','roof'],'wood':['timber','trunk'],'water':['water']}
    details={name:{'surface':kind} for kind,names in groups.items() for name in names}
    for key,color,intensity in [('window_warm','#ffd5a0',.6),('window_neutral','#f0efe0',.48),
                                ('window_cool','#d9eaff',.52),('office_glass','#d9eaff',.52),
                                ('shop_glass','#f9dfba',.06),('lamp_glass','#ffe0ac',1.6)]:
        details[key]={'emission':{'color':color,'intensity':intensity}}
    for key in ['window_warm','window_neutral','window_cool']:details[key]['surface']='curtain'
    details['office_glass']['surface']='blinds';details['shop_glass']['opacity']=.32
    scene['materialDetails']=json.dumps(details)


def recolour(obj, key):
    obj['material']=key;obj.data.materials.clear();obj.data.materials.append(bpy.data.materials['SWL_'+key])


def light_source(scene,name,x,y,z,color='#ffe0ac',intensity=65,distance=18):
    data=bpy.data.lights.new(name,'POINT');data.energy=intensity
    data.color=[int(color[i:i+2],16)/255 for i in (1,3,5)]
    obj=bpy.data.objects.new(name,data);scene.collection.objects.link(obj);obj.location=(x,y,z)
    obj['landscape_light']=True;obj['light_color']=color
    obj['light_intensity']=intensity;obj['light_distance']=distance


def pane(scene,name,x,y,z,w,h,yaw,material,lod=-1):
    obj=mesh(scene,name,[(-w/2,0,0),(w/2,0,0),(w/2,0,h),(-w/2,0,h)],[(0,1,2,3)],material,lod)
    obj.location=(x,y,z);obj.rotation_euler.z=yaw
    return obj


def facade_window(scene,name,x,y,z,u,v,w,h,yaw,material,trim=True):
    c,s=math.cos(yaw),math.sin(yaw)
    px,py=x+c*u-s*v,y+s*u+c*v
    pane(scene,name,px,py,z,w,h,yaw,material)
    if not trim:return
    for side in [-1,1]:
        local_box(scene,name+'_jamb',x,y,z,.07,.1,h,'frame',yaw,(u+side*w/2,v-.025),False,0)
        local_box(scene,name+'_lintel',x,y,z+(h if side>0 else -.07),w+.13,.1,.07,'frame',yaw,(u,v-.025),False,0)
    local_box(scene,name+'_mullion',x,y,z,.05,.08,h,'frame',yaw,(u,v-.04),False,0)
    local_box(scene,name+'_reveal',x,y,z-.12,w+.24,.22,.12,'concrete',yaw,(u,v+.04),False,0)


def roof_prism(scene,name,x,y,z,w,d,rise,yaw,material='tile',hip=False):
    ridge=d*.24 if hip else 0
    vs=[(-w/2,-d/2,0),(w/2,-d/2,0),(w/2,d/2,0),(-w/2,d/2,0),
        (0,-d/2+ridge,rise),(0,d/2-ridge,rise)]
    obj=mesh(scene,name,vs,[(0,1,4),(1,2,5,4),(2,3,5),(3,0,4,5)],material,collision=True)
    obj.location=(x,y,z);obj.rotation_euler.z=yaw


def wall_fixture(scene,name,x,y,z,yaw):
    c,s=math.cos(yaw),math.sin(yaw)
    local_box(scene,name+'_bracket',x,y,z,.24,.32,.18,'dark',yaw,solid=False,lod=0)
    local_box(scene,name+'_shade',x,y,z+.08,.4,.42,.08,'dark',yaw,(0,-.16),False,0)
    local_box(scene,name+'_diffuser',x,y,z-.06,.28,.22,.1,'lamp_glass',yaw,(0,-.16),False,0)
    light_source(scene,name+'_light',x+s*.4,y-c*.4,z-.14,intensity=24,distance=11)


def dress_shop(scene,name,shop,index):
    x,y=shop['inside'];w,d,yaw,floor=shop['width'],shop['depth'],shop['yaw'],shop['floor']
    c,s=math.cos(yaw),math.sin(yaw);v=-d/2-.09;top=3.5+(shop['floors']-1)*3.1
    def part(suffix,u,v,z,pw,pd,ph,mat='frame',solid=False,lod=0):
        return local_box(scene,name+'_'+suffix,x,y,floor+z,pw,pd,ph,mat,yaw,(u,v),solid,lod)
    for obj in list(scene.objects):
        if obj.name.startswith(name+'_window'):bpy.data.objects.remove(obj,do_unlink=True)
        elif obj.name.startswith(name+'_goods'):bpy.data.objects.remove(obj,do_unlink=True)
        elif obj.name.startswith(name+'_display'):recolour(obj,'shop_glass' if shop['open'] else 'window_off')
    for level in range(shop['floors']-1):
        count=[2,3,3,3,2,2][index]
        for j in range(count):
            u=(j-(count-1)/2)*(w/(count+.5))
            office=name=='REPAIRS'
            style='office_glass' if office else ['window_warm','window_off','window_neutral','window_cool'][(index+level*3+j)%4]
            facade_window(scene,name+'_room',x,y,floor+3.5+level*3.1+(0.6 if office else 1.0),u,v,
                          (2.0 if office else [1.55,1.75,1.45][(index+j)%3]),(1.85 if office else 1.2),yaw,style)
    # Ground-floor shop glazing and doors keep the 2.8 m unobstructed opening.
    for u in [-w/2+.6,-1.45,1.45,w/2-.6]:part('shop_frame',u,v-.04,.48,.085,.11,2.34)
    for side in [-1,1]:
        part('shop_transom',side*(w+2.8)/4,v-.03,2.38,(w-3.4)/2,.11,.08)
        part('shop_sill',side*(w+2.8)/4,v-.03,.47,(w-3.4)/2,.2,.08,'concrete')
    if not shop['open']:
        for i in range(14):part('shutter_slat',0,-d/2-.09,.1+i*.2,2.75,.04,.035,'frame')
    # Distinct roof forms and service volumes make silhouettes independent of paint.
    if name in ['BAKERY','TEA']:
        roof_prism(scene,name+'_pitched_roof',x,y,floor+top+.2,w+.8,d+.6,1.65,yaw,'tile',hip=name=='TEA')
    else:
        for side in [-1,1]:part('parapet',side*(w/2-.12),0,top+.2,.24,d,.55,shop['colour'],True,-1)
        part('roof_room',-w*.23,d*.18,top+.2,3.1,3.2,1.8,'plaster',True,-1)
        part('roof_room_cap',-w*.23,d*.18,top+2,3.35,3.45,.15,'roof',False,-1)
    part('cornice',0,0,top-.06,w+.4,d+.25,.18,'concrete',False,-1)
    part('ground_band',0,-d/2-.12,3.42,w+.2,.3,.16,'concrete',False,-1)
    for side in [-1,1]:part('downpipe',side*(w/2-.34),-d/2-.23,0,.085,.09,top,'frame')
    # External cooling unit is fixed to the side, away from the entrance.
    part('ac',w/2+.22,1.5,1.8,.5,1.05,.65,'concrete')
    for i in range(5):part('ac_grille',w/2+.48,1.5,1.89+i*.085,.04,.8,.025,'frame')
    if name=='BOOKS':
        part('balcony_slab',0,-d/2-.75,3.42,w*.72,1.55,.16,'concrete',True,-1)
        part('balcony_rail',0,-d/2-1.48,4.45,w*.72,.1,.1,'frame',True,-1)
        for u in [-w*.36,w*.36]:part('balcony_side',u,-d/2-.78,3.58,.1,1.48,.96,'frame',True,-1)
        for i in range(16):part('baluster',-w*.36+i*w*.72/15,-d/2-1.48,3.58,.055,.055,.9,'frame')
    # Goods express shop use. No copies of the source's names or props.
    if name=='GREENGROCER':
        for side in [-1,1]:
            part('produce_stand',side*3,-d/2-1,.08,1.5,1.1,.65,'timber',True,-1)
            for j in range(3):part('produce_crate',side*3+(j-1)*.46,-d/2-1,.75,.42,.85,.24,['produce','ochre','terracotta'][j])
    if name=='BOOKS':
        for row in range(3):
            for j in range(12):part('book',-w/2+.95,(-d*.1+j*.33),.45+row*.44,.38,.23,.33,['paper','navy','terracotta'][j%3])
    if name=='BAKERY':
        part('oven',-w*.27,d*.32,0,2.0,1.45,1.65,'concrete',True,-1)
        part('oven_door',-w*.27,d*.32-.74,.3,1.25,.05,.8,'dark')
        for j in range(7):
            u,v=-2+j*.55,d/2-2
            rounded_crown(scene,name+'_bread',x+c*u-s*v,y+s*u+c*v,floor+1.03,.25,.16,.12,'ochre',0)
    if name=='TEA':
        for side in [-1,1]:
            part('table',side*2,0,.7,1.15,1.15,.12,'timber',True,-1)
            part('table_leg',side*2,0,0,.12,.12,.7,'frame',True,-1)
            for u,v in [(side*2-.26,0),(side*2+.26,0)]:
                cup(scene,name+'_cup',x+c*u-s*v,y+s*u+c*v,floor+.82)
            for v1 in [-.95,.95]:
                part('seat',side*2,v1,.43,.5,.5,.12,'timber',True,-1)
                part('seat_base',side*2,v1,0,.3,.3,.43,'frame',True,-1)
    # Small back-wall menu/notice is attached to the wall and readable indoors.
    part('notice_board',0,d/2-.17,1.7,3.8,.08,.8,'sage')
    px,py=x-s*(d/2-.23),y+c*(d/2-.23)
    lettering(scene,name+'_notice',{'BAKERY':'BAKED TODAY','TEA':'TEA  /  COFFEE','BOOKS':'BOOKS & JOURNALS'}.get(name,'FRESH PRODUCE'),px,py,floor+1.92,yaw,3.5)
    # A shallow soffit fixture belongs to its ceiling; one local source per open shop.
    if shop['open']:
        part('interior_diffuser',0,0,3.34,1.4,.5,.06,'lamp_glass')
        light_source(scene,name+'_interior_light',x,y,floor+3.2,intensity=75,distance=13)
    fx,fy=shop['front'];wall_fixture(scene,name+'_entry',fx+c*(w/2-.5),fy+s*(w/2-.5),floor+2.35,yaw)


def dress_home(scene,home,index):
    x,y=home['centre'];name=home['name'];w,d,yaw,floor=home['width'],home['depth'],home['yaw'],home['floor']
    c,s=math.cos(yaw),math.sin(yaw)
    def part(suffix,u,v,z,pw,pd,ph,mat='frame',solid=False,lod=0):
        return local_box(scene,name+'_'+suffix,x,y,floor+z,pw,pd,ph,mat,yaw,(u,v),solid,lod)
    for obj in list(scene.objects):
        if obj.name.startswith(name+'_waist_window') or obj.name==name+'_roof':bpy.data.objects.remove(obj,do_unlink=True)
    roof_prism(scene,name+'_finished_roof',x,y,floor+6.2,w+.9,d+.9,1.5+index*.16,yaw,
               'roof' if index in [1,4] else 'tile',hip=index in [0,3])
    part('eaves',0,0,6.14,w+.95,d+.95,.18,'concrete',False,-1)
    for level in range(2):
        for j,u in enumerate([-w*.28,w*.25]):
            kind=['window_warm','window_neutral','window_off','window_cool'][(index*2+level+j)%4]
            facade_window(scene,name+'_room',x,y,floor+1.05+level*3.1,u,-d/2-.1,
                          [1.7,1.35,1.9,1.55,1.4][index],1.15,yaw,kind)
        # Side elevations matter along the bending lane, too.
        facade_window(scene,name+'_side_room',x,y,floor+1.2+level*3.1,0,-w/2-.1,1.3,1.1,yaw+math.pi/2,
                      ['window_off','window_neutral','window_warm'][(index+level)%3])
    part('skirting',0,-d/2-.08,.1,w,.16,.4,'concrete',False,-1)
    for side in [-1,1]:
        part('gutter',side*(w/2+.43),0,6.12,.13,d+.95,.13)
        part('downpipe',side*(w/2-.18),-d/2-.22,0,.075,.075,6.1)
    part('door_frame',0,-d/2-.1,2.1,1.3,.13,.1,'concrete')
    for side in [-1,1]:part('door_frame',side*.6,-d/2-.1,0,.1,.13,2.1,'concrete')
    part('handle',.37,-d/2-.17,.85,.045,.05,.3,'paper')
    part('letterbox',1.4,-d/2-.22,1,.5,.25,.33,'navy')
    part('utility_box',-w/2-.13,1,1.1,.22,.5,.7,'concrete')
    part('ac',w/2+.32,1.2,.25,.65,1.05,.7,'concrete',True,-1)
    for j in range(6):part('ac_grille',w/2+.66,1.2,.34+j*.08,.025,.83,.023)
    # Planting marks private lots; the 2.4 m approach stays clear.
    for side in [-1,1]:
        part('planter',side*2,-d/2-1.05,0,.65,.7,.5,'terracotta',True,-1)
        part('plant',side*2,-d/2-1.05,.5,.7,.75,.6,'garden_leaf',False,0)
    if index==0:
        part('balcony',0,-d/2-.73,3.02,w*.65,1.45,.18,'concrete',True,-1)
        part('balcony_front',0,-d/2-1.4,3.2,w*.65,.18,.9,'plaster',True,-1)
        for side in [-1,1]:part('balcony_side',side*w*.325,-d/2-.73,3.2,.18,1.5,.9,'plaster',True,-1)
    fx,fy=home['front'];wall_fixture(scene,name+'_porch',fx-s*.7,fy+c*.7,floor+2.16,yaw)


def roadside_edges(scene,points,half_width):
    # Drainage follows the bent carriageway. Narrow draped strips remain flat
    # crossings and do not introduce a raised barrier in front of entrances.
    for side in [-1,1]:
        line=[]
        for i,(x,y) in enumerate(points):
            a,b=points[max(0,i-1)],points[min(len(points)-1,i+1)]
            dx,dy=b[0]-a[0],b[1]-a[1];length=math.hypot(dx,dy)
            line.append((x-side*dy/length*(half_width+.18),y+side*dx/length*(half_width+.18)))
        obj=ribbon(scene,'izma','Drain_channel',line,.25,'concrete',lift=.138)
        obj['surface']=False
        for i in range(1,len(line)-1,2):
            x,y=line[i];a,b=line[i-1],line[i+1]
            dx,dy=b[0]-a[0],b[1]-a[1];length=math.hypot(dx,dy);tx,ty=dx/length,dy/length
            def inset(name,u0,u1,v0,v1,mat,lift):
                vertices=[(x-ty*u+tx*v,y+tx*u+ty*v,0) for u,v in [(u0,v0),(u1,v0),(u1,v1),(u0,v1)]]
                vs,fs=drape('izma',vertices,[(0,1,2),(0,2,3)],lift)
                mesh(scene,name,vs,fs,mat,0)
            inset('Drain_slot',-.12,.12,-.32,.32,'drain_slot',.14)
            for j in range(6):inset('Drain_bar',-.12,.12,-.29+j*.11,-.265+j*.11,'frame',.148)


def public_furniture(scene):
    # Lamps have a visible pole, outreach arm, cap and diffuser.
    for obj in list(scene.objects):
        if obj.name.startswith('Local_lamp_head'):bpy.data.objects.remove(obj,do_unlink=True)
    for x,y in [(-93,-72),(-92,-11),(-156,53),(-188,127)]:
        z=ground('izma',x,y)
        box(scene,'Street_lamp_arm',x-.3,y,z+3.95,.75,.12,.12,'dark',solid=False)['lod']=0
        box(scene,'Street_lamp_cap',x-.62,y,z+4.03,.7,.4,.13,'dark',solid=False)['lod']=0
        box(scene,'Street_lamp_diffuser',x-.62,y,z+3.97,.53,.29,.06,'lamp_glass',solid=False)['lod']=0
        light_source(scene,'Street_lamp',x-.62,y,z+3.8,intensity=95,distance=20)
    for x in [-60,-20,20,60,92]:
        y=-86.8;z=9.25
        box(scene,'Bridge_lamp_post',x,y,z,.12,.12,2.8,'dark')
        box(scene,'Bridge_lamp_cap',x,y,z+2.8,.45,.45,.12,'dark',solid=False)['lod']=0
        box(scene,'Bridge_lamp_glass',x,y,z+2.45,.25,.25,.33,'lamp_glass',solid=False)['lod']=0
        light_source(scene,'Bridge_lamp',x,y,z+2.55,intensity=85,distance=22)
    for x,y,yaw in [(-110,-80,0),(curve_x(5)-38,5,math.pi/2),(curve_x(50)-38,50,math.pi/2)]:
        z=ground('izma',x,y)+.14
        for side in [-1,1]:local_box(scene,'Bench_leg',x,y,z,.12,.58,.45,'dark',yaw,(side*.8,0))
        local_box(scene,'Bench_seat',x,y,z+.45,2.2,.65,.12,'timber',yaw)
        local_box(scene,'Bench_back',x,y,z+.68,2.2,.12,.4,'timber',yaw,(0,.3))
    # A short riverside railing protects the water edge, outside the lower path.
    for side in [-1,1]:
        for y in range(-150,91,6):
            x=curve_x(y)+side*32;z=ground('izma',x,y)
            box(scene,'River_guard_post',x,y,z,.1,.1,1.02,'frame')
            ny=y+6;nx=curve_x(ny)+side*32;nz=ground('izma',nx,ny)
            for h in [.5,1.02]:
                vs=[(px+dx,py,pz+h+dz) for px,py,pz in [(x,y,z),(nx,ny,nz)] for dz in [0,.08] for dx in [-.045,.045]]
                mesh(scene,'River_guard_rail',vs,[(0,1,3,2),(4,6,7,5),(0,4,5,1),(2,3,7,6),(0,2,6,4),(1,5,7,3)],'frame',collision=True)
    # Masonry arch between the banks; the lower promenades stay outside piers.
    for i in range(24):
        a,b=-1+2*i/24,-1+2*(i+1)/24
        x1,x2=12+32*a,12+32*b;z1,z2=3.1+4.1*(1-a*a),3.1+4.1*(1-b*b)
        vs=[(x,y,z) for y in [-86.3,-73.7] for x,z in [(x1,z1),(x2,z2),(x2,7.53),(x1,7.53)]]
        mesh(scene,'Bridge_arch',vs,[(0,1,2,3),(4,7,6,5),(0,4,5,1),(3,2,6,7)],'masonry',collision=True)


def rounded_crown(scene,name,x,y,z,rx,ry,rz,material,lod):
    n=9;vs=[(x,y,z-rz),(x,y,z+rz)]
    for ring in [-.5,.4]:
        radius=math.sqrt(1-ring*ring)
        vs.extend((x+math.cos(i*math.tau/n)*rx*radius,y+math.sin(i*math.tau/n)*ry*radius,z+ring*rz) for i in range(n))
    fs=[]
    for i in range(n):
        j=(i+1)%n
        fs.extend([(0,2+j,2+i),(1,2+n+i,2+n+j),(2+i,2+j,2+n+j,2+n+i)])
    mesh(scene,name,vs,fs,material,lod)


def cup(scene,name,x,y,z):
    n=10;vs=[]
    for radius,height in [(.065,0),(.09,.14),(.075,.14),(.05,.025)]:
        vs.extend((x+math.cos(i*math.tau/n)*radius,y+math.sin(i*math.tau/n)*radius,z+height) for i in range(n))
    fs=[]
    for ring in range(3):
        for i in range(n):fs.append((ring*n+i,ring*n+(i+1)%n,(ring+1)*n+(i+1)%n,(ring+1)*n+i))
    mesh(scene,name,vs,fs,'paper',0)


def dress_background(scene):
    for obj in list(scene.objects):
        if obj.name.startswith('Tree_crown'):obj['lod']=2
        if obj.name.startswith('Tree_trunk'):
            x,y,z=obj.location;h=obj['solid'][2]/.6
            for i,(dx,dy,dz,size) in enumerate([(-.16,0,.61,.25),(.16,.08,.69,.27),(0,-.13,.83,.23)]):
                rounded_crown(scene,'Leaf_cluster',x+dx*h,y+dy*h,z+dz*h,h*size,h*size,h*size*1.05,
                              ['leaf','leaf_light','leaf_dark'][i],0)
            rounded_crown(scene,'Tree_middle',x,y,z+h*.7,h*.35,h*.32,h*.4,'leaf',1)
        if obj.name.startswith('Hillside_home') and obj.get('solid') and 'foundation' not in obj.name:
            x,y,z=obj.location;w,d,h=obj['solid']
            for level in range(2):
                for j in [-1,1]:
                    facade_window(scene,'Hillside_room',x,y,z+1.1+level*3.1,j*w*.25,-d/2-.08,2,1.2,0,
                                  ['window_off','window_warm','window_neutral'][(level+j+int(y))%3],trim=False)
        if not (obj.name.startswith('Quay_building') and obj.get('solid') and 'foundation' not in obj.name):continue
        x,y,z=obj.location;w,d,h=obj['solid'];yaw=math.pi/2 if x<0 else -math.pi/2
        levels=max(2,int(h/3.1));count=max(3,int(d/5))
        for level in range(levels):
            for j in range(count):
                style=['window_off','window_warm','window_off','window_neutral','window_cool'][(j+level*3+int(y))%5]
                facade_window(scene,'Quay_room',x,y,z+1.1+level*3.05,(j-(count-1)/2)*d/(count+.4),-w/2-.08,
                              2.2,1.25,yaw,style,trim=False)
        local_box(scene,'Quay_roof_service',x,y,z+h,w*.25,d*.25,1.6,'roof',0,(-w*.2,d*.12))


def finish_neighborhood(scene,shops,homes,market,climb):
    finish_materials(scene)
    for i,(name,shop,_,_) in enumerate(shops):dress_shop(scene,name,shop,i)
    for i,home in enumerate(homes):dress_home(scene,home,i)
    roadside_edges(scene,market,3);roadside_edges(scene,climb,2.6)
    public_furniture(scene);dress_background(scene)
