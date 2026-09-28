"""Metre-preserving city placement; geographic source coordinates stay immutable."""
import math
from pyproj import Transformer

RADIUS = 3200.0
SPAN = 40000.0
WIDTH = math.tau * RADIUS / 6


class Frame:
    def __init__(self, epsg, origin, angle):
        self.forward = Transformer.from_crs(6668, epsg, always_xy=True)
        self.backward = Transformer.from_crs(epsg, 6668, always_xy=True)
        self.origin = origin
        self.angle = angle

    def place(self, lon, lat):
        east, north = self.forward.transform(lon, lat)
        east -= self.origin[0]
        north -= self.origin[1]
        c, s = math.cos(self.angle), math.sin(self.angle)
        return east * s - north * c, east * c + north * s

    def geographic(self, x, y):
        c, s = math.cos(self.angle), math.sin(self.angle)
        return self.backward.transform(self.origin[0] + x*s + y*c,
                                       self.origin[1] - x*c + y*s)


def cylinder(x, y, height, band):
    angle = x / RADIUS + band * math.tau / 3
    r = RADIUS - height
    return r * math.sin(angle), y, -r * math.cos(angle)


def fit(points, epsg):
    """Minimum strip width from all convex-hull edge orientations, not route length."""
    from shapely.geometry import MultiPoint
    projection = Transformer.from_crs(6668, epsg, always_xy=True)
    pts = [projection.transform(*p) for p in points]
    hull = list(MultiPoint(pts).convex_hull.exterior.coords)
    choices = []
    for p, q in zip(hull, hull[1:]):
        angle = math.atan2(q[1]-p[1], q[0]-p[0]) % math.pi
        c, s = math.cos(angle), math.sin(angle)
        along = [x*c+y*s for x, y in pts]
        cross = [x*s-y*c for x, y in pts]
        width, length = max(cross)-min(cross), max(along)-min(along)
        if length <= SPAN:
            a, b = (max(along)+min(along))/2, (max(cross)+min(cross))/2
            choices.append((width, length, angle, [a*c+b*s, a*s-b*c]))
    width, length, angle, origin = min(choices)
    return dict(epsg=epsg, origin=origin, angle=angle, stationEnvelopeWidth=width,
                stationEnvelopeLength=length, remainingWidth=WIDTH-width,
                fitsWith750mEachSide=width+1500 <= WIDTH)
