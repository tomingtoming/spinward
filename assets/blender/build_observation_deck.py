"""Original public observation deck. Owns only SWOD_observation_deck.
Runtime coordinates are metres: X tangent, Y inward/up, Z minus axial.
The 58.5 m landmark keeps the existing footprint and overlook-drop clearance.
"""
import bpy, math, sys, json
from pathlib import Path
ROOT = Path(__file__).resolve().parents[2]
sys.dont_write_bytecode = True
sys.path.insert(0, str(ROOT / 'assets/blender'))
from building_mesh_kit import MeshBuilder, local, export

previous = bpy.context.window.scene
name = 'SWOD_observation_deck'
old = bpy.data.scenes.get(name)
if old:
    if old.get('spinward_asset') != 'observation-deck-v1': raise RuntimeError('Unowned scene')
    for obj in list(old.objects):
        if len(obj.users_scene) == 1: bpy.data.objects.remove(obj, do_unlink=True)
    bpy.data.scenes.remove(old)
scene = bpy.data.scenes.new(name)
scene['spinward_asset'] = 'observation-deck-v1'
scene.unit_settings.system = 'METRIC'
bpy.context.window.scene = scene
try:
    material = bpy.data.materials.new('SWOD_surface')
    material.use_nodes = True
    vertex = material.node_tree.nodes.new('ShaderNodeVertexColor'); vertex.layer_name = 'Color'
    material.node_tree.links.new(vertex.outputs['Color'], material.node_tree.nodes.get('Principled BSDF').inputs['Base Color'])
    objects, audit, colliders = [], {}, []
    deck_y, deck_r, deck_n = 58.5, 12, 32
    for lod in range(3):
        b = MeshBuilder(scene, f'observation_deck_lod{lod}', [material])
        colors, color = [], (.53, .56, .54, 1)
        original_face = b.face
        def face(points, mat, uvs=None):
            original_face(points, mat, uvs); colors.append(color)
        b.face = face
        def polygon(points): b.face([local(*p) for p in points], material)
        def record(name, points, ground=False):
            if lod != 0: return
            triangles=[]
            for face in points:
                for i in range(1,len(face)-1):
                    for p in [face[0], face[i], face[i+1]]: triangles.extend(p)
            colliders.append({'name':name,'ground':ground,'vertices':triangles})
        def prism(name, radius0, radius1, y0, y1, n, ground=False):
            side_faces, top_faces = [], []
            for i in range(n):
                a,c=2*math.pi*i/n,2*math.pi*(i+1)/n
                p=lambda r,y,t:(r*math.cos(t),y,r*math.sin(t))
                side_faces.append([p(radius0,y0,a),p(radius1,y1,a),p(radius1,y1,c),p(radius0,y0,c)])
                side_faces.append([(0,y0,0),p(radius0,y0,a),p(radius0,y0,c)])
                top_faces.append([(0,y1,0),p(radius1,y1,c),p(radius1,y1,a)])
            for points in side_faces+top_faces:polygon(points)
            record(name+'-sides',side_faces)
            record(name+'-top',top_faces,ground)
        # Tapered concrete support and deck fascia remain at all LOD levels.
        prism('column',3.05,1.92,0,56.16,8)
        prism('deck',8.64,deck_r,56.16,deck_y,deck_n,True)
        # Visible underside ribs run into both the column and deck, not space.
        if lod < 2:
            color=(.34,.39,.4,1)
            for i in range(8):
                a=i*math.pi/4
                pts=[(1.7,54.8),(1.7,56.35),(9.2,57.0),(8.8,56.2)]
                def p(r,y,w):return (math.cos(a)*r-math.sin(a)*w,y,math.sin(a)*r+math.cos(a)*w)
                for side in [-1,1]:polygon([p(r,y,side*.18) for r,y in (pts if side>0 else pts[::-1])])
                for j in range(4):
                    r,y=pts[j];r2,y2=pts[(j+1)%4]
                    polygon([p(r,y,-.18),p(r2,y2,-.18),p(r2,y2,.18),p(r,y,.18)])
        color=(.19,.24,.25,1)
        # The guard sits inside the common 32-sided floor polygon. Near infill
        # gaps are narrower than the player body; collision has the same span.
        rail_n = 48 if lod == 0 else 24
        if lod < 2:
            for i in range(rail_n):
                a,c=2*math.pi*i/rail_n,2*math.pi*(i+1)/rail_n
                x,z=11.45*math.cos(a),11.45*math.sin(a)
                b.box(x,deck_y+.6,z,.07,1.2,.07,material)
                p0=(x,z);p1=(11.45*math.cos(c),11.45*math.sin(c))
                dx,dz=p1[0]-x,p1[1]-z
                def beam(y,h,d):
                    # Radial end cuts meet exactly at the common corner.
                    # Square segment caps leave a wedge visible at eye distance.
                    points=[(u-math.cos(t)*s*d/2,v,w-math.sin(t)*s*d/2) for (u,w),t in [(p0,a),(p1,c)] for v in [y-h/2,y+h/2] for s in [-1,1]]
                    faces=[[points[k] for k in ids] for ids in [(0,1,3,2),(4,6,7,5),(0,4,5,1),(2,3,7,6),(0,2,6,4),(1,5,7,3)]]
                    for f in faces:polygon(f)
                    return faces
                beam(deck_y+1.18,.07,.085);beam(deck_y+.13,.05,.06)
                if lod==0:
                    for j in range(1,6):b.box(x+dx*j/6,deck_y+.65,z+dz*j/6,.035,1.02,.035,material)
                    # Full-height collision proxy; a body cannot pass the infill.
                    start=len(b.vertices)
                    faces=beam(deck_y+.61,1.22,.085)
                    # Discard the proxy's visual faces; retain only its collision.
                    del b.vertices[start:];del b.faces[-6:];del b.indices[-6:];del b.uvs[-6:];del colors[-6:]
                    record(f'guard-{i}',faces)
        obj=b.finish()
        for uv in list(obj.data.uv_layers):obj.data.uv_layers.remove(uv)
        attr=obj.data.color_attributes.new(name='Color',type='FLOAT_COLOR',domain='CORNER')
        for poly,col in zip(obj.data.polygons,colors):
            for loop in poly.loop_indices:attr.data[loop].color=col
        obj.data.color_attributes.active_color=attr
        objects.append(obj);audit[obj.name]=len(obj.data.loop_triangles)
    export(scene,objects,ROOT/'public/assets/observation-deck.glb')
    bpy.data.libraries.write(str(ROOT/'assets/blender/observation-deck.blend'),{scene})
    data={'origin':'ai','created':'2026-09-13','height':deck_y,'radius':deck_r,'railHeight':1.22,'triangles':audit,'colliders':colliders}
    (ROOT/'src/objects/observationDeckGeometry.json').write_text(json.dumps(data,separators=(',',':'))+'\n')
    result={k:v for k,v in data.items() if k!='colliders'}
    result['collisionParts']=len(colliders)
finally:
    bpy.context.window.scene=previous
