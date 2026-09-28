"""Join the preserved river bridge to the built arterial in a native patch.

The small study has its own elevations. Its terrain-draped guide curves are
not the height of the bridge deck. Read that saved deck, preserve the study,
and open its junction with the retained arterial in drawing and collision.
"""
import argparse
from collections import defaultdict
import hashlib
import json
import math
from pathlib import Path
import sys

import bpy
from mathutils.bvhtree import BVHTree

ASSETS = Path(__file__).resolve().parent
ROOT = ASSETS.parents[1]
sys.path.insert(0, str(ASSETS))
from colony_manifest_io import encoded, read_manifest
from izma_mesh_builder import BuildingMeshBuilder
from izma_motorway_replacement import FootprintCuts, face_area, split_footprint
from plan_izma_motorway import sample, stations


def tree(triangles, radius=None):
    vertices = [p for tri in triangles for p in tri]
    if radius:
        vertices = [(math.cos(x / radius) * (radius - z), y,
                     math.sin(x / radius) * (radius - z)) for x, y, z in vertices]
    return BVHTree.FromPolygons(vertices, [tuple(range(i, i + 3))
        for i in range(0, len(vertices), 3)], all_triangles=True)


def triangles(packed, material):
    ids = packed['meshes'][material]
    return [[tuple(packed['vertices'][j * 3:j * 3 + 3]) for j in ids[i:i + 3]]
            for i in range(0, len(ids), 3)]


def connect(integration, output):
    assert integration.is_absolute() and output.is_absolute() and not output.exists()
    native = integration / 'izma-motorway-integration.blend'
    edit = json.loads(native.with_suffix('.json').read_text())
    assert hashlib.sha256(native.read_bytes()).hexdigest() == edit['nativeSha256']
    source = read_manifest(ROOT / 'src/worlds/generated/izmaColony.json')
    assert hashlib.sha256(encoded(source)).hexdigest() == edit['sourceSha256']
    study_path = ROOT / 'src/worlds/generated/worldLandscapes.json'
    study = json.loads(study_path.read_text())['izma']
    study_mesh = {'vertices': study['vertices'], 'meshes': study['lods'][0]}
    radius = source['radius']
    base = source['base']
    ground_tree = tree(triangles(base, 'earth') + triangles(study_mesh, 'earth'))
    def ground(x, y):
        hit = ground_tree.ray_cast((x, y, 200), (0, 0, -1))[0]
        assert hit is not None, ('Missing native terrain', x, y)
        return hit.z

    # The actual bridge drawing, not its terrain-draped alignment metadata.
    bridge_tree = tree(triangles(study_mesh, 'walk'))
    start = [98., -80., 0.]
    start[2] = bridge_tree.ray_cast((97.99, -80, 10), (0, 0, -1))[0].z
    assert abs(start[2] - 8.2) < .001
    transport = json.loads((ASSETS / 'izma-transport.json').read_text())
    original = next(r for r in transport['profiles'] if r['id'] == 'a-river-access')
    join_index = next(i for i, p in enumerate(original['points']) if abs(p[0] - 516.3636363636364) < .001)
    end = original['points'][join_index][:3]
    previous = original['points'][join_index - 1]
    dx, dy = end[0] - previous[0], end[1] - previous[1]
    distance = math.hypot(dx, dy)
    ux, uy = dx / distance, dy / distance
    # Use the gap between the two arterial-frontage parcels. Keep that street
    # as their access; only open its pavement at the new junction.
    turn = [410., -80.]
    controls = [[475.,52.], [475.,72.], [end[0]-25*ux,end[1]-25*uy], end[:2]]
    straight_count = math.ceil(math.dist(start[:2], turn) / 3)
    points = [[start[0]+(turn[0]-start[0])*i/straight_count, -80., start[2]] for i in range(straight_count)]
    for i in range(36):
        a = -math.pi/2+math.pi/2*i/35
        points.append([410+65*math.cos(a), -15+65*math.sin(a), start[2]])
    for i in range(1,23):points.append([475.,-15+67*i/23,start[2]])
    curve_count = math.ceil(sum(math.dist(a,b) for a,b in zip(controls,controls[1:]))/2)
    for i in range(curve_count + 1):
        t = i / curve_count
        x, y = [sum(controls[j][k] * w for j, w in enumerate(
            [(1-t)**3, 3*t*(1-t)**2, 3*t*t*(1-t), t**3])) for k in range(2)]
        points.append([x, y, start[2]])
    count = len(points)-1
    for i,point in enumerate(points):
        t = i/count; smooth = t*t*(3-2*t)
        point[2] = start[2] + (end[2]-start[2])*smooth
    def offset(i, side, height=0):
        a, b = points[max(0, i-1)], points[min(count, i+1)]
        dx, dy = b[0]-a[0], b[1]-a[1]
        length = math.hypot(dx, dy)
        return (points[i][0]-dy/length*side, points[i][1]+dx/length*side, points[i][2]+height)
    # Match both endpoints' actual section orientation exactly.
    tangents = [(1., 0.), (ux, uy)]
    old_offset = offset
    def offset(i, side, height=0):
        if i not in [0, count]: return old_offset(i, side, height)
        dx, dy = tangents[0 if i == 0 else 1]
        return (points[i][0]-dy*side, points[i][1]+dx*side, points[i][2]+height)
    along = stations(points)
    old_along = stations(original['points'])
    def old_height(x,y):
        distance = (x-original['points'][0][0])*ux+(y-original['points'][0][1])*uy
        return sample(original['points'],old_along,distance)[2]
    def old_side(x,y):
        return -uy*(x-original['points'][0][0])+ux*(y-original['points'][0][1])
    def section(i):
        # Narrow urban street through the parcel gap, flaring only after it.
        t = max(0,min(1,(points[i][1]-74)/(end[1]-74)))
        return 4+4*t*t*(3-2*t), 3-.8*t*t*(3-2*t)
    for i, point in enumerate(points):
        width, walk = section(i)
        needed = max(ground(*offset(i, side)[:2]) + .10 for side in
                     [-width-walk, -width, 0, width, width+walk])
        point[2] = max(point[2], needed)
        blend = max(0,min(1,(point[1]-20)/30))
        point[2] = point[2]*(1-blend)+old_height(*point[:2])*blend
    assert math.dist(points[0], start) < .001 and math.dist(points[-1], end) < .001
    maximum_grade = max(abs(b[2]-a[2])/math.dist(a[:2], b[:2]) for a,b in zip(points,points[1:]))
    assert maximum_grade <= .06, ('planned-grade',maximum_grade)

    a,b = original['points'][0], original['points'][-1]
    def old_strip(width):
        return [(p[0]-uy*side,p[1]+ux*side) for p,side in [(a,-width),(b,-width),(b,width),(a,width)]]
    old_road = old_strip(8.)
    old_envelope = old_strip(10.21)
    opening = FootprintCuts([('river', [offset(i,-section(i)[0]-section(i)[1]),
        offset(i+1,-section(i+1)[0]-section(i+1)[1]),
        offset(i+1,section(i+1)[0]+section(i+1)[1]),offset(i,section(i)[0]+section(i)[1])])
        for i in range(count) if points[i][1] > 40])
    excavation = FootprintCuts([('river', [offset(i,-section(i)[0]-section(i)[1]),
        offset(i+1,-section(i+1)[0]-section(i+1)[1]),
        offset(i+1,section(i+1)[0]+section(i+1)[1]),offset(i,section(i)[0]+section(i)[1])])
        for i in range(count)])
    pavement_tree = tree(triangles(base, 'walk'), radius)
    earth_tree = tree(triangles(base,'earth'),radius)
    def matches_surface(poly,oracle):
        # Collision simplification retains a sampled 5 mm distance to drawing.
        # Distinguish the road from the terrain compound underneath it.
        centre = [sum(p[k] for p in poly)/len(poly) for k in range(3)]
        x, y, z = centre
        hit = oracle.find_nearest((math.cos(x/radius)*(radius-z), y, math.sin(x/radius)*(radius-z)))
        return hit[0] is not None and hit[3] < .012

    # Check the new usable carriageway and walks against existing solid volumes.
    solids = list(study['solids'])
    for box in source.get('structures', []):
        x,y,z,w,d,h,yaw = box[:7]
        solids.append(dict(x=x,y=y,z=z,width=w,depth=d,height=h,yaw=yaw))
    for tile in source['tiles']:
        for box in tile.get('boxes', []):
            x,y,z,w,d,h,yaw = box[:7]
            if 60 < x < 620 and -160 < y < 150:
                solids.append(dict(x=x,y=y,z=z,width=w,depth=d,height=h,yaw=yaw))
    overlaps = []
    for i, point in enumerate(points):
        width, walk = section(i)
        for side in [-width-walk+.65, -width, 0, width, width+walk-.65]:
            x,y,z = offset(i,side)
            for solid in solids:
                if solid['z']+solid['height'] < z+.08 or solid['z'] > z+2.2:continue
                c,s = math.cos(solid['yaw']), math.sin(solid['yaw'])
                ox,oy = x-solid['x'], y-solid['y']
                if abs(c*ox+s*oy) < solid['width']/2+.2 and abs(-s*ox+c*oy) < solid['depth']/2+.2:
                    overlaps.append({'point':[x,y,z], 'solid':solid})
    assert not overlaps, ('New connection overlaps existing solids', overlaps[:3])

    bpy.ops.wm.open_mainfile(filepath=str(native))
    scene = bpy.data.scenes['SW_izma_motorway_integration']
    cylinder = bpy.data.scenes['SW_izma_motorway_integration_cylinder']
    bpy.context.window.scene = scene
    materials = {m['spinward_material']:m for m in bpy.data.materials if 'spinward_material' in m}
    for name,color in edit['palette'].items():
        if name in materials:continue
        material=bpy.data.materials.new('SWMI_'+name)
        material['spinward_material']=name
        material.diffuse_color=tuple(int(color[k:k+2],16)/255 for k in [1,3,5])+(1,)
        materials[name]=material
    builders = {}
    def face(kind, material, poly, draw=True, physical=True, floor=False):
        if face_area(poly) < 1e-8:return
        builder = builders.setdefault((kind,draw,physical), BuildingMeshBuilder(scene, materials))
        for i in range(1,len(poly)-1):builder.face([poly[0],poly[i],poly[i+1]], material, floor)
    removed = {'drawing':defaultdict(list), 'collision':defaultdict(list)}
    for material in ['earth','walk','parapet']:
        for i, tri in enumerate(triangles(base, material)):
            outside, inside = (excavation if material=='earth' else opening).split(tri)
            if not inside:continue
            removed['drawing'][material].append(i)
            for poly in outside:face('retained-drawing', material, poly, physical=False, floor=material in ['earth','arterial','walk'])
    for i, surface in enumerate(base['surfaces']):
        ids = surface['indices']; floor = surface.get('groundSurface', True)
        for j in range(0,len(ids),3):
            tri = [tuple(base['vertices'][v*3:v*3+3]) for v in ids[j:j+3]]
            if max(p[0] for p in tri)<300 or min(p[0] for p in tri)>570:continue
            earth = floor and matches_surface(tri,earth_tree)
            outside,inside = (excavation if earth else opening).split(tri)
            if not inside or floor and not earth and not all(matches_surface(poly,pavement_tree) for _,poly in inside):continue
            removed['collision'][str(i)].append(j//3)
            for poly in outside:face('retained-collision', 'earth' if earth else 'arterial' if floor else 'parapet', poly, draw=False, floor=floor)
    assert removed['drawing']['walk'] and removed['collision']

    def deck_height(x,y,z):
        def smooth(value):
            value=max(0,min(1,value));return value*value*(3-2*value)
        blend=(1-smooth((abs(old_side(x,y))-10.22)/25))*smooth((y-20)/20)
        return z+(old_height(x,y)-z)*blend
    def junction_height(poly, lift=0):
        return [(x,y,deck_height(x,y,z-lift)+lift) for x,y,z in poly]
    def new_deck(poly,material,lift=0):
        # Old carriageway is authoritative in the overlap. New asphalt fills
        # the opened old pavement, and new footways never cross its traffic.
        pieces = split_footprint(poly,old_road)[0] if max(p[1] for p in poly)>40 else [poly]
        for piece in pieces:face('connection',material,junction_height(piece,lift),floor=True)

    for i in range(count):
        width, walk = section(i); next_width, next_walk = section(i+1)
        curb = .14*min(1,i*3/12); next_curb = .14*min(1,(i+1)*3/12)
        left,right = offset(i,-width),offset(i,width)
        nleft,nright = offset(i+1,-next_width),offset(i+1,next_width)
        new_deck([left,nleft,nright,right],'motorway-road')
        for side in [-1,1]:
            inner = offset(i,side*width,curb); ninner = offset(i+1,side*next_width,next_curb)
            outer = junction_height([offset(i,side*(width+walk),curb)],curb)[0]
            nouter = junction_height([offset(i+1,side*(next_width+next_walk),next_curb)],next_curb)[0]
            new_deck([inner,ninner,nouter,outer],'motorway-walk',.14)
            curb_poly = junction_height([offset(i,side*width),offset(i+1,side*next_width),ninner,inner])
            # Internal curbs/retaining walls must not close the old branch.
            for poly in split_footprint(curb_poly,old_envelope)[0] if max(p[1] for p in curb_poly)>40 else [curb_poly]:
                face('connection','motorway-structure',poly)
            foot = (outer[0],outer[1],min(outer[2]-.2,ground(*outer[:2])-.15))
            nfoot = (nouter[0],nouter[1],min(nouter[2]-.2,ground(*nouter[:2])-.15))
            top = (outer[0],outer[1],max(outer[2],ground(*outer[:2])))
            ntop = (nouter[0],nouter[1],max(nouter[2],ground(*nouter[:2])))
            wall = [top,ntop,nfoot,foot]
            for poly in split_footprint(wall,old_envelope)[0] if max(p[1] for p in wall)>40 else [wall]:
                face('connection','motorway-structure',poly)
            # A low continuous parapet confines the elevated outer apron.
            low = junction_height([offset(i,side*(width+walk-.18),curb)],curb)[0]
            nlow = junction_height([offset(i+1,side*(next_width+next_walk-.18),next_curb)],next_curb)[0]
            high = (low[0],low[1],low[2]+1.05); nhigh = (nlow[0],nlow[1],nlow[2]+1.05)
            rail = [low,nlow,nhigh,high]
            for poly in split_footprint(rail,old_envelope)[0] if max(p[1] for p in rail)>40 else [rail]:
                face('connection','motorway-rail',poly)

    for (kind,draw,physical),builder in builders.items():
        obj = builder.finish('SWMI_river-'+kind, {'id':'river-'+kind,'position':[0,0],
            'floor':0,'yaw':0,'district':'a-river','family':'infrastructure'}, -1)
        obj['owner']=edit['owner'];obj['motorway_id']='a-river-ic';obj['role']='river-'+kind
        obj['drawing']=draw;obj['runtime_accepted']=False;obj.hide_render=not draw
        flags=obj.data.attributes.new('physical','BOOLEAN','FACE')
        for flag in flags.data:flag.value=physical
        edit['objects'].append({'name':obj.name,'vertices':len(obj.data.vertices),'faces':len(obj.data.polygons),'drawing':draw,'physical':physical})
        scene.view_layers[0].update()
        data=obj.data.copy();copy=bpy.data.objects.new(obj.name+'_cylinder',data);cylinder.collection.objects.link(copy)
        for key,value in obj.items():copy[key]=value
        copy.hide_render=obj.hide_render
        for original_vertex,vertex in zip(obj.data.vertices,data.vertices):
            p=obj.matrix_world@original_vertex.co;x,y,h=-p.y,p.x,p.z
            vertex.co=(math.cos(x/radius)*(radius-h),y,math.sin(x/radius)*(radius-h))
    for key,label in [('drawingRemove','drawing'),('collisionRemove','collision')]:
        for material,indices in removed[label].items():
            assert not set(edit[key].get(material,[])).intersection(indices)
            edit[key].setdefault(material,[]).extend(indices)
            edit[key][material].sort()
    # The merged junction has crossfall. Resolve its navigation centreline
    # against the actual authored road faces, never the terrain below them.
    road_faces=triangles(base,'arterial')
    for (kind,draw,physical),builder in builders.items():
        if not draw:continue
        for face_indices,material in zip(builder.f,builder.m):
            if material!='motorway-road':continue
            road_faces.append([builder.v[j] for j in face_indices])
    deck_tree=tree(road_faces)
    for point in points:
        hit=deck_tree.ray_cast((point[0],point[1],point[2]+1),(0,0,-1),2)[0]
        assert hit is not None, ('No native road at navigation point',point)
        point[2]=hit.z
    maximum_grade=max(abs(b[2]-a[2])/math.dist(a[:2],b[:2]) for a,b in zip(points,points[1:]))
    assert maximum_grade<=.06, ('native-navigation-grade',maximum_grade,
        sorted([(abs(b[2]-a[2])/math.dist(a[:2],b[:2]),a,b) for a,b in zip(points,points[1:])],reverse=True)[:3])
    connection={'id':'a-river-bridge-approach','entryNode':'a-river-east-bridge',
        'replacesRoute':'a-river-access','points':points,'joinOriginalAt':join_index,
        'maximumGrade':maximum_grade,'length':sum(math.dist(a[:2],b[:2]) for a,b in zip(points,points[1:])),
        'widths':[section(i)[0]*2 for i in range(len(points))],
        'studySha256':hashlib.sha256(study_path.read_bytes()).hexdigest(),
        'oldEntry':original['points'][0][:3], 'newEntry':start,
        'removedDrawing':sum(map(len,removed['drawing'].values())),
        'removedCollision':sum(map(len,removed['collision'].values())),
        'excavatedEarthDrawingTriangles':len(removed['drawing']['earth']),
        'solidOverlapSamples':len(overlaps),'status':'Native candidate; export, preservation and travel validation pending'}
    edit['riverConnection']=connection
    edit['previousNativeSha256']=edit['nativeSha256']
    scene.view_layers[0].update();cylinder.view_layers[0].update()
    output.mkdir(parents=True)
    target=output/'izma-motorway-integration.blend'
    bpy.data.libraries.write(str(target),{scene,cylinder},fake_user=True,compress=True)
    edit['nativeSha256']=hashlib.sha256(target.read_bytes()).hexdigest()
    target.with_suffix('.json').write_bytes(encoded(edit))
    print(json.dumps({k:v for k,v in connection.items() if k not in ['points','widths']}),flush=True)


if __name__ == '__main__':
    parser=argparse.ArgumentParser()
    parser.add_argument('--integration-root',type=Path,required=True)
    parser.add_argument('--output-root',type=Path,required=True)
    args=parser.parse_args(sys.argv[sys.argv.index('--')+1:])
    connect(args.integration_root,args.output_root)
