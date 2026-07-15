"""Build Spinward's instanced Japanese streetscape kit and export its GLB.

Run inside Blender (the MCP CLI tool does this in CI/development). Meshes are
normalized again by buildingAssets.ts, so this file authors proportions in a
unit footprint while keeping Blender's Z-up convention.
"""

from __future__ import annotations

import math
from pathlib import Path

import bpy


ROOT = Path(__file__).resolve().parents[2]
BLEND_PATH = ROOT / "assets" / "blender" / "spinward-buildings.blend"
GLB_PATH = ROOT / "public" / "assets" / "buildings" / "spinward-buildings.glb"
COLLECTION_NAME = "SPINWARD_BUILDINGS"
ASSET_NAMES = {
    f"{archetype}_a_lod{lod}"
    for archetype in ("house", "residential", "slab", "tower")
    for lod in (0, 1)
}


def material(name: str, color: tuple[float, float, float, float], metallic: float = 0.0):
    value = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    value.diffuse_color = color
    value.metallic = metallic
    value.roughness = 0.72
    return value


def move_to_collection(obj: bpy.types.Object, collection: bpy.types.Collection):
    for owner in list(obj.users_collection):
        owner.objects.unlink(obj)
    collection.objects.link(obj)


def add_box(
    parts: list[bpy.types.Object],
    collection: bpy.types.Collection,
    name: str,
    size: tuple[float, float, float],
    location: tuple[float, float, float],
    mat: bpy.types.Material,
    bevel: float = 0.0,
):
    bpy.ops.mesh.primitive_cube_add(location=location)
    obj = bpy.context.object
    assert obj is not None
    obj.name = name
    obj.dimensions = size
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    if bevel > 0:
        modifier = obj.modifiers.new("edge_softening", "BEVEL")
        modifier.width = bevel
        modifier.segments = 1
        bpy.context.view_layer.objects.active = obj
        bpy.ops.object.modifier_apply(modifier=modifier.name)
    obj.data.materials.append(mat)
    move_to_collection(obj, collection)
    parts.append(obj)
    return obj


def add_cylinder(
    parts: list[bpy.types.Object],
    collection: bpy.types.Collection,
    name: str,
    radius: float,
    depth: float,
    location: tuple[float, float, float],
    mat: bpy.types.Material,
    vertices: int = 8,
    rotation: tuple[float, float, float] = (0.0, 0.0, 0.0),
):
    bpy.ops.mesh.primitive_cylinder_add(
        vertices=vertices,
        radius=radius,
        depth=depth,
        location=location,
        rotation=rotation,
    )
    obj = bpy.context.object
    assert obj is not None
    obj.name = name
    obj.data.materials.append(mat)
    move_to_collection(obj, collection)
    parts.append(obj)
    return obj


def add_pyramid_roof(
    parts: list[bpy.types.Object],
    collection: bpy.types.Collection,
    size: tuple[float, float],
    base_z: float,
    height: float,
    mat: bpy.types.Material,
):
    bpy.ops.mesh.primitive_cone_add(
        vertices=4,
        radius1=math.sqrt(0.5),
        radius2=0,
        depth=height,
        location=(0, 0, base_z + height * 0.5),
        rotation=(0, 0, math.pi * 0.25),
    )
    roof = bpy.context.object
    assert roof is not None
    roof.name = "hipped_roof"
    roof.dimensions = (size[0], size[1], height)
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    roof.data.materials.append(mat)
    move_to_collection(roof, collection)
    parts.append(roof)


def add_balcony_ring(
    parts: list[bpy.types.Object],
    collection: bpy.types.Collection,
    z: float,
    width: float,
    depth: float,
    trim: bpy.types.Material,
    detailed: bool,
):
    add_box(parts, collection, "balcony_slab", (width + 0.08, depth + 0.08, 0.018), (0, 0, z), trim)
    if not detailed:
        return

    rail_z = z + 0.045
    for y in (-depth * 0.5 - 0.05, depth * 0.5 + 0.05):
        add_box(parts, collection, "balcony_rail", (width + 0.08, 0.012, 0.018), (0, y, rail_z + 0.035), trim)
        for index in range(7):
            x = -width * 0.48 + index * width * 0.16
            add_box(parts, collection, "balcony_post", (0.01, 0.012, 0.085), (x, y, rail_z), trim)
    for x in (-width * 0.5 - 0.05, width * 0.5 + 0.05):
        add_box(parts, collection, "balcony_rail", (0.012, depth + 0.08, 0.018), (x, 0, rail_z + 0.035), trim)
        for index in range(6):
            y = -depth * 0.46 + index * depth * 0.184
            add_box(parts, collection, "balcony_post", (0.012, 0.01, 0.085), (x, y, rail_z), trim)


def add_ac_unit(
    parts: list[bpy.types.Object],
    collection: bpy.types.Collection,
    axis: str,
    side: int,
    along: float,
    z: float,
    width: float,
    depth: float,
    trim: bpy.types.Material,
):
    if axis == "y":
        center = (along, side * (depth * 0.5 + 0.035), z)
        add_box(parts, collection, "outdoor_ac", (0.12, 0.055, 0.075), center, trim, 0.006)
        add_cylinder(
            parts,
            collection,
            "ac_fan",
            0.024,
            0.008,
            (along, side * (depth * 0.5 + 0.066), z),
            trim,
            8,
            (math.pi * 0.5, 0, 0),
        )
    else:
        center = (side * (width * 0.5 + 0.035), along, z)
        add_box(parts, collection, "outdoor_ac", (0.055, 0.12, 0.075), center, trim, 0.006)
        add_cylinder(
            parts,
            collection,
            "ac_fan",
            0.024,
            0.008,
            (side * (width * 0.5 + 0.066), along, z),
            trim,
            8,
            (0, math.pi * 0.5, 0),
        )


def join_asset(parts: list[bpy.types.Object], name: str):
    bpy.ops.object.select_all(action="DESELECT")
    for part in parts:
        part.select_set(True)
    bpy.context.view_layer.objects.active = parts[0]
    bpy.ops.object.join()
    obj = bpy.context.object
    assert obj is not None
    obj.name = name
    obj.data.name = f"{name}_mesh"
    bpy.ops.object.origin_set(type="ORIGIN_GEOMETRY", center="BOUNDS")
    return obj


def build_house(collection, facade, trim, sign, detailed: bool):
    parts: list[bpy.types.Object] = []
    add_box(parts, collection, "house_body", (0.78, 0.7, 0.68), (0, 0, 0.34), facade, 0.012)
    add_pyramid_roof(parts, collection, (0.9, 0.82), 0.68, 0.24, trim)
    add_box(parts, collection, "entry_awning", (0.44, 0.1, 0.025), (0.05, -0.39, 0.22), trim)
    add_box(parts, collection, "nameplate", (0.105, 0.025, 0.14), (0.3, -0.365, 0.34), sign)
    if detailed:
        for x, y in ((-0.33, -0.29), (0.33, 0.29)):
            add_cylinder(parts, collection, "downpipe", 0.011, 0.63, (x, y, 0.34), trim, 7)
        add_ac_unit(parts, collection, "y", 1, -0.2, 0.24, 0.78, 0.7, trim)
        add_ac_unit(parts, collection, "x", -1, 0.18, 0.48, 0.78, 0.7, trim)
        # Window security bars: large enough to survive LOD0, omitted entirely
        # from LOD1 where they would only shimmer.
        for x in (-0.16, -0.08, 0, 0.08, 0.16):
            add_box(parts, collection, "window_grille", (0.008, 0.018, 0.15), (x, -0.362, 0.48), trim)
        add_box(parts, collection, "window_grille", (0.38, 0.018, 0.008), (0, -0.362, 0.43), trim)
        add_box(parts, collection, "window_grille", (0.38, 0.018, 0.008), (0, -0.362, 0.53), trim)
    return join_asset(parts, f"house_a_lod{0 if detailed else 1}")


def build_residential(collection, facade, trim, sign, detailed: bool):
    parts: list[bpy.types.Object] = []
    width, depth = 0.8, 0.7
    add_box(parts, collection, "residential_body", (width, depth, 0.9), (0, 0, 0.45), facade, 0.012)
    add_box(parts, collection, "parapet", (0.84, 0.74, 0.035), (0, 0, 0.91), trim)
    add_box(parts, collection, "shop_awning", (0.7, 0.09, 0.024), (0, -0.395, 0.17), trim)
    add_box(parts, collection, "vertical_sign", (0.1, 0.035, 0.42), (0.45, -0.23, 0.42), sign)
    for z in (0.3, 0.48, 0.66, 0.84):
        add_balcony_ring(parts, collection, z, width, depth, trim, detailed)
    if detailed:
        for x, y in ((-0.35, -0.3), (0.35, 0.3)):
            add_cylinder(parts, collection, "downpipe", 0.012, 0.86, (x, y, 0.45), trim, 7)
        add_ac_unit(parts, collection, "y", 1, -0.22, 0.39, width, depth, trim)
        add_ac_unit(parts, collection, "y", -1, 0.2, 0.57, width, depth, trim)
        add_ac_unit(parts, collection, "x", -1, 0.12, 0.75, width, depth, trim)
        add_box(parts, collection, "roof_stair", (0.24, 0.2, 0.1), (-0.16, 0.08, 0.97), trim)
    return join_asset(parts, f"residential_a_lod{0 if detailed else 1}")


def build_slab(collection, facade, trim, sign, detailed: bool):
    parts: list[bpy.types.Object] = []
    add_box(parts, collection, "slab_podium", (0.96, 0.9, 0.24), (0, 0, 0.12), facade, 0.012)
    add_box(parts, collection, "podium_canopy", (0.99, 0.93, 0.025), (0, 0, 0.255), trim)
    add_box(parts, collection, "apartment_bar", (0.72, 0.72, 0.7), (0.08, 0, 0.62), facade, 0.012)
    add_box(parts, collection, "vertical_sign", (0.11, 0.035, 0.48), (-0.42, -0.47, 0.37), sign)
    for z in (0.4, 0.56, 0.72, 0.88):
        add_balcony_ring(parts, collection, z, 0.72, 0.72, trim, detailed)
    add_box(parts, collection, "roof_cap", (0.78, 0.78, 0.035), (0.08, 0, 0.985), trim)
    if detailed:
        # Rear exterior corridor and stair landing.
        add_box(parts, collection, "exterior_corridor", (0.68, 0.1, 0.025), (0.08, 0.41, 0.34), trim)
        for x in (-0.2, 0.0, 0.2, 0.4):
            add_box(parts, collection, "corridor_post", (0.012, 0.012, 0.11), (x, 0.46, 0.39), trim)
        for x, y in ((-0.23, -0.31), (0.38, 0.31)):
            add_cylinder(parts, collection, "downpipe", 0.012, 0.66, (x, y, 0.62), trim, 7)
        add_ac_unit(parts, collection, "y", 1, -0.12, 0.49, 0.72, 0.72, trim)
        add_ac_unit(parts, collection, "y", -1, 0.28, 0.68, 0.72, 0.72, trim)
        for x in (-0.12, 0.15, 0.35):
            add_box(parts, collection, "roof_hvac", (0.13, 0.11, 0.09), (x, 0.02, 1.035), trim, 0.006)
    return join_asset(parts, f"slab_a_lod{0 if detailed else 1}")


def build_tower(collection, facade, trim, sign, detailed: bool):
    del sign
    parts: list[bpy.types.Object] = []
    width, depth = 0.66, 0.66
    add_box(parts, collection, "tower_shaft", (width, depth, 0.93), (0, 0, 0.465), facade, 0.014)
    for z in (0.17, 0.31, 0.45, 0.59, 0.73, 0.87):
        add_balcony_ring(parts, collection, z, width, depth, trim, detailed)
    add_box(parts, collection, "tower_roof", (0.73, 0.73, 0.035), (0, 0, 0.945), trim)
    add_box(parts, collection, "roof_core", (0.24, 0.22, 0.09), (0.06, 0.02, 0.985), trim)
    if detailed:
        for x, y in ((-0.29, -0.29), (0.29, 0.29)):
            add_cylinder(parts, collection, "tower_downpipe", 0.011, 0.86, (x, y, 0.47), trim, 7)
        add_ac_unit(parts, collection, "y", 1, -0.17, 0.37, width, depth, trim)
        add_ac_unit(parts, collection, "x", 1, 0.16, 0.65, width, depth, trim)
        # Rooftop safety cage seen from the elevated road.
        for x in (-0.22, 0.22):
            add_box(parts, collection, "roof_fence", (0.012, 0.5, 0.11), (x, 0, 1.015), trim)
        for y in (-0.22, 0.22):
            add_box(parts, collection, "roof_fence", (0.5, 0.012, 0.11), (0, y, 1.015), trim)
    return join_asset(parts, f"tower_a_lod{0 if detailed else 1}")


def build():
    scene = bpy.context.scene
    scene.unit_settings.system = "METRIC"
    scene.unit_settings.scale_length = 1.0

    for obj in list(bpy.data.objects):
        if obj.name in ASSET_NAMES or any(obj.name.startswith(f"{name}.") for name in ASSET_NAMES):
            bpy.data.objects.remove(obj, do_unlink=True)

    old_collection = bpy.data.collections.get(COLLECTION_NAME)
    if old_collection is not None:
        bpy.data.collections.remove(old_collection)
    collection = bpy.data.collections.new(COLLECTION_NAME)
    scene.collection.children.link(collection)

    facade = material("SPW_FACADE", (0.32, 0.39, 0.48, 1.0))
    trim = material("SPW_ROOF_TRIM", (0.12, 0.17, 0.22, 1.0), 0.16)
    sign = material("SPW_SIGN", (0.28, 0.12, 0.08, 1.0), 0.05)

    assets = []
    for builder in (build_house, build_residential, build_slab, build_tower):
        assets.append(builder(collection, facade, trim, sign, True))
        assets.append(builder(collection, facade, trim, sign, False))

    bpy.ops.object.select_all(action="DESELECT")
    for obj in assets:
        obj.select_set(True)
    bpy.context.view_layer.objects.active = assets[0]

    GLB_PATH.parent.mkdir(parents=True, exist_ok=True)
    bpy.ops.wm.save_as_mainfile(filepath=str(BLEND_PATH))
    bpy.ops.export_scene.gltf(
        filepath=str(GLB_PATH),
        export_format="GLB",
        use_selection=True,
        export_apply=True,
        export_yup=True,
        export_materials="EXPORT",
    )

    # Blender creates a .blend1 backup when replacing the generated source.
    # It is useful for hand-authored scenes, but this file is reproducible from
    # this script and the backup would only become an untracked build artifact.
    backup_path = BLEND_PATH.with_suffix(".blend1")
    backup_path.unlink(missing_ok=True)

    return {
        "blend": str(BLEND_PATH),
        "glb": str(GLB_PATH),
        "assets": {
            obj.name: {
                "vertices": len(obj.data.vertices),
                "triangles": len(obj.data.loop_triangles),
                "materials": [slot.material.name for slot in obj.material_slots if slot.material],
            }
            for obj in assets
        },
    }


if __name__ == "__main__":
    build()
