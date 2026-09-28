"""Close native entrance cheeks and the short skirt below the first riser."""
import math
from izma_city_access import entry_sections


def entry_side_faces(parcel, ground):
    e = parcel['entrance'];a, b = e['start'], e['end']
    length = math.dist(a[:2], b[:2])
    nx, ny = (b[0]-a[0])/length, (b[1]-a[1])/length
    faces = []
    def point(t, side, height):
        return (a[0]+(b[0]-a[0])*t-ny*side*e['width']/2,
                a[1]+(b[1]-a[1])*t+nx*side*e['width']/2, height)
    def foot(p):
        return (p[0], p[1], min(ground(p[:2])-.02, p[2]-.02))
    sections=list(entry_sections(parcel))
    for low, high, start, top in sections:
        for side in [-1, 1]:
            p, q = point(low, side, start), point(high, side, top)
            face = [foot(p), foot(q), q, p]
            faces.append(face if side == -1 else list(reversed(face)))
    # The existing first riser starts at the approach level, above the earth.
    # Only fill below it; do not add a coplanar face over the existing riser.
    skirt_top = min(a[2], sections[0][2])
    p, q = point(0, -1, skirt_top), point(0, 1, skirt_top)
    faces.append([foot(q), foot(p), p, q])
    return faces


def append_entry_sides(builder, parcel, ground):
    x, y = parcel['position'];c, s = math.cos(parcel['yaw']), math.sin(parcel['yaw'])
    for face in entry_side_faces(parcel, ground):
        builder.face([(c*(px-x)+s*(py-y), -s*(px-x)+c*(py-y), h-parcel['floor'])
                      for px, py, h in face], 'foundation', True)
