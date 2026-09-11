"""Original metric city-block architecture. Author massing once, retain it at all LODs.
Run via Blender MCP with __file__ set. Only tagged SWCB scenes are replaced.
"""
import bpy, json, math
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2]
C=json.loads((ROOT/'assets/blender/city-block.json').read_text())
previous=bpy.context.window.scene
PREFIX='SWCB_'
def linear(h):
    a=[int(h[i:i+2],16)/255 for i in (0,2,4)]
    return tuple(v/12.92 if v<=.04045 else ((v+.055)/1.055)**2.4 for v in a)+(1,)
def mat(name,color,rough=.8,metal=0,emission=None):
    m=bpy.data.materials.get(PREFIX+name) or bpy.data.materials.new(PREFIX+name);m.use_nodes=True
    p=m.node_tree.nodes.get('Principled BSDF');p.inputs['Base Color'].default_value=linear(color)
    p.inputs['Roughness'].default_value=rough;p.inputs['Metallic'].default_value=metal
    p.inputs['Emission Color'].default_value=linear(emission or '000000');p.inputs['Emission Strength'].default_value=.65 if emission else 0
    return m
def atlas(name,wall):
    images=[]
    for emissive in [False,True]:
        img=bpy.data.images.new(PREFIX+name+('_night' if emissive else '_day'),width=256,height=256,alpha=False)
        img.colorspace_settings.name='sRGB';pixels=[]
        for y in range(256):
            for x in range(256):
                cx,cy=x//64,y//64;u,v=x%64/64,y%64/64
                bottom,top=(.32,.77) if name=='residential' else (.04,.88) if name=='office' else (.2,.82)
                glass=.16<u<.84 and bottom<v<top;lit=(cx+cy*3)%4==1
                lamp=['ffd09a','fff5e8','dcecff'][(cx+cy*2)%3] if name=='residential' else 'dcecff' if name=='office' else 'ffd89b'
                colour=(lamp if glass and lit else '000000') if emissive else ('71858c' if glass and lit else '354e58' if glass else wall)
                pixels.extend(tuple(int(colour[i:i+2],16)/255 for i in (0,2,4))+(1,))
        img.pixels.foreach_set(pixels);img.update();img.pack();images.append(img)
    m=mat(name+'_atlas','ffffff');nodes=m.node_tree.nodes;links=m.node_tree.links;p=nodes.get('Principled BSDF')
    for image,socket in zip(images,['Base Color','Emission Color']):
        n=nodes.new('ShaderNodeTexImage');n.image=image;n.extension='REPEAT';links.new(n.outputs['Color'],p.inputs[socket])
    p.inputs['Emission Strength'].default_value=.65
    return m
reports=[]
for spec in C['blocks']:
    id=spec['id'];scene_name=PREFIX+id
    old=bpy.data.scenes.get(scene_name)
    if old:
        if old.get('spinward_asset')!='city-block-v1':raise RuntimeError('Refuse to replace an untagged scene')
        for o in list(old.objects):
            if len(o.users_scene)==1:bpy.data.objects.remove(o,do_unlink=True)
        bpy.data.scenes.remove(old)
    scene=bpy.data.scenes.new(scene_name);scene['spinward_asset']='city-block-v1';scene.unit_settings.system='METRIC';bpy.context.window.scene=scene
    mats=[mat(id+'_wall',spec['wall']),mat(id+'_roof',spec['roof']),mat(id+'_frame','526267',.55,.25),mat(id+'_glass','354e58',.3,.2),mat(id+'_lit','71858c',.35,.15,'ffd89b'),atlas(id,spec['wall'])]
    roots=[];levels=[]
    for lod in [2,3,1,0]:
        verts=[];faces=[];indices=[];uvs=[]
        def quad(points,material,uv=None):
            n=len(verts);verts.extend((x,-z,y) for x,y,z in points);faces.append((n,n+1,n+2,n+3));indices.append(material);uvs.append(uv or [(0,0),(1,0),(1,1),(0,1)])
        def surf(v,u,y,n,side):
            if side==0:return(v['x']+u,y,v['z']+n)
            if side==1:return(v['x']-u,y,v['z']-n)
            if side==2:return(v['x']+n,y,v['z']-u)
            return(v['x']-n,y,v['z']+u)
        def wall(v,side,u0,u1,y0,y1,n,material,uv=None):quad([surf(v,u0,y0,n,side),surf(v,u1,y0,n,side),surf(v,u1,y1,n,side),surf(v,u0,y1,n,side)],material,uv)
        def box(v,material=0,facades=False):
            x,y,z,w,h,d=[v[k] for k in ['x','y','z','w','h','d']];bottom=y-h/2;top=y+h/2
            for side in range(4):
                span=w if side<2 else d;n=d/2 if side<2 else w/2
                cols=max(1,int(span/3));rows=max(1,int(h/3.3))
                wall(v,side,-span/2,span/2,bottom,top,n,5 if facades else material,[(0,0),(cols/4,0),(cols/4,rows/4),(0,rows/4)])
            roof_y=top-.32 if lod<3 and any(v is mass for mass in spec['volumes']) else top
            quad([(x-w/2,roof_y,z-d/2),(x-w/2,roof_y,z+d/2),(x+w/2,roof_y,z+d/2),(x+w/2,roof_y,z-d/2)],1)
            quad([(x-w/2,bottom,z+d/2),(x-w/2,bottom,z-d/2),(x+w/2,bottom,z-d/2),(x+w/2,bottom,z+d/2)],material)
        def b(x,y,z,w,h,d,material=2):box(dict(x=x,y=y,z=z,w=w,h=h,d=d),material)
        def buried(point,own):
            x,y,z=point
            return any(v is not own and abs(x-v['x'])<v['w']/2-.02 and abs(z-v['z'])<v['d']/2-.02 and abs(y-v['y'])<v['h']/2-.02 for v in spec['volumes'])
        for v in spec['volumes']:
            box(v,facades=lod>=2)
            if lod>=2:
                if lod==2:
                    top=v['y']+v['h']/2
                    b(v['x'],top-.15,v['z']-v['d']/2+.14,v['w']-.04,.3,.24,1);b(v['x'],top-.15,v['z']+v['d']/2-.14,v['w']-.04,.3,.24,1)
                    b(v['x']-v['w']/2+.14,top-.15,v['z'],.24,.3,v['d']-.52,1);b(v['x']+v['w']/2-.14,top-.15,v['z'],.24,.3,v['d']-.52,1)
                continue
            for side in range(4):
                span=v['w'] if side<2 else v['d'];n=(v['d'] if side<2 else v['w'])/2
                cols=max(1,int(span/3));rows=max(1,int(v['h']/3.3));cw=span/cols;ch=v['h']/rows
                for row in range(rows):
                    for col in range(cols):
                        u=-span/2+(col+.5)*cw;y=v['y']-v['h']/2+(row+.5)*ch
                        if buried(surf(v,u,y,n+.03,side),v):continue
                        bottom,top=(.32,.77) if id=='residential' else (.04,.88) if id=='office' else (.2,.82)
                        l=u-cw*.34;r=u+cw*.34;lo=y+(bottom-.5)*ch;hi=y+(top-.5)*ch
                        if side==0 and v is spec['volumes'][0] and lo<3.45 and hi>0 and v['x']+l<1.85 and v['x']+r>-1.85:continue
                        # The same atlas texel supplies each lit room's colour at
                        # near and far LOD, keeping one shared glazing primitive.
                        lit=(col+row*3)%4==1;uv=[((col%4+.5)/4,(row%4+(bottom+top)/2)/4)]*4
                        wall(v,side,l,r,lo,hi,n+.015,5 if lit else 3,uv if lit else None)
                        if lod==0:
                            # Raised stone surround and deep jambs around the dark glazing.
                            edge=.10;depth=.16
                            for a,c,bottom,top in [(l-edge,l,lo-edge,hi+edge),(r,r+edge,lo-edge,hi+edge),(l,r,lo-edge,lo),(l,r,hi,hi+edge)]:wall(v,side,a,c,bottom,top,n+depth,0)
                            for a,c in [(l,r),(r,l)]:
                                yy=lo if a==l else hi;quad([surf(v,a,yy,n+.015,side),surf(v,c,yy,n+.015,side),surf(v,c,yy,n+depth,side),surf(v,a,yy,n+depth,side)],2)
                            for a in [l,r]:quad([surf(v,a,lo,n+.015,side),surf(v,a,hi,n+.015,side),surf(v,a,hi,n+depth,side),surf(v,a,lo,n+depth,side)],2)
                # Strong floor edges survive at street LOD; no repeated box at block LOD.
                if id!='office':
                    for row in range(1,rows):
                        yy=v['y']-v['h']/2+row*ch
                        wall(v,side,-span/2,span/2,yy-.065,yy+.065,n+.18,1)
                elif lod==0:
                    for col in range(cols+1):
                        u=-span/2+col*cw;wall(v,side,u-.04,u+.04,v['y']-v['h']/2,v['y']+v['h']/2,n+.12,2)
            # Roof parapets remain wholly inside the certified volume footprint.
            top=v['y']+v['h']/2
            b(v['x'],top-.15,v['z']-v['d']/2+.14,v['w']-.04,.3,.24,1);b(v['x'],top-.15,v['z']+v['d']/2-.14,v['w']-.04,.3,.24,1)
            b(v['x']-v['w']/2+.14,top-.15,v['z'],.24,.3,v['d']-.52,1);b(v['x']+v['w']/2-.14,top-.15,v['z'],.24,.3,v['d']-.52,1)
        # A continuous approach links the frontage to
        # the door. Reuse existing materials, including a blank atlas texel at LOD2.
        doorz=spec['volumes'][0]['z']+spec['volumes'][0]['d']/2
        front=spec['building']['depth']/2-.02
        if lod<3:
            # Clear raised meadow patches (0.1m) plus tangent sag (<0.06m).
            paving=0 if lod<2 else 5
            blank=[(.01,.01)]*4
            def paving_rect(x0,x1,z0,z1,material=paving,y=.2):
                quad([(x0,y,z0),(x0,y,z1),(x1,y,z1),(x1,y,z0)],material,blank)
            paving_rect(-1.2,1.2,doorz+.03,front)
            # Landing wings meet the central approach without coplanar overlap.
            landing=min(front,doorz+1.6)
            paving_rect(-1.9,-1.2,doorz+.03,landing)
            paving_rect(1.2,1.9,doorz+.03,landing)
            if lod<2:
                for i in range(1,int((front-doorz)/2)+1):
                    z=doorz+i*2
                    if z+.015<front:paving_rect(-1.2,1.2,z-.015,z+.015,2,.212)
        if lod<2:
            # Entrance is a 3.2m door at the back of the accessible front recess.
            if id=='residential':doorz=spec['volumes'][0]['z']+spec['volumes'][0]['d']/2
            elif id=='office':doorz=spec['volumes'][0]['z']+spec['volumes'][0]['d']/2
            else:doorz=spec['volumes'][0]['z']+spec['volumes'][0]['d']/2
            door=dict(x=0,y=0,z=0)
            wall(door,0,-1.6,1.6,.05,3.1,doorz+.025,3)
            wall(door,0,-.045,.045,.05,3.1,doorz+.04,2)
            b(0,3.26,doorz+.48,3.8,.18,1,2)
            if lod==0:
                wall(door,0,.8,.84,1,1.65,doorz+.08,2)
        mesh=bpy.data.meshes.new(PREFIX+id+str(lod));mesh.from_pydata(verts,[],faces);mesh.update()
        o=bpy.data.objects.new(id+'_lod'+str(lod),mesh);scene.collection.objects.link(o)
        for m in mats:mesh.materials.append(m)
        layer=mesh.uv_layers.new(name='UVMap')
        for poly,mi,coords in zip(mesh.polygons,indices,uvs):
            poly.material_index=mi
            for loop,uv in zip(poly.loop_indices,coords):layer.data[loop].uv=uv
        mesh.calc_loop_triangles();levels.append({'lod':lod,'triangles':len(mesh.loop_triangles),'materials':len(set(indices))});roots.append(o)
    bpy.ops.object.select_all(action='DESELECT')
    for o in roots:o.select_set(True)
    path=ROOT/'public/assets/buildings'/('city-block-'+id+'.glb')
    bpy.ops.export_scene.gltf(filepath=str(path),export_format='GLB',use_selection=True,use_active_scene=True,export_yup=True,export_animations=False)
    for o in roots:
        if not o.name.endswith('lod0'):o.hide_set(True);o.hide_render=True
    bpy.data.libraries.write(str(ROOT/'assets/blender'/('city-block-'+id+'.blend')),{scene},fake_user=True,compress=True)
    reports.append({'id':id,'bytes':path.stat().st_size,'levels':sorted(levels,key=lambda l:l['lod'])})
bpy.context.window.scene=previous
(ROOT/'assets/blender/city-block-audit.json').write_text(json.dumps(reports,indent=2)+'\n')
result={"buildings":reports}
