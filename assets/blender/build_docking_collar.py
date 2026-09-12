"""Metric civilian docking collar; owns only SWDC_docking_collar.
Runtime X/Y span the mounting face, +Z points out from it. No habitat scaling.
"""
import bpy, math, sys, json
from pathlib import Path
ROOT = Path(__file__).resolve().parents[2]
sys.dont_write_bytecode = True
sys.path.insert(0, str(ROOT / 'assets/blender'))
from building_mesh_kit import MeshBuilder, local, export

previous = bpy.context.window.scene
name = 'SWDC_docking_collar'
old = bpy.data.scenes.get(name)
if old:
    if old.get('spinward_asset') != 'docking-collar-v1':
        raise RuntimeError('Unowned scene')
    for obj in list(old.objects):
        if len(obj.users_scene) == 1: bpy.data.objects.remove(obj, do_unlink=True)
    bpy.data.scenes.remove(old)
scene = bpy.data.scenes.new(name)
scene['spinward_asset'] = 'docking-collar-v1'
scene.unit_settings.system = 'METRIC'
bpy.context.window.scene = scene
try:
    material = bpy.data.materials.new('SWDC_metal')
    material.diffuse_color = (.56, .6, .61, 1)
    material.use_nodes = True
    vertex = material.node_tree.nodes.new('ShaderNodeVertexColor')
    vertex.layer_name = 'Color'
    material.node_tree.links.new(vertex.outputs['Color'],material.node_tree.nodes.get('Principled BSDF').inputs['Base Color'])
    objects, audit = [], {}
    for lod, segments in [(0, 20), (1, 10)]:
        b = MeshBuilder(scene, 'docking_collar_lod'+str(lod), [material])
        colors, color = [], (.56, .60, .61, 1)
        original_face = b.face
        def face(points, material, uvs=None):
            original_face(points, material, uvs)
            colors.append(color)
        b.face = face
        def ring(z0, z1, outer0, outer1, inner):
            for i in range(segments):
                a, c = 2*math.pi*i/segments, 2*math.pi*(i+1)/segments
                def p(r,z,t): return local(r*math.cos(t), r*math.sin(t), z)
                for points in [
                    [p(outer0,z0,a),p(outer0,z0,c),p(outer1,z1,c),p(outer1,z1,a)],
                    [p(inner,z0,c),p(inner,z0,a),p(inner,z1,a),p(inner,z1,c)],
                    [p(outer1,z1,a),p(outer1,z1,c),p(inner,z1,c),p(inner,z1,a)],
                    [p(outer0,z0,c),p(outer0,z0,a),p(inner,z0,a),p(inner,z0,c)]
                ]: b.face(points, material)
        # Back plate, pressure trunk, front support flange and compressible seal.
        ring(0,.18,1.65,1.65,.76)
        ring(.18,1.94,1.15,.96,.76)
        ring(1.94,2.2,1.22,1.22,.76)
        color = (.08,.105,.115,1)
        ring(2.2,2.4,.98,.98,.76)
        # Four actuator housings are anchored across the flange and trunk.
        color = (.3,.36,.38,1)
        for i in range(4):
            a=i*math.pi/2
            b.box(math.cos(a)*1.12,math.sin(a)*1.12,1.75,.27,.27,.9,material)
        # Closed berth door behind the throat. Opening is not simulated.
        color = (.18,.23,.25,1)
        for i in range(segments):
            a,c=2*math.pi*i/segments,2*math.pi*(i+1)/segments
            b.face([local(0,0,.03),local(.76*math.cos(a),.76*math.sin(a),.03),local(.76*math.cos(c),.76*math.sin(c),.03)],material)
        obj=b.finish()
        for uv in list(obj.data.uv_layers): obj.data.uv_layers.remove(uv)
        attr=obj.data.color_attributes.new(name='Color',type='FLOAT_COLOR',domain='CORNER')
        for poly,c in zip(obj.data.polygons,colors):
            for loop in poly.loop_indices: attr.data[loop].color=c
        obj.data.color_attributes.active_color=attr
        objects.append(obj)
        audit[obj.name]=len(obj.data.loop_triangles)
    export(scene,objects,ROOT/'public/assets/docking-collar.glb')
    bpy.data.libraries.write(str(ROOT/'assets/blender/docking-collar.blend'),{scene})
    result={'origin':'ai','created':'2026-09-13','triangles':audit,'width':3.3,'depth':2.4,'throatDiameter':1.52}
    (ROOT/'assets/blender/docking-collar-audit.json').write_text(json.dumps(result,indent=2)+'\n')
finally:
    bpy.context.window.scene=previous
