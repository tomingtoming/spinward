"""Visible rectangles on the union of axis-aligned architectural masses.

Blender-free geometry so the ownership and clipping rules can be checked
against the metric contracts before exporting a mesh.
"""
EPSILON = 1e-6


def subtract_rectangle(rect, cover):
    x0, x1, y0, y1 = rect
    a, b = max(x0, cover[0]), min(x1, cover[1])
    c, d = max(y0, cover[2]), min(y1, cover[3])
    if b - a <= EPSILON or d - c <= EPSILON:
        return [rect]
    return [r for r in [(x0, a, y0, y1), (b, x1, y0, y1),
                         (a, b, y0, c), (a, b, d, y1)]
            if r[1] - r[0] > EPSILON and r[3] - r[2] > EPSILON]


def visible_wall_rectangles(volumes, own_index, side, rect):
    own = volumes[own_index]
    normal_axis, normal_size = ('z', 'd') if side < 2 else ('x', 'w')
    across_axis, across_size = ('x', 'w') if side < 2 else ('z', 'd')
    normal_sign = 1 if side % 2 == 0 else -1
    across_sign = 1 if side in (0, 3) else -1
    plane = own[normal_axis] + normal_sign * own[normal_size] / 2
    pieces = [rect]
    for index, other in enumerate(volumes):
        if index == own_index:
            continue
        offset = normal_sign * (other[normal_axis] - plane)
        low, high = offset - other[normal_size] / 2, offset + other[normal_size] / 2
        # A neighbouring solid buries this face. Equal outward planes need
        # one owner, so the earlier mass keeps their shared facade.
        buried = low <= EPSILON and high > EPSILON
        shared = abs(high) <= EPSILON and index < own_index
        if not (buried or shared):
            continue
        center = across_sign * (other[across_axis] - own[across_axis])
        cover = (center - other[across_size] / 2, center + other[across_size] / 2,
                 other['y'] - other['h'] / 2, other['y'] + other['h'] / 2)
        pieces = [piece for old in pieces for piece in subtract_rectangle(old, cover)]
    return pieces


def rectangle_area(rect):
    return max(0, rect[1] - rect[0]) * max(0, rect[3] - rect[2])


def full_window_exposed(volumes, own_index, side, rect):
    return abs(sum(map(rectangle_area, visible_wall_rectangles(volumes, own_index, side, rect)))
               - rectangle_area(rect)) < EPSILON


def clipped_uv(uv, original, clipped):
    """Preserve atlas density and alignment when splitting a wall quad."""
    x0, x1, y0, y1 = original
    result = []
    for x, y in [(clipped[0], clipped[2]), (clipped[1], clipped[2]),
                 (clipped[1], clipped[3]), (clipped[0], clipped[3])]:
        u, v = (x - x0) / (x1 - x0), (y - y0) / (y1 - y0)
        result.append(tuple((1-v)*((1-u)*uv[0][i]+u*uv[1][i])
                            + v*((1-u)*uv[3][i]+u*uv[2][i]) for i in range(2)))
    return result
