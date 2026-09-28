"""Bounded geometric cuts for retiring the old district motorway connections.

Clipping uses three-dimensional face area: a road retaining wall has zero XY
area but must survive outside the replacement. No canonical files are written.
"""
import math


def face_area(points):
    if len(points) < 3:
        return 0.
    origin = points[0]
    normal = [0., 0., 0.]
    for a, b in zip(points[1:], points[2:]):
        u = [a[k] - origin[k] for k in range(3)]
        v = [b[k] - origin[k] for k in range(3)]
        normal[0] += u[1] * v[2] - u[2] * v[1]
        normal[1] += u[2] * v[0] - u[0] * v[2]
        normal[2] += u[0] * v[1] - u[1] * v[0]
    return math.sqrt(sum(n * n for n in normal)) / 2


def halfplane(points, a, b, inside):
    result = []
    def distance(p):
        return (b[0]-a[0])*(p[1]-a[1]) - (b[1]-a[1])*(p[0]-a[0])
    for p, q in zip(points, points[1:] + points[:1]):
        dp, dq = distance(p), distance(q)
        ip = dp >= -1e-8 if inside else dp <= 1e-8
        iq = dq >= -1e-8 if inside else dq <= 1e-8
        if ip:
            result.append(p)
        if ip != iq:
            t = dp / (dp-dq)
            result.append(tuple(p[k] + (q[k]-p[k])*t for k in range(3)))
    return result


def split_footprint(points, cutter):
    """Return disjoint outside pieces and the inside of a convex XY prism."""
    area = sum(a[0]*b[1]-b[0]*a[1] for a, b in zip(cutter, cutter[1:]+cutter[:1]))
    if area < 0:
        cutter = list(reversed(cutter))
    outside = []
    remaining = points
    for a, b in zip(cutter, cutter[1:]+cutter[:1]):
        # A vertical face can lie entirely on a cut edge. Own it once, on the
        # inside; including it on both halfplanes would duplicate its area.
        distances = [(b[0]-a[0])*(p[1]-a[1])-(b[1]-a[1])*(p[0]-a[0]) for p in remaining]
        if distances and max(abs(d) for d in distances) <= 1e-8:
            continue
        part = halfplane(remaining, a, b, False)
        if face_area(part) > 1e-8:
            outside.append(part)
        remaining = halfplane(remaining, a, b, True)
        if face_area(remaining) <= 1e-8:
            return outside, []
    return outside, remaining


def split_planes(points, planes):
    """Split a face by convex 3D halfspaces n dot p + offset >= 0."""
    outside, remaining = [], points
    for normal, offset in planes:
        distances = [sum(normal[k]*p[k] for k in range(3))+offset for p in remaining]
        if distances and max(abs(d) for d in distances) <= 1e-8:
            continue
        halves = [[], []]
        for p,q,dp,dq in zip(remaining,remaining[1:]+remaining[:1],distances,distances[1:]+distances[:1]):
            for side, keep_positive in enumerate([False, True]):
                ip = dp >= -1e-8 if keep_positive else dp <= 1e-8
                iq = dq >= -1e-8 if keep_positive else dq <= 1e-8
                if ip:
                    halves[side].append(p)
                if ip != iq:
                    t=dp/(dp-dq)
                    halves[side].append(tuple(p[k]+(q[k]-p[k])*t for k in range(3)))
        if face_area(halves[0]) > 1e-8:
            outside.append(halves[0])
        remaining=halves[1]
        if face_area(remaining) <= 1e-8:
            return outside, []
    return outside, remaining


def prism_planes(cutter):
    if sum(a[0]*b[1]-b[0]*a[1] for a,b in zip(cutter,cutter[1:]+cutter[:1])) < 0:
        cutter=list(reversed(cutter))
    return [((a[1]-b[1],b[0]-a[0],0), (b[1]-a[1])*a[0]-(b[0]-a[0])*a[1])
            for a,b in zip(cutter,cutter[1:]+cutter[:1])]


def retirement_cutters(ic, cap_radius):
    """The original final access segment plus its shared T-junction cap."""
    a, b = ic['replaceOriginalAccessFrom'][:2], ic['node']
    dx, dy = b[0]-a[0], b[1]-a[1]
    length = math.hypot(dx, dy)
    # Original carriageway is 16 m, with 2.2 m pavements. The 2 cm margin
    # catches the rounded exported vertices and the outer retaining edge.
    nx, ny = -dy/length*10.22, dx/length*10.22
    strip = [(a[0]+nx,a[1]+ny), (b[0]+nx,b[1]+ny),
             (b[0]-nx,b[1]-ny), (a[0]-nx,a[1]-ny)]
    cap = [(b[0]+math.cos(i*math.tau/16)*(cap_radius+.02),
            b[1]+math.sin(i*math.tau/16)*(cap_radius+.02)) for i in range(16)]
    return [strip, cap]


class FootprintCuts:
    def __init__(self, entries, cell=64):
        self.cell = cell
        self.entries = entries
        self.grid = {}
        for index, (_, poly) in enumerate(entries):
            for key in self.cells(poly):
                self.grid.setdefault(key, []).append(index)

    def cells(self, points):
        for x in range(math.floor(min(p[0] for p in points)/self.cell), math.floor(max(p[0] for p in points)/self.cell)+1):
            for y in range(math.floor(min(p[1] for p in points)/self.cell), math.floor(max(p[1] for p in points)/self.cell)+1):
                yield x, y

    def split(self, points):
        candidates = sorted({i for key in self.cells(points) for i in self.grid.get(key, [])})
        outside, inside = [points], []
        for index in candidates:
            owner, cutter = self.entries[index]
            remaining = []
            for piece in outside:
                retained, retired = split_footprint(piece, cutter)
                remaining.extend(retained)
                if retired:
                    inside.append((owner, retired))
            outside = remaining
            if not outside:
                break
        return outside, inside
