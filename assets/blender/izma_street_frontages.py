"""Continuous urban pavement, clipped around roads and existing entrances.

The small convex pieces remain disjoint. No polygon dependency or runtime
generation is required; the native authoring step supplies their ground heights.
"""
import math
from izma_ground_patches import area
from plan_izma_urban import ReservationIndex, corridor, overlaps, project


def triangle_altitude(points):
    """Smallest altitude in metres; collinear export slivers are not floors."""
    a,b,c=points
    u=[b[k]-a[k] for k in range(3)];v=[c[k]-a[k] for k in range(3)]
    twice_area=math.hypot(u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0])
    longest=max(math.dist(a,b),math.dist(b,c),math.dist(c,a))
    return twice_area/longest if longest else 0


def covers(index, point):
    """Point coverage of the convex union, including unmatched T junctions."""
    for i in index.cells.get((math.floor(point[0]/128), math.floor(point[1]/128)), []):
        polygon = index.shapes[i][0]
        if all((b[0]-a[0])*(point[1]-a[1])-(b[1]-a[1])*(point[0]-a[0]) >= -1e-8
               for a, b in zip(polygon, polygon[1:]+polygon[:1])):
            return True
    return False


def clean(polygon):
    result = []
    for p in polygon:
        if not result or math.dist(result[-1], p) > 1e-7:
            result.append(tuple(p))
    if len(result) > 1 and math.dist(result[0], result[-1]) < 1e-7:
        result.pop()
    if len(result) < 3 or abs(area(result)) < 1e-6:
        return []
    return result if area(result) > 0 else list(reversed(result))


def half_plane(polygon, a, b, inside):
    result = []
    sign = 1 if inside else -1
    def distance(p):
        return sign * ((b[0]-a[0])*(p[1]-a[1]) - (b[1]-a[1])*(p[0]-a[0]))
    for p, q in zip(polygon, polygon[1:]+polygon[:1]):
        dp, dq = distance(p), distance(q)
        if dp >= 0:
            result.append(p)
        if (dp >= 0) != (dq >= 0):
            t = dp/(dp-dq)
            result.append(tuple(p[k]+(q[k]-p[k])*t for k in range(2)))
    return clean(result)


def subtract(polygon, obstacle):
    """Disjoint convex pieces of polygon minus a convex CCW obstacle."""
    current = clean(polygon)
    if not current:
        return []
    obstacle = clean(obstacle)
    if not obstacle or not overlaps(current, obstacle):
        return [current]
    result = []
    for a, b in zip(obstacle, obstacle[1:]+obstacle[:1]):
        outside = half_plane(current, a, b, False)
        if outside:
            result.append(outside)
        current = half_plane(current, a, b, True)
        if not current:
            break
    return result


class PavementPlan:
    def __init__(self, roads, reservations):
        self.blocked = ReservationIndex()
        for polygon in reservations:
            polygon = clean(polygon)
            if polygon:self.blocked.append(polygon)
        for a, b, width in roads:
            self.blocked.append(clean(corridor(a, b, width)))
        self.accepted = ReservationIndex()

    def add(self, polygon):
        pieces = [clean(polygon)]
        if not pieces[0]:
            return []
        for index in [self.blocked, self.accepted]:
            ids = sorted({i for key in index.keys(polygon) for i in index.cells.get(key, [])})
            for i in ids:
                obstacle = index.shapes[i][0]
                pieces = [q for piece in pieces for q in subtract(piece, obstacle)]
                if not pieces:
                    return []
        for piece in pieces:
            self.accepted.append(piece)
        return pieces


def ribbons(profile, road_width, pavement_width):
    """Road-parallel strips plus corner aprons; clipping owns their junctions."""
    outer = road_width/2 + pavement_width
    # The saved carriageway has mitres/aprons, while each sweep segment has a
    # square end. Overlap the nominal edge and let the actual road triangles
    # trim it; otherwise small triangular grass gaps survive at bends.
    inner = road_width/2 - min(.35,road_width/4)
    for a, b in zip(profile, profile[1:]):
        dx, dy = b[0]-a[0], b[1]-a[1]
        length = math.hypot(dx, dy)
        if length < 1e-6:
            continue
        nx, ny = -dy/length, dx/length
        for sign in [-1, 1]:
            yield clean([(p[0]+nx*s*sign, p[1]+ny*s*sign)
                         for p, s in [(a, inner), (b, inner), (b, outer), (a, outer)]])
    # Only actual changes of direction need a fan. Two-metre grading rows on
    # a straight road already share an exact boundary.
    for i, p in enumerate(profile):
        if 0 < i < len(profile)-1:
            a, b = profile[i-1], profile[i+1]
            if math.dist(project(*p[:2], a, b)[:2], p[:2]) < 1e-5:
                continue
        yield [(p[0]+outer*math.cos(j*math.tau/20), p[1]+outer*math.sin(j*math.tau/20)) for j in range(20)]
