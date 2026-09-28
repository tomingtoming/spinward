"""Street-enclosed city blocks in the saved, unrolled colony plan.

Offline geometry only. Coordinates stay in metres; roads are noded at their
actual intersections, not snapped to a grid of new streets. GEOS predicates
handle concave blocks and holes. Road heights/bridges remain a separate gate
before any resulting footprint can be installed as walkable native geometry.
"""
import hashlib
import math
from shapely import LineString, Polygon, box
from shapely.ops import polygonize, unary_union


SPACING = math.tau * 3200 / 3

def polygons(geometry):
    if geometry.is_empty:
        return []
    if geometry.geom_type == 'Polygon':
        return [geometry]
    return [p for part in getattr(geometry, 'geoms', []) for p in polygons(part)]


def street_blocks(roads, boundary, minimum_area=300):
    """Cut the actual road carriageways out of every closed centreline face.

    Open branches remain reservations within a face; they must not disappear
    merely because polygonize returns only closed rings. The outer boundary
    selects complete faces, rather than inventing a road around the study box.
    """
    lines = [LineString(r['points']) for r in roads]
    network = unary_union(lines)
    carriageways = unary_union([line.buffer(r['width'] / 2 + .25, cap_style='flat',
                                           join_style='mitre') for line, r in zip(lines, roads)])
    result = []
    for face in polygonize(network):
        if face.area < minimum_area or not boundary.covers(face):
            continue
        for site in polygons(face.difference(carriageways)):
            if site.area < minimum_area:
                continue
            assert site.is_valid and site.intersection(carriageways).area < 1e-5
            edges = []
            coords = list(face.exterior.coords)
            segments = [(a, b) for ring in [face.exterior, *face.interiors]
                        for a, b in zip(ring.coords, list(ring.coords)[1:])]
            for a, b in segments:
                segment = LineString([a, b])
                # Noded segments retain their parent road even when an endpoint
                # lands inside the parent's original segment.
                owners = [(line.distance(segment.interpolate(.5, normalized=True)), r)
                          for line, r in zip(lines, roads)]
                distance, owner = min(owners, key=lambda pair: pair[0])
                assert distance < 1e-5, ('Unowned block edge', distance)
                edges.append({'a': list(a), 'b': list(b), 'road': owner['id'],
                              'width': owner['width']})
            # Stable identity follows the actual face, independent of input order.
            ring = [(round(x, 5), round(y, 5)) for x, y in coords[:-1]]
            rotations = [tuple(ring[i:] + ring[:i]) for i in range(len(ring))]
            reverse = list(reversed(ring))
            rotations += [tuple(reverse[i:] + reverse[:i]) for i in range(len(reverse))]
            token = hashlib.sha256(repr((min(rotations), round(site.centroid.x, 5),
                                         round(site.centroid.y, 5))).encode()).hexdigest()[:12]
            result.append({'id': token, 'face': face, 'site': site, 'edges': edges})
    return sorted(result, key=lambda b: (b['face'].centroid.y, b['face'].centroid.x))


def colony_roads(master, neighbourhood):
    nodes = {n['id']: n for n in master['nodes']}
    roads = []
    for route in master['routes']:
        if route['kind'] not in ['local', 'arterial']:
            continue
        groups = [nodes[n] for n in route['nodes']]
        if len({p['band'] for p in groups}) != 1:
            continue
        band = groups[0]['band']
        roads.append({**route, 'band': band,
                      'points': [[p['xy'][0] + band * SPACING, p['xy'][1]] for p in groups]})
    roads.extend(neighbourhood['streets'])
    return roads


def district_boundary(district, master):
    """Full district land, without the window-side/end maintenance reserves."""
    half = 3200 * master['landArcRadians'] / 2 - master['edgeReserve']
    shift = district['band'] * SPACING
    return box(shift - half, district['axial'][0], shift + half, district['axial'][1])


def outline(polygon):
    return {'outer': [list(p) for p in polygon.exterior.coords[:-1]],
            'holes': [[list(p) for p in ring.coords[:-1]] for ring in polygon.interiors]}


def read_outline(value):
    return Polygon(value['outer'], value.get('holes', []))
