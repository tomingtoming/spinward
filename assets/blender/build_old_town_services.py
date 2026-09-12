"""Original metric Old Town services. Owns only the SWOT_services scene.

Runtime frame: x across facade, y up, z out. Modules export x/z centred,
y=0..1; physical dimensions are supplied by oldTownBlockPlan.ts.
"""
import bpy
from pathlib import Path
ROOT = Path(__file__).resolve().parents[2]
previous = bpy.context.window.scene
name = 'SWOT_services'
old = bpy.data.scenes.get(name)
if old:
    if old.get('spinward_asset') != 'old-town-services-v1':
        raise RuntimeError('Unowned scene')
    for obj in list(old.objects):
        if len(obj.users_scene) == 1:
            bpy.data.objects.remove(obj, do_unlink=True)
    bpy.data.scenes.remove(old)
scene = bpy.data.scenes.new(name)
scene['spinward_asset'] = 'old-town-services-v1'
scene.unit_settings.system = 'METRIC'
bpy.context.window.scene = scene
mat = bpy.data.materials.new('SWOT_vertex_colour')
mat.diffuse_color = (1, 1, 1, 1)
counts = {}

def colour(obj, rgb):
    obj.data.materials.clear()
    obj.data.materials.append(mat)
    attr = obj.data.color_attributes.new(name='Color', type='FLOAT_COLOR', domain='CORNER')
    for item in attr.data:
        item.color = (*rgb, 1)
    for uv in list(obj.data.uv_layers):
        obj.data.uv_layers.remove(uv)
    return obj

def box(x, y, z, w, h, d, rgb):
    bpy.ops.mesh.primitive_cube_add(size=1, location=(x, -z, y))
    obj = bpy.context.object
    obj.scale = (w, d, h)
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    return colour(obj, rgb)

def cylinder(x, y, z, radius, height, rgb, vertices=16):
    bpy.ops.mesh.primitive_cylinder_add(vertices=vertices, radius=radius, depth=height, location=(x, -z, y))
    return colour(bpy.context.object, rgb)

def module(name, objects):
    bpy.ops.object.select_all(action='DESELECT')
    for obj in objects:
        obj.select_set(True)
    bpy.context.view_layer.objects.active = objects[0]
    bpy.ops.object.join()
    obj = objects[0]
    obj.name = name
    scene.cursor.location = (0, 0, 0)
    bpy.ops.object.origin_set(type='ORIGIN_CURSOR')
    for axis in range(3):
        lo = min(v.co[axis] for v in obj.data.vertices)
        hi = max(v.co[axis] for v in obj.data.vertices)
        for v in obj.data.vertices:
            v.co[axis] = (v.co[axis] - lo) / (hi - lo) - (0 if axis == 2 else .5)
    obj.data.calc_loop_triangles()
    counts[name] = len(obj.data.loop_triangles)

metal = (.24, .29, .28)
concrete = (.40, .39, .33)
tank = (.69, .70, .61)
objects = [box(x, .18, z, .35, .36, .4, concrete) for x in [-.7, .7] for z in [-.65, .65]]
objects += [box(x, .56, z, .10, .55, .10, metal) for x in [-.7, .7] for z in [-.65, .65]]
objects += [box(0, .74, z, 1.65, .14, .12, metal) for z in [-.65, .65]]
objects += [cylinder(0, 1.85, 0, .95, 2.1, tank), cylinder(0, 2.95, 0, 1.0, .12, metal), cylinder(0, 3.06, 0, .28, .10, metal)]
objects += [cylinder(0, y, 0, .965, .07, metal) for y in [1.12, 2.52]]
# Outlet meets roof; ladder bolts to the tank and ends at the inspection hatch.
objects += [box(.55, .44, 0, .10, .88, .10, metal)]
objects += [box(x, 1.53, 1.06, .055, 3.06, .055, metal) for x in [-.24, .24]]
objects += [box(0, y, 1.06, .48, .035, .055, metal) for y in [.3, .6, .9, 1.2, 1.5, 1.8, 2.1, 2.4, 2.7]]
objects += [box(x, y, .98, .05, .05, .19, metal) for x in [-.24, .24] for y in [.9, 2.6]]
module('water_tank', objects)

# Distant silhouette: retain the round vessel, support feet and the same
# original bounds. Avoid turning a cylindrical tank into a cuboid at LOD change.
objects = [box(x, .39, z, .35, .78, .4, metal) for x in [-.7, .7] for z in [-.65, .65]]
objects += [cylinder(0, 1.85, 0, .95, 2.1, tank, 12), cylinder(0, 2.95, 0, 1.0, .12, metal, 12), cylinder(0, 3.06, 0, .28, .10, metal, 8)]
# Match the close model's ladder extremity without its individual rungs.
objects += [box(0, 1.53, 1.06, .055, 3.06, .055, metal)]
module('water_tank_lod', objects)

objects = [box(x, .17, 0, .38, .34, 1.85, concrete) for x in [-1, 1]]
objects += [box(0, 1.23, 0, 2.8, 1.8, 1.9, (.50, .57, .54)), box(0, 2.16, 0, 2.9, .12, 2, metal)]
objects += [box(x, 1.23, z, .065, 1.85, .045, metal) for x in [-1.3, -.45, .45, 1.3] for z in [-.97, .97]]
objects += [box(0, .55, .93, 2.85, .065, .09, metal), box(0, 2.28, 0, .6, .12, .6, metal)]
module('header_tank', objects)

objects = [box(0, .29, 0, 1.05, .58, .24, (.39, .45, .43))]
for x in [-.32, 0, .32]:
    objects += [box(x, .32, .13, .27, .41, .035, (.65, .64, .55)), box(x, .41, .154, .18, .12, .02, (.045, .065, .06)), box(x+.075, .22, .16, .025, .06, .02, metal)]
objects += [box(0, .615, 0, 1.1, .05, .30, metal)]
module('meter_bank', objects)

objects = [box(x, .10, 0, .44, .2, 1.3, concrete) for x in [-1.36, 1.36]]
objects += [box(x, 1, 0, .055, 1.8, .055, metal) for x in [-1.36, 1.36]]
objects += [box(x, 1.87, 0, .045, .045, 1.2, metal) for x in [-1.36, 1.36]]
objects += [box(0, 1.87, z, 2.72, .015, .015, metal) for z in [-.44, .44]]
for x, y, h, rgb in [(-.85, 1.38, .94, (.71, .64, .50)), (-.14, 1.22, 1.26, (.66, .73, .70)), (.70, 1.42, .86, (.29, .40, .43))]:
    # A folded textile has actual thickness; every top meets its clothesline.
    objects += [box(x, y, .44, .58, h, .018, rgb)]
    objects += [box(x + dx, 1.88, .44, .025, .06, .035, (.38, .31, .21)) for dx in [-.2, .2]]
module('laundry', objects)

# A shallow folded-metal service canopy, supported by two wall brackets.
# Front is +Z, like the meter bank; runtime turns both towards the rear yard.
objects = [box(0, .225, 0, 1.5, .03, .72, (.43, .46, .38)),
           box(0, .185, .35, 1.5, .08, .02, metal),
           box(0, .13, -.35, 1.5, .22, .02, metal)]
for x in [-.55, .55]:
    objects += [box(x, .11, -.30, .045, .22, .08, metal),
                box(x, .17, -.03, .045, .04, .60, metal)]
module('entry_canopy', objects)

# Roof access rooms have a human-size closed door and a projecting coping.
# Their reduced meshes retain exactly the same metric bounds and silhouette.
def stair_shell():
    return [box(0, 1.36, 0, 2.8, 2.72, 3.6, (.58, .58, .50)),
            box(0, 2.81, 0, 3, .18, 3.8, (.30, .36, .34))]
objects = stair_shell()
objects += [box(0, 1.09, 1.81, 1.04, 2.18, .06, metal),
            box(0, 1.04, 1.85, .90, 2.08, .04, (.29, .38, .36)),
            box(.32, 1.06, 1.88, .035, .18, .025, (.65, .66, .57)),
            box(0, .16, 1.82, 1.1, .08, .15, concrete)]
# A shallow ventilation grille on a side wall, with a physical frame.
objects += [box(1.41, 2.06, -.8, .035, .52, .70, metal)]
objects += [box(1.435, y, -.8, .025, .045, .64, (.39, .46, .43)) for y in [1.87, 1.97, 2.07, 2.17, 2.27]]
module('roof_stairwell', objects)
module('roof_stairwell_lod', stair_shell())

def plant_shell():
    return [box(0, 1.125, 0, 4, 2.25, 3, (.40, .47, .45)),
            box(0, 2.34, 0, 4.4, .18, 3.2, metal),
            box(.9, 2.58, -.2, 1.1, .30, 1.8, (.30, .34, .31))]
objects = plant_shell()
objects += [box(-1.05, 1.06, 1.51, 1.04, 2.12, .06, metal),
            box(-1.05, 1.015, 1.55, .90, 2.03, .035, (.43, .49, .46)),
            box(-.73, 1.04, 1.58, .035, .18, .025, (.65, .66, .57)),
            box(.65, 1.2, 1.53, 1.9, 1.55, .08, (.14, .20, .19))]
objects += [box(.65, y, 1.575, 1.82, .055, .025, (.34, .42, .39)) for y in [.58, .78, .98, 1.18, 1.38, 1.58, 1.78, 1.88]]
module('roof_plant_room', objects)
module('roof_plant_room_lod', plant_shell())

try:
    bpy.ops.object.select_all(action='SELECT')
    path = ROOT / 'public/assets/buildings/old-town-services.glb'
    bpy.ops.export_scene.gltf(filepath=str(path), export_format='GLB', use_selection=True,
        use_active_scene=True, export_yup=True, export_materials='EXPORT', export_vertex_color='ACTIVE')
    bpy.data.libraries.write(str(ROOT / 'assets/blender/old-town-services.blend'), {scene}, fake_user=True, compress=True)
    result = {'asset': str(path), 'bytes': path.stat().st_size, 'triangles': counts}
finally:
    bpy.context.window.scene = previous
