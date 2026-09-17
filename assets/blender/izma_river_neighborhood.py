"""Draw the bridge / market / hillside connection with the landscape helpers.

This recipe runs in the isolated world-landscape builder's namespace. The
exporter consumes the resulting editable meshes and scene visit metadata.
Coordinates describe one deliberately placed neighbourhood, not a city grid.
"""


def graded_walk(scene, name, points, width, material='walk'):
    """A small entrance ramp: keep its middle above the authored ground too."""
    vs=[];fs=[];sampled=[]
    for a,b in zip(points,points[1:]):
        n=max(1,math.ceil(math.dist(a[:2],b[:2])/2))
        sampled.extend([tuple(a[k]+(b[k]-a[k])*i/n for k in range(3)) for i in range(n)])
    sampled.append(points[-1])
    for i,(x,y,z) in enumerate(sampled):
        p,q=sampled[max(0,i-1)],sampled[min(len(sampled)-1,i+1)]
        dx,dy=q[0]-p[0],q[1]-p[1];n=math.hypot(dx,dy)
        for side in [-1,1]:
            px,py=x-side*dy/n*width/2,y+side*dx/n*width/2
            vs.append((px,py,max(z,ground('izma',px,py)+.11)))
        if i:
            a=(i-1)*2;fs.extend([(a,a+2,a+3),(a,a+3,a+1)])
    return mesh(scene,name,vs,fs,material,collision=True)


def local_box(scene,name,x,y,z,w,d,h,material,yaw,offset=(0,0),solid=True,lod=-1):
    c,s=math.cos(yaw),math.sin(yaw);u,v=offset
    obj=box(scene,name,x+c*u-s*v,y+s*u+c*v,z,w,d,h,material,yaw,solid)
    obj['lod']=lod
    return obj


def lettering(scene,name,body,x,y,z,yaw,width):
    # Planar, low-resolution geometry attached to a fascia, never a floating UI.
    curve=bpy.data.curves.new(name,'FONT');curve.body=body;curve.align_x='CENTER'
    curve.size=.44;curve.resolution_u=1
    obj=bpy.data.objects.new(name,curve);scene.collection.objects.link(obj)
    obj.location=(x,y,z);obj.rotation_euler=(math.pi/2,0,yaw)
    bpy.context.window.scene=scene;bpy.context.view_layer.update()
    evaluated=obj.evaluated_get(bpy.context.evaluated_depsgraph_get())
    data=bpy.data.meshes.new_from_object(evaluated)
    replacement=bpy.data.objects.new(name+'_mesh',data);scene.collection.objects.link(replacement)
    replacement.matrix_world=obj.matrix_world.copy()
    text_width=max(v.co.x for v in data.vertices)-min(v.co.x for v in data.vertices)
    if text_width>width:replacement.scale.x=width/text_width
    replacement.data.materials.append(bpy.data.materials['SWL_white'])
    replacement['material']='white';replacement['lod']=0
    bpy.data.objects.remove(obj,do_unlink=True)


def market_shop(scene,name,x,y,w,d,floors,colour,awning,yaw,open_shop=True):
    c,s=math.cos(yaw),math.sin(yaw)
    corners=[ground('izma',x+c*u-s*v,y+s*u+c*v) for u in [-w/2,w/2] for v in [-d/2,d/2]]
    floor=max(corners)+.18
    def part(suffix,u,v,z,pw,pd,ph,mat,solid=True,lod=-1):
        return local_box(scene,name+'_'+suffix,x,y,floor+z,pw,pd,ph,mat,yaw,(u,v),solid,lod)
    # Separate shell pieces leave a real 2.8 m doorway; no whole-building box.
    part('plinth',0,0,min(corners)-floor,w,d,floor-min(corners),'stone')
    part('back',0,d/2,0,w,.28,3.5,colour)
    for side in [-1,1]:part('side',side*(w/2-.14),0,0,.28,d,3.5,colour)
    part('upper',0,0,3.5,w,d,(floors-1)*3.1,colour)
    part('roof',0,0,3.5+(floors-1)*3.1,w+.3,d+.3,.22,'roof')
    for side in [-1,1]:
        part('jamb',side*(w/2-.3),-d/2,0,.6,.35,3.5,colour)
        panel=(w-3.4)/2
        part('display',side*(1.4+panel/2),-d/2-.02,.5,panel,.06,2.25,'glass')
        part('sill',side*(1.4+panel/2),-d/2,0,panel,.3,.5,colour)
    if not open_shop:part('shutter',0,-d/2,0,2.8,.14,3.1,'roof')
    part('fascia',0,-d/2-.16,2.85,w-.4,.2,.65,awning)
    part('canopy',0,-d/2-.9,2.7,w-.1,2,.12,awning)
    for level in range(1,floors):
        count=2 if w<10 else 3
        for j in range(count):
            u=(j-(count-1)/2)*(w/(count+.3))
            part('window',u,-d/2-.025,level*3.1+1.65,1.3 if w<10 else 1.65,.05,1.05,'glass',False,0)
            part('window_sill',u,-d/2-.09,level*3.1+1.55,1.55,.2,.1,'stone',False,0)
    if open_shop:
        part('counter',0,d/2-2.0,0,w-1.5,1.1,.9,'timber')
        for side in [-1,1]:part('shelf',side*(w/2-.7),1,.05,.75,d*.5,1.6,'timber')
        for i in range(4):part('goods',-1.5+i, d/2-2,.92,.5,.55,.3,['ochre','sage'][i%2],False,0)
    front=(x+s*d/2,y-c*d/2)
    lettering(scene,name+'_sign',name.upper(),front[0]+s*.28,front[1]-c*.28,floor+3.02,yaw,w-.8)
    return {'front':front,'floor':floor,'inside':(x,y),'width':w,'depth':d,
            'floors':floors,'yaw':yaw,'colour':colour,'open':open_shop}


def neighborhood_home(scene,name,x,y,w,d,yaw,colour):
    c,s=math.cos(yaw),math.sin(yaw)
    corners=[ground('izma',x+c*u-s*v,y+s*u+c*v) for u in [-w/2,w/2] for v in [-d/2,d/2]]
    floor=max(corners)+.16
    local_box(scene,name+'_foundation',x,y,min(corners),w,d,floor-min(corners),'stone',yaw)
    local_box(scene,name,x,y,floor,w,d,6.2,colour,yaw)
    roof=[(-w/2-.3,-d/2-.3,0),(w/2+.3,-d/2-.3,0),(-w/2-.3,d/2+.3,0),(w/2+.3,d/2+.3,0),(0,-d/2-.3,2),(0,d/2+.3,2)]
    obj=mesh(scene,name+'_roof',roof,[(0,2,5,4),(1,4,5,3),(0,4,1),(2,3,5)],'tile',collision=True)
    obj.location=(x,y,floor+6.2);obj.rotation_euler.z=yaw
    for level in [0,1]:
        for u in [-w*.28,w*.25]:
            local_box(scene,name+'_waist_window',x,y,floor+1.0+level*3.1,1.45,.06,1.15,'glass',yaw,(u,-d/2-.04),False,0)
    local_box(scene,name+'_door',x,y,floor,1.1,.08,2.1,'timber',yaw,(0,-d/2-.05),False,0)
    local_box(scene,name+'_porch_roof',x,y,floor+2.35,2.8,1.9,.14,'roof',yaw,(0,-d/2-.7))
    # A private porch ends at the door, with enough room to turn around.
    front=(x+s*(d/2+1),y-c*(d/2+1))
    local_box(scene,name+'_porch',x,y,floor-.18,3.2,2.6,.18,'stone',yaw,(0,-d/2-1))
    return {'front':front,'floor':floor,'look':(x,y,floor+1.6),'name':name,
            'centre':(x,y),'width':w,'depth':d,'yaw':yaw,'colour':colour}


def build_river_neighborhood(scene):
    market=[(-98,-80),(-103,-50),(-106,-22),(-113,7),(-131,30)]
    climb=[(-131,30),(-155,46),(-174,66),(-184,90),(-185,117),(-178,139),(-164,151)]
    landing=[(-75,-80),(-98,-80)]
    for name,points,width in [('West_bridge_landing',landing,14),('Market_pavement',market,14),('Hillside_pavement',climb,9)]:
        ribbon(scene,'izma',name,points,width,'walk',lift=.12)
    ribbon(scene,'izma','Market_lane',market,6,'road',lift=.16)
    ribbon(scene,'izma','Hillside_lane',climb,5.2,'road',lift=.16)
    ribbon(scene,'izma','Hill_cross_link',[(-184,97),(-215,104)],5,'walk',lift=.12)
    # Give the bridge a visible underside and supported ends; lower bank
    # walking routes remain open underneath its deck.
    for i in range(22):
        box(scene,'Bridge_deck_section',12-86+(i+.5)*172/22,-80,7.54,172/22,13.2,.5,'stone')
    for side in [-1,1]:
        x=12+side*47;z=ground('izma',x,-80)
        box(scene,'Bridge_abutment',x,-80,z,5,12.8,max(.1,7.7-z),'stone')
    shops=[]
    specs=[('BAKERY',-121,-62,11,12,2,'cream','awning',math.pi/2,True,-101),
           ('GREENGROCER',-123,-43,12,11,2,'ochre','sage',math.pi/2,True,-104),
           ('REPAIRS',-126,-23,9,12,3,'plaster','roof',math.pi/2,False,-106),
           ('BOOKS',-135,-3,14,13,3,'brick','sage',math.pi/2,True,-111),
           ('HOUSEWARES',-83,-46,12,10,2,'plaster','roof',-math.pi/2,False,-103),
           ('TEA',-82,-22,9,10,2,'cream','awning',-math.pi/2,True,-106)]
    for name,x,y,w,d,floors,col,awning,yaw,opened,road_x in specs:
        shop=market_shop(scene,name,x,y,w,d,floors,col,awning,yaw,opened)
        fx,fy=shop['front'];floor=shop['floor']
        edge_x=road_x+math.copysign(5.2,fx-road_x)
        graded_walk(scene,name+'_apron',[(edge_x,y,ground('izma',edge_x,y)+.2),(fx,fy,floor+.01)],w+.2)
        shops.append((name,shop,road_x,y))
    # Low boundary walls give the uphill lots an address without blocking the
    # doors or turning every frontage into another shop.
    homes=[]
    for name,x,y,w,d,yaw,col,start in [
        ('Hill_home_A',-202,80,11,10,math.pi/2,'cream',(-180,80)),
        ('Hill_home_B',-202,113,12,11,math.pi/2,'plaster',(-185,113)),
        ('Hill_home_C',-186,160,12,12,0,'ochre',(-181,136)),
        ('Hill_home_D',-158,169,13,12,-.17,'cream',(-166,149)),
        ('Hill_home_E',-147,133,11,11,-math.pi/2,'plaster',(-181,132))]:
        home=neighborhood_home(scene,name,x,y,w,d,yaw,col)
        home['approach']=start
        fx,fy=home['front'];sx,sy=start
        length=math.hypot(fx-sx,fy-sy)
        sx+=3.2*(fx-sx)/length;sy+=3.2*(fy-sy)/length
        approach_length=math.hypot(sx-fx,sy-fy)
        landing=(fx+(sx-fx)/approach_length*1.4,fy+(sy-fy)/approach_length*1.4,home['floor'])
        graded_walk(scene,name+'_entry',[(sx,sy,ground('izma',sx,sy)+.2),landing,(fx,fy,home['floor'])],2.4)
        homes.append(home)
        for side in [-1,1]:
            local_box(scene,name+'_garden_wall',x,y,ground('izma',fx,fy),max(1,w/2-2),.25,.65,'stone',yaw,(side*(w/4+1),-d/2-3))
    for x,y in [(-108,21),(-146,32),(-194,138),(-167,183)]:tree(scene,'izma',x,y,6)
    for x,y in [(-93,-72),(-92,-11),(-156,53),(-188,127)]:
        z=ground('izma',x,y)
        box(scene,'Local_lamp_post',x,y,z,.16,.16,4.1,'dark')
        obj=box(scene,'Local_lamp_head',x,y,z+4.05,.55,.38,.16,'ochre',solid=False);obj['lod']=0
    # Attached signs on the bridge landing and uphill fork support the route.
    for x,y,label in [(-96,-89,'MARKET'),(-133,39,'HILLSIDE')]:
        z=ground('izma',x,y)
        box(scene,'Wayfinding_post',x,y,z,.14,.14,2.6,'dark')
        box(scene,'Wayfinding_board',x,y,z+2.05,3.7,.13,.65,'sage')
        lettering(scene,'Wayfinding_text',label,x,y-.085,z+2.16,0,3.4)
    bakery=shops[0][1];home=homes[2]
    scene['visits']=json.dumps({
        'shops':{'position':[-101,-70,ground('izma',-101,-70)+.2],'lookAt':[-113,-35,11]},
        'garden':{'position':[-180,131,ground('izma',-180,131)+.2],'lookAt':list(home['look'])},
        'river':{'position':[curve_x(0)-35,0,ground('izma',curve_x(0)-35,0)+.08],'lookAt':[20,25,4]}
    })
    # This polyline is QA/authoring metadata, not an on-screen guide or a
    # teleport sequence. End-to-end checks follow it with normal movement.
    path=[(58,-80),(-98,-80),*market[1:],*climb[1:5],(-181,136),home['front']]
    points=[[x,y,8.2 if i==0 else ground('izma',x,y)+.2] for i,(x,y) in enumerate(path)]
    points[-1][2]=home['floor']
    walks={'bridge-to-homes':points}
    for name,shop,rx,sy in shops:
        if shop['open']:
            walks[name.lower()+'-entry']=[[rx,sy,ground('izma',rx,sy)+.2],
                [*shop['front'],shop['floor']],[*shop['inside'],shop['floor']]]
    for home in homes:
        ax,ay=home['approach']
        walks[home['name']+'-entry']=[[ax,ay,ground('izma',ax,ay)+.2],[*home['front'],home['floor']]]
    scene['walks']=json.dumps(walks)
    exec(compile((ROOT/'assets/blender/izma_neighborhood_finish.py').read_text(),
                 str(ROOT/'assets/blender/izma_neighborhood_finish.py'),'exec'),globals())
    finish_neighborhood(scene,shops,homes,market,climb)
