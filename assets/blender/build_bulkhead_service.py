"""Shared, human-scale end-wall service bay. No reference image geometry.

Blender X=right, Z=up, -Y=out from the pressure wall. Exported GLB is Y-up.
Door: approximately 1.0 x 2.3m, rail: 1.1m, platform: 2.6m deep. Nothing scales per colony.
"""
import bpy, math
from pathlib import Path

def build(target, export):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    materials=[]
    for name, colour in [('steel',(.28,.36,.38,1)),('panel',(.48,.51,.47,1)),('dark',(.08,.12,.14,1)),('edge',(.64,.56,.37,1)),('lamp',(.76,.73,.58,1))]:
        m=bpy.data.materials.new(name);m.diffuse_color=colour;m.use_nodes=True
        node=m.node_tree.nodes.get('Principled BSDF');node.inputs['Base Color'].default_value=colour;node.inputs['Roughness'].default_value=.82
        materials.append(m)
    counts={}
    for lod in [0,1]:
        parts=[]
        def box(name, xyz, size, material):
            bpy.ops.mesh.primitive_cube_add(size=1,location=xyz);o=bpy.context.object;o.name=name
            o.dimensions=size;bpy.ops.object.transform_apply(location=False,rotation=False,scale=True)
            o.data.materials.append(materials[material]);parts.append(o);return o
        def pipe(x,y,z,length,radius,axis='X'):
            bpy.ops.mesh.primitive_cylinder_add(vertices=8 if lod==0 else 6,radius=radius,depth=length,location=(x,y,z))
            o=bpy.context.object
            if axis=='X':o.rotation_euler[1]=math.pi/2
            o.data.materials.append(materials[0]);parts.append(o)
        box('mounted_frame',(0,-.16,3.5),(18,.32,7),0)
        box('inset_panel',(0,-.34,3.5),(17.6,.16,6.6),1)
        box('service_door',(-6.7,-.47,1.15),(1.04,.12,2.3),2)
        for x in [-7.25,-6.15]:box('door_jamb',(x,-.54,1.16),(.10,.16,2.32),3)
        box('door_header',(-6.7,-.54,2.34),(1.20,.16,.12),3)
        box('vent_recess',(2,-.48,3.65),(7.6,.15,3.0),2)
        for i in range(7 if lod==0 else 3):
            box('louvre',(2,-.62,2.45+i*(.4 if lod==0 else 1.15)),(7.4,.22,.14 if lod==0 else .25),0)
        box('walkway',(0,-1.30,-.10),(18,2.6,.20),0)
        for x in [-8,-4,0,4,8]:
            brace=box('wall_bracket',(x,-.8,-.65),(.14,1.75,.14),0);brace.rotation_euler[0]=-.65
            box('bracket_wall_foot',(x,-.03,-1.17),(.28,.18,.30),0)
        for x in [-8.9,8.9]:box('side_rail',(x,-1.35,1.1),(.07,2.45,.07),0)
        box('handrail',(0,-2.55,1.1),(18,.07,.07),0)
        if lod==0:
            box('knee_rail',(0,-2.55,.55),(18,.045,.045),0)
            for x in range(-9,10,2):box('rail_post',(x,-2.55,.55),(.065,.065,1.1),0)
            for z in [5.4,5.8]:
                pipe(0,-.60,z,17.2,.13)
                for x in [-8,-4,0,4,8]:box('pipe_clamp',(x,-.50,z),(.13,.5,.43),3)
            box('door_handle',(-6.32,-.6,1.08),(.045,.10,.28),3)
        else:
            for x in [-9,-3,3,9]:box('rail_post',(x,-2.55,.55),(.09,.09,1.1),0)
            pipe(0,-.60,5.6,17.2,.19)
        for x in [-6.7,6.6]:
            box('lamp_bracket',(x,-.55,3.0),(1.0,.4,.22),0)
            box('lamp',(x,-.78,2.96),(.75,.08,.12),4)
        bpy.ops.object.select_all(action='DESELECT')
        for o in parts:o.select_set(True)
        bpy.context.view_layer.objects.active=parts[0];bpy.ops.object.join();o=bpy.context.object
        o.name='bulkhead_service_lod'+str(lod)
        bpy.ops.object.transform_apply(location=True,rotation=True,scale=True)
        o.data.calc_loop_triangles();counts[o.name]=len(o.data.loop_triangles)
    Path(target).parent.mkdir(parents=True,exist_ok=True);Path(export).parent.mkdir(parents=True,exist_ok=True)
    bpy.ops.wm.save_as_mainfile(filepath=str(target),compress=True)
    bpy.ops.export_scene.gltf(filepath=str(export),export_format='GLB',export_yup=True,export_animations=False,export_cameras=False,export_lights=False)
    return dict(blend=str(target),glb=str(export),triangles=counts)
