"""Metric structural modules for the complete colony; only owns SWCM scene."""
import bpy, json
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2]
previous=bpy.context.window.scene
name='SWCM_colony_modules'
old=bpy.data.scenes.get(name)
if old:
    if old.get('spinward_asset')!='colony-modules-v1':raise RuntimeError('Unowned scene')
    for o in list(old.objects):
        if len(o.users_scene)==1:bpy.data.objects.remove(o,do_unlink=True)
    bpy.data.scenes.remove(old)
scene=bpy.data.scenes.new(name);scene['spinward_asset']='colony-modules-v1';scene.unit_settings.system='METRIC';bpy.context.window.scene=scene
mat=bpy.data.materials.new('SWCM_structure');mat.diffuse_color=(.7,.72,.68,1)
def cube(name,parts):
    objects=[]
    for x,y,z,w,h,d in parts:
        bpy.ops.mesh.primitive_cube_add(size=1,location=(x,-z,y))
        o=bpy.context.object;o.name=name;o.scale=(w,d,h);bpy.ops.object.transform_apply(location=False,rotation=False,scale=True);objects.append(o)
    bpy.ops.object.select_all(action='DESELECT')
    for o in objects:o.select_set(True)
    bpy.context.view_layer.objects.active=objects[0];bpy.ops.object.join();o=bpy.context.object;o.name=name
    scene.cursor.location=(0,0,0);bpy.ops.object.origin_set(type='ORIGIN_CURSOR');o.data.materials.append(mat)
    # Box UVs are explicit per-face, independent of Blender's cube atlas.
    uv=o.data.uv_layers.active or o.data.uv_layers.new()
    for p in o.data.polygons:
        n=p.normal
        for li in p.loop_indices:
            v=o.data.vertices[o.data.loops[li].vertex_index].co
            uv.data[li].uv=((v.y if abs(n.x)>.5 else v.x)+.5,v.z+.5)
    return o
cube('structure',[(0,0,0,1,1,1)])
cube('window_frame',[(-.49,0,.025,.02,1,.05),(.49,0,.025,.02,1,.05),(0,-.49,.025,.96,.02,.05),(0,.49,.025,.96,.02,.05),(0,0,.025,.015,.96,.05)])
cube('canopy',[(0,0,0,1,1,1)])
cube('door',[(0,0,0,1,1,1)])
# A metre-wide balcony section: slab, solid parapet and side returns.
# Local y=0 is the finished deck; z=0 meets the facade. Repeat per dwelling bay.
cube('balcony',[(0,-.06,.48,1,.12,.96),(0,.48,.94,1,.96,.055),(-.4975,.48,.48,.005,.96,.92),(.4975,.48,.48,.005,.96,.92)])
# A single dwelling bay: open metal guard with seven pickets and solid side returns.
# Width alone follows the dwelling pitch; storey height never scales this module.
rail=cube('balcony_rail',[(0,-.06,.48,1,.12,.96),(0,1.04,.94,1,.06,.055),(0,.18,.94,1,.045,.045),
    *[(x,.6,.94,.012,.82,.035) for x in [-.48,-.32,-.16,0,.16,.32,.48]],
    (-.49,.51,.48,.02,1.02,.92),(.49,.51,.48,.02,1.02,.92)])
for uv in list(rail.data.uv_layers):rail.data.uv_layers.remove(uv)
# Unit-rise flight, twelve individual treads; stringers and metric-height guards
# are composed at runtime so handrail height does not stretch with storey height.
flight=cube('stair_flight',[((i+.5)/12-.5,(i+1)/12-.025,0,1/12,.05,1) for i in range(12)])
for uv in list(flight.data.uv_layers):flight.data.uv_layers.remove(uv)
# Sloping fabric awning, with a front valance; x=width, z=projection in runtime.
awning=cube('shop_awning',[(0,0,.5,1,.055,1),(0,-.14,.98,1,.23,.035)])
# Lower the front edge, preserving the back attachment at y=0.
for v in awning.data.vertices:v.co.z+=v.co.y*.16
# A hollow tapered planter. Runtime origin at its centre, unit outer bounds;
# the rim and inner wall survive at the same low detail level as the pot.
verts=[]
for y,extent in [(-.5,.40),(.5,.5),(.5,.43),(-.38,.34)]:
    verts.extend([(x,-z,y) for x,z in [(-extent,-extent),(extent,-extent),(extent,extent),(-extent,extent)]])
faces=[]
for ring in range(3):
    for j in range(4):
        k=(j+1)%4;faces.append((ring*4+j,ring*4+k,(ring+1)*4+k,(ring+1)*4+j))
faces.extend([(12,13,14,15),(3,2,1,0)])
mesh=bpy.data.meshes.new('SWCM_planter');mesh.from_pydata(verts,[],faces);mesh.update()
pot=bpy.data.objects.new('planter',mesh);scene.collection.objects.link(pot);mesh.materials.append(mat)
# Recalculate winding after mapping runtime Y/Z to Blender's axes.
bpy.ops.object.select_all(action='DESELECT');pot.select_set(True);bpy.context.view_layer.objects.active=pot
bpy.ops.object.mode_set(mode='EDIT');bpy.ops.mesh.select_all(action='SELECT');bpy.ops.mesh.normals_make_consistent(inside=False);bpy.ops.object.mode_set(mode='OBJECT')
# Three overlapping low-poly shrub crowns, kept within the pot footprint.
crowns=[]
for x,y,z,w,h,d in [(-.27,.02,0,.55,.8,.92),(.03,.1,.04,.56,1,.86),(.31,-.04,-.03,.48,.7,.82)]:
    bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=2,radius=1,location=(x,-z,y))
    o=bpy.context.object;o.scale=(w/2,d/2,h/2);bpy.ops.object.transform_apply(location=False,rotation=False,scale=True);crowns.append(o)
bpy.ops.object.select_all(action='DESELECT')
for o in crowns:o.select_set(True)
bpy.context.view_layer.objects.active=crowns[0];bpy.ops.object.join();plant=bpy.context.object;plant.name='planting'
scene.cursor.location=(0,0,0);bpy.ops.object.origin_set(type='ORIGIN_CURSOR');plant.data.materials.append(mat)
for axis in range(3):
    lo=min(v.co[axis] for v in plant.data.vertices);hi=max(v.co[axis] for v in plant.data.vertices)
    for v in plant.data.vertices:v.co[axis]=(v.co[axis]-(lo+hi)/2)/(hi-lo)
for polygon in plant.data.polygons:polygon.use_smooth=True
for uv in list(plant.data.uv_layers):plant.data.uv_layers.remove(uv)
# Metric roof equipment with baked vertex colours, no texture fetches. Keeping
# cabinet and grille in one mesh lets all units share a single material/batch.
def colour(o,value):
    attr=o.data.color_attributes.get('Color') or o.data.color_attributes.new(name='Color',type='FLOAT_COLOR',domain='CORNER')
    for datum in attr.data:datum.color=(*value,1)
    for uv in list(o.data.uv_layers):o.data.uv_layers.remove(uv)
    return o
def roof_module(name,objects):
    bpy.ops.object.select_all(action='DESELECT')
    for o in objects:o.select_set(True)
    bpy.context.view_layer.objects.active=objects[0];bpy.ops.object.join();o=objects[0];o.name=name
    scene.cursor.location=(0,0,0);bpy.ops.object.origin_set(type='ORIGIN_CURSOR')
    # Export unit x/z bounds and y=0..1; runtime supplies physical dimensions.
    for axis in range(3):
        lo=min(v.co[axis] for v in o.data.vertices);hi=max(v.co[axis] for v in o.data.vertices)
        for v in o.data.vertices:v.co[axis]=(v.co[axis]-lo)/(hi-lo)-(0 if axis==2 else .5)
    return o
hvac=[colour(cube('SWCM_hvac_case',[(0,.62,0,2.4,.88,1.5),(-.83,.09,0,.18,.18,1.24),(.83,.09,0,.18,.18,1.24)]),(.68,.72,.70))]
hvac.append(colour(cube('SWCM_hvac_grille',[(0,.65,z,2.12,.57,.025) for z in [-.758,.758]]),(.085,.12,.13)))
hvac.append(colour(cube('SWCM_hvac_louvres',[(0,y,z,2.16,.035,.028) for z in [-.777,.777] for y in [.41,.53,.65,.77,.89]]),(.46,.51,.50)))
for x in [-.61,.61]:
    bpy.ops.mesh.primitive_cylinder_add(vertices=16,radius=.48,depth=.035,location=(x,0,1.08))
    fan=bpy.context.object;fan.name='SWCM_hvac_fan';fan.data.materials.append(mat);hvac.append(colour(fan,(.07,.10,.11)))
    hvac.append(colour(cube('SWCM_hvac_guard',[(x,1.125,0,.96,.04,.045),(x,1.125,0,.045,.04,.96)]),(.43,.49,.49)))
roof_module('roof_hvac',hvac)
vent=[colour(cube('SWCM_vent_body',[(0,.06,0,.8,.12,.8),(0,.55,0,.42,.98,.42),(0,1.29,0,.8,.22,.8)]),(.49,.56,.55)),
      colour(cube('SWCM_vent_throat',[(0,1.08,0,.62,.20,.62)]),(.07,.11,.12))]
roof_module('roof_vent',vent)
bpy.ops.object.select_all(action='SELECT')
path=ROOT/'public/assets/buildings/colony-modules.glb'
bpy.ops.export_scene.gltf(filepath=str(path),export_format='GLB',use_selection=True,use_active_scene=True,export_yup=True,export_materials='EXPORT',export_vertex_color='ACTIVE')
bpy.data.libraries.write(str(ROOT/'assets/blender/colony-modules.blend'),{scene},fake_user=True,compress=True)
bpy.context.window.scene=previous
result={'asset':str(path),'bytes':path.stat().st_size,'nodes':[o.name for o in scene.objects]}
