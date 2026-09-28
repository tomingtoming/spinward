"""Civilian openings and balcony details in metres, shared by both native LODs.

Room colour/occupancy belongs to an opening, not to a randomly coloured pane.
Near windows are real wall recesses; middle windows retain their dimensions and
room identity with a flat reveal. Closed-room collision remains a wall envelope.
"""
import hashlib


def seed(text):
    return int.from_bytes(hashlib.sha256(text.encode()).digest()[:4], 'big')


def window_rows(span, floors, kind, n, side, balcony=False, ground_shop=False, base=0, identity=None):
    if identity is not None:
        from izma_building_identity import room_openings
        return room_openings(span, floors, kind, n, side, balcony, ground_shop, base, identity)
    office = kind == 'office'
    floor_h = 3.4 if office else 3.2
    nominal = ([2.4, 3.0, 3.6][n % 3] if office else [2.8, 3.3, 3.9][(n + side) % 3])
    bays = max(2, int(span / nominal))
    pitch = span / bays
    rows = []
    for row in range(floors):
        shop = row == 0 and base == 0 and side == 0 and (
            kind in ['shop-house', 'workshop', 'civic', 'pavilion'] or ground_shop)
        balcony_door = balcony and side == 0 and row > 0
        height = (2.7 if n % 3 == 0 else 2.15) if office else (
            2.15 if balcony_door else [1.05, 1.25, 1.4][(n // 19 + side) % 3])
        if shop:
            height = 2.3
        bottom = row * floor_h + (.24 if height > 2 else [1.0, 1.1, 1.2][(n // 7) % 3])
        width = pitch * (.78 if office or shop else (.68 if balcony_door else [.46, .56, .64][(n + side) % 3]))
        openings = []
        for col in range(bays):
            u = -span / 2 + (col + .5) * pitch
            if side == 0 and row == 0 and base == 0 and abs(u) < 1.5:
                continue
            key = seed(f'{n}:{side}:{row}:{col}')
            pane = 'glass' if key % 10 >= 4 else ('window-cool' if office else
                ['window-warm', 'window-neutral', 'window-cool'][(key // 10) % 3])
            openings.append({'left': u - width / 2, 'right': u + width / 2,
                             'bottom': bottom, 'top': bottom + height, 'pane': pane,
                             'balcony': balcony_door, 'shop': shop})
        rows.append(openings)
    return rows


def facade(builder, x, y, z, w, d, floors, kind, n, lod, wall, balcony=False, ground_shop=False, identity=None):
    floor_h = 3.4 if kind == 'office' else 3.2
    for side in range(4):
        span = w if side < 2 else d
        depth = d / 2 if side < 2 else w / 2
        def at(u, h, extra=0):
            if side == 0: return (x + u, y - depth - extra, z + h)
            if side == 1: return (x - u, y + depth + extra, z + h)
            if side == 2: return (x + depth + extra, y + u, z + h)
            return (x - depth - extra, y - u, z + h)
        def rect(left, right, bottom, top, mat, extra=0):
            if right - left < 1e-8 or top - bottom < 1e-8: return
            cuts = [left, *[u for u in wall_cuts if left < u < right], right] if not lod else [left, right]
            for a, b in zip(cuts, cuts[1:]):
                builder.quad(at(a, bottom, extra), at(b, bottom, extra),
                             at(b, top, extra), at(a, top, extra), mat)
        rows = window_rows(span, floors, kind, n, side, balcony, ground_shop, z, identity)
        # A straight edge in the native plan becomes a curved-cylinder chord.
        # Bands, piers and reveals therefore need identical edge vertices;
        # T-junctions which look closed in Blender become visible hairline gaps.
        wall_cuts = sorted({o[k] for row in rows for o in row for k in ['left', 'right']})
        recess = [.12, .18, .24][(n // 13) % 3]
        if lod:
            rect(-span / 2, span / 2, 0, floors * floor_h, wall)
        for row, openings in enumerate(rows):
            low, high = row * floor_h, (row + 1) * floor_h
            if not lod:
                if not openings:
                    rect(-span / 2, span / 2, low, high, wall)
                    continue
                # Service and living windows need different sill heights.
                # Fill horizontal bands around the real apertures; assuming
                # the first opening's height puts opaque walls over the others.
                levels = sorted({low, high, *[o[k] for o in openings for k in ['bottom','top']]})
                for bottom, top in zip(levels, levels[1:]):
                    active = [o for o in openings if o['bottom'] < top-1e-8 and o['top'] > bottom+1e-8]
                    left = -span/2
                    for opening in active:
                        rect(left, opening['left'], bottom, top, wall)
                        left = opening['right']
                    rect(left, span/2, bottom, top, wall)
            for opening in openings:
                a, b, low, high = [opening[k] for k in ['left', 'right', 'bottom', 'top']]
                if lod:
                    rect(a, b, low, high, 'metal', .015)
                    rect(a + .065, b - .065, low + .065, high - .065, opening['pane'], .025)
                    continue
                # The reveal closes the aperture through the outer wall to the
                # recessed frame; no opaque wall is left behind the opening.
                corners = [(a, low), (b, low), (b, high), (a, high)]
                for i in range(4):
                    p, q = corners[i], corners[(i + 1) % 4]
                    points = [p, q]
                    if p[1] == q[1]:
                        cuts = [u for u in wall_cuts if min(p[0],q[0]) < u < max(p[0],q[0])]
                        if p[0] > q[0]: cuts.reverse()
                        points = [p, *[(u, p[1]) for u in cuts], q]
                    for aa, bb in zip(points, points[1:]):
                        builder.face([at(*aa), at(*bb), at(*bb, -recess), at(*aa, -recess)], 'foundation')
                rect(a, b, low, high, 'metal', -recess)
                rect(a + .065, b - .065, low + .065, high - .065, opening['pane'], -recess + .012)
                centre = (a + b) / 2
                rect(centre - .025, centre + .025, low + .065, high - .065, 'metal', -recess + .025)
        if side == 0 and balcony:
            bays = max(2, int(span / [2.8, 3.3, 3.9][n % 3]))
            for row in range(1, floors):
                slab_y, level = y - depth - .8, z + row * floor_h
                # Keep slab tops and the guard envelope identical at every LOD.
                # The back sits inside the opaque wall below the door sill.
                # A second coplanar face flickers after cylindrical projection.
                builder.box(x, slab_y, level - .16, w * .92, 1.6, .16, 'foundation', True, back=False)
                guard_material = 'metal' if identity and identity['balconyMaterial']=='metal' else wall
                builder.box(x, slab_y - .75, level, w * .92 + .1, .1, .98, guard_material)
                for edge in [-1, 1]:
                    builder.box(x + edge * w * .46, slab_y, level, .1, 1.6, .98, wall)
                # A distinct cap and spaced partition panels articulate the
                # repeated slabs without hundreds of decorative guard bars.
                builder.box(x, slab_y - .75, level + .95, w * .92 + .1, .1, .03, 'metal')
                if not lod:
                    partitions = ([(a['right']+b['left'])/2 for a,b in zip(rows[row],rows[row][1:])]
                                  if identity else [-w*.46+j*w*.92/bays for j in range(1,bays)])
                    for partition in partitions:
                        builder.box(x + partition, slab_y, level,
                                    .07, 1.48, 1.45, 'metal')
