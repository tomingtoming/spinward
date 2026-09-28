"""Close the reserved 30 cm margin between a new alley and its door approach."""
import math


def connection(parcel, height):
    if '-passage-' not in parcel['road']:
        return None
    a, b = parcel['entrance']['start'], parcel['entrance']['end']
    length = math.dist(a[:2], b[:2])
    nx, ny = (b[0]-a[0])/length, (b[1]-a[1])/length
    # Two centimetres of overlap closes cylindrical tessellation seams. The
    # surface is 5 mm above the saved alley, avoiding coplanar drawing.
    edge = [a[0]-nx*.32, a[1]-ny*.32]
    width = parcel['entrance']['width']
    corners=[]
    for centre, sides, z in [(edge, [-1,1], None), (a, [1,-1], a[2])]:
        for side in sides:
            x,y=centre[0]-ny*side*width/2,centre[1]+nx*side*width/2
            corners.append([x,y,height([x,y])+.005 if z is None else z])
    return corners


def append_connection(builder, parcel, corners):
    if corners is None:
        return
    x,y=parcel['position'];c,s=math.cos(parcel['yaw']),math.sin(parcel['yaw'])
    builder.face([(c*(px-x)+s*(py-y),-s*(px-x)+c*(py-y),h-parcel['floor'])
                  for px,py,h in corners], 'paving', True)
