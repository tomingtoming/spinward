"""Premises and room plans for the authored city's civilian elevations.

District weights describe Spinward's construction history, not the animation's
canonical geography. A room plan is shared between LODs and between storeys;
small service windows belong to a service bay rather than random wall noise.
"""
import hashlib


def token(value):
    return int.from_bytes(hashlib.sha256(value.encode()).digest()[:4], 'big')


def building_identity(parcel):
    n = token(parcel['id'] + ':premises')
    family = parcel['family']; district = parcel['district']
    traditional = district in ['a-old-town', 'a-river', 'c-market', 'c-production']
    if family in ['house', 'farmhouse']:
        styles = ['paired-rooms', 'stair-bay', 'deep-eaves'] if traditional else ['stair-bay', 'paired-rooms', 'horizontal-rooms']
    elif family == 'apartment':
        styles = ['compact-flats', 'balcony-stack', 'stair-bay-flats']
    elif family == 'office':
        styles = ['office-ribbon', 'office-bays', 'office-glazed']
    elif family in ['shop-house', 'workshop', 'pavilion'] or parcel.get('groundShop'):
        styles = ['shop-piers', 'shop-display', 'shop-transom']
    else:
        styles = ['public-bays', 'public-ribbon']
    shops = ['FOOD', 'COFFEE', 'BOOKS', 'REPAIR', 'BAKERY', 'STORE']
    if district in ['a-port', 'b-workshop', 'c-cargo', 'c-production']:
        shops = ['REPAIR', 'TOOLS', 'PARTS', 'SUPPLY']
    elif district == 'c-market':
        shops = ['FOOD', 'BAKERY', 'MARKET', 'COFFEE']
    style = styles[n % len(styles)]
    return {'style': style, 'seed': n, 'shopName': shops[(n // 7) % len(shops)],
            'door': 'timber' if family in ['house', 'farmhouse', 'shop-house'] and traditional else 'metal',
            'canopy': (n // 11) % 3,
            'balconyMaterial': ['wall', 'metal', 'wall'][(n // 19) % 3]}


def room_openings(span, floors, kind, n, side, balcony, ground_shop, base, identity):
    """Rectangular apertures of actual room/service bays, in facade metres."""
    style = identity['style']; plan = identity['seed']; office = kind == 'office'
    floor_h = 3.4 if office else 3.2
    dwelling = kind in ['house', 'farmhouse', 'shop-house']
    nominal = 3.0 if dwelling else (3.4 if kind == 'apartment' else 2.5)
    if style in ['horizontal-rooms', 'office-ribbon', 'public-ribbon']: nominal *= 1.35
    if style in ['paired-rooms', 'shop-piers']: nominal *= .85
    count = max(2, int(span / nominal))
    # Unequal room widths repeat vertically. The compact service bay is useful
    # on a small house; it is not copied onto every office elevation.
    weights = [1.0] * count
    service = None
    if dwelling or style == 'stair-bay-flats':
        service = 0 if (plan + side) % 2 else count-1
        weights[service] = .58 if style in ['stair-bay', 'stair-bay-flats'] else .78
        if count > 2: weights[count//2] = 1.22
    edge = -span/2; bays = []
    for weight in weights:
        width = span * weight / sum(weights)
        bays.append((edge, edge + width)); edge += width
    rows = []
    for row in range(floors):
        shop = row == 0 and base == 0 and side == 0 and (ground_shop or kind in ['shop-house', 'workshop', 'pavilion'])
        has_balcony = balcony and side == 0 and row > 0
        openings = []
        for col, (a, b) in enumerate(bays):
            service_window = col == service and not has_balcony and not shop
            if shop:
                bottom, height, fraction = .16, 2.28, .86
            elif office:
                bottom, height = ((.22, 2.88) if style == 'office-glazed' else
                                  (.92, 1.7) if style == 'office-ribbon' else (.78, 2.0))
                fraction = .94 if style == 'office-ribbon' else .76
            elif has_balcony:
                bottom, height, fraction = .24, 2.15, .70
            elif service_window:
                bottom, height, fraction = (1.12, 1.18, .32) if style.startswith('stair-bay') else (1.62, .65, .48)
            else:
                bottom = 1.02 if row > 0 or base > 0 else .84
                height = 1.12 if style in ['horizontal-rooms', 'deep-eaves'] else 1.28
                fraction = .74 if style in ['horizontal-rooms', 'deep-eaves'] else .62
            if not shop and not office and not has_balcony:
                # A shared lintel is a construction choice, including above a
                # smaller bathroom/stair opening. It also avoids subdividing
                # an entire wall into a separate narrow band for every head.
                bottom = 2.30-height
            width = min(b-a-.32, (b-a)*fraction)
            centre = (a+b)/2
            left, right = centre-width/2, centre+width/2
            if has_balcony:
                # Door openings stay inside the existing balcony end guards.
                left=max(left,-span*.46+.10)
                right=min(right,span*.46-.10)
            if side == 0 and row == 0 and base == 0:
                door_half = 1.4 if kind in ['office', 'civic'] else .95 if kind == 'apartment' else .55
                if left < door_half+.55 and right > -door_half-.55:
                    # A display bay may approach the door jamb, but cannot sit
                    # behind the entrance door as a second luminous rectangle.
                    if centre < 0: right = -door_half-.55
                    else: left = door_half+.55
            if right-left < .28: continue
            room = token(f'{n}:{side}:{row}:{col}:room')
            occupied = token(f'{n}:{side}:{row}:office') % 10 < 4 if office else room % 10 < 4
            pane = 'glass' if not occupied else ('window-cool' if office else
                   ['window-warm', 'window-neutral', 'window-cool'][(room//10)%3])
            openings.append({'left':left,'right':right,'bottom':row*floor_h+bottom,
                             'top':row*floor_h+bottom+height,'pane':pane,
                             'balcony':has_balcony,'shop':shop,'service':service_window})
        rows.append(openings)
    return rows


def entrance(builder, parcel, identity, du, dv, dw, lod, sign_writer=None):
    family = parcel['family']; w = parcel['size'][0]
    public = family in ['office','civic']; shop = parcel.get('groundShop') or family in ['shop-house','workshop','pavilion']
    door = 'wood' if identity['door']=='timber' else 'metal'
    builder.box(du,dv-.055,0,dw,.1,2.4,door)
    # Residential doors have a narrow vision panel. Shop and communal entrances
    # use larger glazing; this distinction survives the middle LOD.
    glass_w = dw-.22 if public or shop or family=='apartment' else .20
    glass_h = 1.86 if public or shop or family=='apartment' else 1.14
    builder.box(du,dv-.118,.35 if glass_h>1.5 else .86,glass_w,.025,glass_h,'glass')
    if public: builder.box(du,dv-.14,.15,.065,.035,2.2,'metal')
    if shop:
        # Put the sign above one display, clear of the lamp on the door's right.
        sign_w = min((w-dw)/2-.45,4.0); sign_y = dv-.12
        sign_x = du-dw/2-.20-sign_w/2
        builder.box(sign_x,sign_y,2.85,sign_w,.16,.32,'wood' if identity['canopy']==0 else 'metal')
        if sign_writer is not None and lod==0:
            sign_writer(builder,identity['shopName'],sign_x,sign_y-.086,2.90,sign_w-.25,.21)
        if identity['canopy'] != 2:
            canopy_w = min(w*.88,9.0); reach = 1.0 if identity['canopy']==0 else .65
            builder.box(du,dv-reach/2,2.75,canopy_w,reach,.09,parcel['roof'])
            for side in [-1,1]:
                builder.box(du+side*(canopy_w/2-.1),dv-.06,2.36,.08,.12,.42,'metal')
    elif family != 'warehouse':
        reach = 1.25 if public or family=='apartment' else [.55,.8,1.0][identity['canopy']]
        width = dw + (.9 if public or family=='apartment' else .42)
        builder.box(du,dv-reach/2,2.80,width,reach,.12,parcel['roof'])
        # Wall brackets support small hoods; only larger communal porches need
        # columns. Repeating two posts at every house made every frontage alike.
        if family=='apartment' and identity['canopy']==0:
            for side in [-1,1]: builder.box(du+side*(width/2-.08),dv-reach+.08,0,.10,.10,2.80,'metal')
        else:
            for side in [-1,1]: builder.box(du+side*(dw/2-.04),dv-.05,2.46,.07,.10,.40,'metal')
    if lod==0: builder.box(du+dw*.34,dv-.15,.95,.035,.035,.27,'metal')
