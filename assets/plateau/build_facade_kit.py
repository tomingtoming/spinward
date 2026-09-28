"""Author shared parametric facade parts once, in an isolated Blender process.

X is along the wall, -Y is outward, Z is up. stretch=(dX/dWidth,dZ/dHeight)
keeps frame sections fixed while openings resize. No city-specific geometry here.
"""
import bpy,json
from pathlib import Path

def export_edited_kit(export):
    """Export an opened, edited kit without rebuilding or saving over the artist's .blend.

    Keep width_stretch / height_stretch point attributes when editing frame geometry.
    Apply modifiers explicitly in Blender before export; silently ignoring them is unsafe.
    """
    parts={};roles={'variable_infill':0,'fixed_frame':1,'fixed_sill':2}
    for obj in bpy.context.scene.objects:
        if not obj.get('shared_part'):continue
        if obj.type!='MESH' or obj.modifiers:raise ValueError(f'{obj.name}: export requires an applied mesh')
        if any(abs(v-expected)>1e-8 for v,expected in zip([v for row in obj.matrix_world for v in row],[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1])):
            raise ValueError(f'{obj.name}: apply transforms and preserve the kit origin before export')
        mesh=obj.data;mesh.update();mesh.calc_loop_triangles()
        attrs=[mesh.attributes.get(name) for name in ['width_stretch','height_stretch']]
        if any(a is None or a.domain!='POINT' or a.data_type!='FLOAT' for a in attrs):raise ValueError(f'{obj.name}: missing stretch attributes')
        vertex_roles=[None]*len(mesh.vertices)
        for face in mesh.polygons:
            role=roles[mesh.materials[face.material_index].name]
            for i in face.vertices:
                if vertex_roles[i] is not None and vertex_roles[i]!=role:raise ValueError(f'{obj.name}: split vertices between material roles')
                vertex_roles[i]=role
        if any(r is None for r in vertex_roles):raise ValueError(f'{obj.name}: remove loose vertices')
        parts[obj.name]=dict(positions=[list(v.co) for v in mesh.vertices],normals=[list(v.normal) for v in mesh.vertices],
                             stretch=[[a.data[i].value for a in attrs] for i in range(len(mesh.vertices))],roles=vertex_roles,
                             indices=[int(i) for t in mesh.loop_triangles for i in t.vertices])
        if obj.get('collision_boxes'):parts[obj.name]['collision']=json.loads(obj['collision_boxes'])
    version=int(bpy.context.scene.get('facade_version',1))
    expected={'window','door','strip'}|({'glazing','entry','guard'} if version>=2 else set())
    if version>=3:expected.add('balcony')
    if set(parts)!=expected:raise ValueError('Unexpected named shared parts')
    result=dict(version=version,origin='ai',created='2026-09-25' if version>=2 else '2026-09-22',coordinateFrame='X along wall, -Y outward, Z up',parts=parts)
    Path(export).write_text(json.dumps(result,separators=(',',':')))
    return dict(export=str(export),parts={k:dict(vertices=len(v['positions']),triangles=len(v['indices'])//3) for k,v in parts.items()})

def build(target,export,version=1):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene=bpy.context.scene;scene.name='Spinward_shared_facade_kit';scene.unit_settings.system='METRIC'
    scene['facade_version']=version
    scene['design']='Shared geometry; wall dimensions stretch openings without scaling frame thickness'
    parts={}
    def part(name):return parts.setdefault(name,dict(positions=[],stretch=[],roles=[],indices=[]))
    def box(name,cx,z,w,h,depth,offset,role,ax=0,az=0,wx=0,hz=0):
        p=part(name);start=len(p['positions'])
        # Separate face vertices preserve planar frame faces and stable normals at every width.
        corners=[];anchors=[]
        for d in [offset,offset+depth]:
            for sx,sz in [(-1,-1),(1,-1),(1,1),(-1,1)]:
                corners.append([cx+sx*w/2,-d,z+sz*h/2]);anchors.append([ax+sx*wx/2,az+sz*hz/2])
        for face in [[0,3,2,1],[4,5,6,7],[0,1,5,4],[1,2,6,5],[2,3,7,6],[3,0,4,7]]:
            base=len(p['positions'])
            for i in face:p['positions'].append(corners[i]);p['stretch'].append(anchors[i]);p['roles'].append(role)
            p['indices'].extend([base,base+1,base+2,base,base+2,base+3])
    # Width=height=1 are authoring dimensions, not a scaling convention for the whole mesh.
    box('window',0,.5,1,1,.015,.042,0,az=.5,wx=1,hz=1)
    for x in [-.5,.5,0]:box('window',x,.5,.045,1.07,.045,.052,1,ax=x,az=.5,hz=1)
    for z in [0,1]:box('window',0,z,1.065,.05,.045,.052,1,az=z,wx=1)
    box('window',0,-.045,1.16,.085,.12,.025,2,wx=1)
    # Door frame/panel and handle, without an implied enterable interior.
    box('door',0,1.12,1.17,2.24,.018,.048,1)
    box('door',0,1.08,1.01,2.12,.025,.07,0)
    box('door',.37,1.04,.045,.30,.045,.102,2)
    # Width/height/depth come from a placement; used for bands/cornices.
    box('strip',0,0,1,1,1,0,0,wx=1,hz=1)
    if version>=2:
        # Unbroken glazing and scalable shared entrance; the original sash
        # window remains useful for homes and paired apartment room openings.
        for name in ['glazing','entry']:
            box(name,0,.5,1,1,.015,.042,0,az=.5,wx=1,hz=1)
            for x in [-.5,.5]:box(name,x,.5,.055,1.04,.04,.052,1,ax=x,az=.5,hz=1)
            for z in [0,1]:box(name,0,z,1.05,.055,.04,.052,1,az=z,wx=1)
        box('entry',.36,.5,.035,.22,.03,.098,1,ax=.5,az=.5)
        # Shallow French-window safety guard. No unsupported balcony slab or
        # traversable extension beyond the source building envelope is implied.
        for x in [-.5,-.25,0,.25,.5]:box('guard',x,.5,.035,1,.04,0,0,ax=x,az=.5,hz=1)
        for z in [.04,.97]:box('guard',0,z,1.08,.055,.055,0,0,az=0 if z<.5 else 1,wx=1)
        for x in [-.5,.5]:
            for z in [.04,.97]:box('guard',x,z,.055,.07,.14,-.13,0,ax=x,az=0 if z<.5 else 1)
    if version>=3:
        # A 0.96m projecting balcony: thin slab, solid parapet with a top rail,
        # and privacy cheeks. Both rendering and simple collision share boxes.
        collision=[]
        def balcony(cx,z,w,h,depth,offset,role,ax=0,wx=0):
            box('balcony',cx,z,w,h,depth,offset,role,ax=ax,wx=wx)
            collision.append(dict(center=[cx,-offset-depth/2,z],size=[w,depth,h],anchor=ax,widthStretch=wx))
        balcony(0,-.085,1,.17,.98,-.02,2,wx=1)
        balcony(0,.39,1,.78,.075,.855,0,wx=1)
        balcony(0,1.04,1,.06,.065,.86,1,wx=1)
        for x in [-.5,.5]:balcony(x,.52,.08,1.04,.98,-.02,0,ax=x)
        # The fine open rail interval is one solid contact region, not bars.
        collision[1]['center'][2]=.52;collision[1]['size'][2]=1.04;collision.pop(2)
        parts['balcony']['collision']=collision
    materials={}
    for role,color in [(0,(.2,.3,.34,1)),(1,(.09,.1,.1,1)),(2,(.5,.5,.45,1))]:
        m=bpy.data.materials.new(['variable_infill','fixed_frame','fixed_sill'][role]);m.diffuse_color=color;materials[role]=m
    for name,p in parts.items():
        mesh=bpy.data.meshes.new(name);faces=[p['indices'][i:i+3] for i in range(0,len(p['indices']),3)]
        mesh.from_pydata(p['positions'],[],faces);mesh.update()
        for role in range(3):mesh.materials.append(materials[role])
        for face in mesh.polygons:face.material_index=p['roles'][face.vertices[0]]
        for name_,component in [('width_stretch',0),('height_stretch',1)]:
            a=mesh.attributes.new(name=name_,type='FLOAT',domain='POINT')
            for i,v in enumerate(p['stretch']):a.data[i].value=v[component]
        obj=bpy.data.objects.new(name,mesh);scene.collection.objects.link(obj);obj['shared_part']=True
        if 'collision' in p:obj['collision_boxes']=json.dumps(p['collision'])
        p['normals']=[list(v.normal) for v in mesh.vertices]
    note=bpy.data.texts.new('PARAMETRIC_RULES');note.write(__doc__)
    result=dict(version=version,origin='ai',created='2026-09-25' if version>=2 else '2026-09-22',coordinateFrame='X along wall, -Y outward, Z up',parts=parts)
    Path(export).parent.mkdir(parents=True,exist_ok=True);Path(export).write_text(json.dumps(result,separators=(',',':')))
    bpy.ops.wm.save_as_mainfile(filepath=str(target),compress=True)
    return dict(path=str(target),export=str(export),parts={k:dict(vertices=len(v['positions']),triangles=len(v['indices'])//3) for k,v in parts.items()})
