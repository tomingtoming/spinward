"""Original Spinward architectural entourage; metres, Y-up/+Z-forward in glTF.
Run through Blender MCP with __file__ set. Creates a separate scene and saves a
copy, preserving the user's current scene. Articulated named joints are driven
by the runtime; no external model, texture or animation dependencies.
"""
import bpy, math, json, struct
from pathlib import Path
from mathutils import Vector
ROOT=Path(__file__).resolve().parents[2]
previous=bpy.context.window.scene
# Replace only this generator's tagged output. Unrelated scenes are retained.
for old in list(bpy.data.scenes):
    if old.get('spinward_asset') != 'resident-v1': continue
    if previous == old:
        previous = next((s for s in bpy.data.scenes if s != old), None)
        if previous is None: previous=bpy.data.scenes.new('Scene')
        bpy.context.window.scene=previous
    for obj in list(old.objects):
        if len(obj.users_scene)==1: bpy.data.objects.remove(obj,do_unlink=True)
    bpy.data.scenes.remove(old)
scene=bpy.data.scenes.new('Spinward Neighbourhood People')
bpy.context.window.scene=scene
scene['spinward_asset']='resident-v1'
scene.unit_settings.system='METRIC'
def xyz(p): return (p[0],-p[2],p[1])
def material(name,color):
    m=bpy.data.materials.get(name) or bpy.data.materials.new(name); m.diffuse_color=(*color,1); m.use_nodes=True
    bs=m.node_tree.nodes.get('Principled BSDF'); bs.inputs['Base Color'].default_value=(*color,1); bs.inputs['Roughness'].default_value=.88
    return m
cloth=material('resident_cloth',(.19,.255,.24)); pants=material('resident_trousers',(.105,.135,.15))
skin=material('resident_skin',(.48,.32,.235)); hair=material('resident_hair',(.07,.055,.045)); shoes=material('resident_shoes',(.065,.07,.065))
def joint(name,parent,p):
    o=bpy.data.objects.new(name,None); scene.collection.objects.link(o); o.parent=parent; o.location=xyz(p); return o
def ellipsoid(name,parent,p,scale,mat):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=12,ring_count=8)
    o=bpy.context.object;o.name=name;o.parent=parent;o.location=xyz(p);o.scale=(scale[0],scale[2],scale[1]);o.data.materials.append(mat)
    for poly in o.data.polygons:poly.use_smooth=True
    return o
# A restrained 1.76m adult, about 7.5 heads tall; overlapping tapered cloth
# volumes hide articulation seams without cubes or oversized joints.
root=joint('resident',None,(0,0,0)); pelvis=joint('pelvis',root,(0,.96,0))
ellipsoid('hips',pelvis,(0,0,0),(.165,.145,.105),pants)
torso=joint('torso',pelvis,(0,.04,0))
ellipsoid('shirt',torso,(0,.22,0),(.205,.285,.12),cloth)
ellipsoid('shirt_hem',torso,(0,.025,0),(.165,.075,.105),cloth)
ellipsoid('collar',torso,(0,.445,0),(.075,.045,.073),cloth)
ellipsoid('neck',torso,(0,.48,0),(.052,.065,.055),skin)
head=joint('head',torso,(0,.615,.006))
ellipsoid('face',head,(0,0,.013),(.088,.119,.093),skin)
ellipsoid('hair',head,(0,.041,-.016),(.091,.092,.088),hair)
ellipsoid('nose',head,(0,-.005,.1),(.016,.023,.018),skin)
for side,x in [('left',-.029),('right',.029)]:
    ellipsoid(side+'_eye',head,(x,.027,.103),(.007,.0045,.005),hair)
for side,x in [('left',-.112),('right',.112)]:
    hip=joint(side+'_hip',pelvis,(x,-.045,0))
    ellipsoid(side+'_thigh',hip,(0,-.205,0),(.089,.24,.094),pants)
    knee=joint(side+'_knee',hip,(0,-.43,0))
    ellipsoid(side+'_knee_cloth',knee,(0,0,0),(.069,.064,.072),pants)
    ellipsoid(side+'_calf',knee,(0,-.192,0),(.065,.216,.071),pants)
    ellipsoid(side+'_shoe',knee,(0,-.41,.046),(.069,.055,.133),shoes)
    shoulder=joint(side+'_shoulder',torso,(-.207 if side=='left' else .207,.376,0))
    ellipsoid(side+'_sleeve',shoulder,(0,-.135,0),(.065,.167,.066),cloth)
    elbow=joint(side+'_elbow',shoulder,(0,-.282,0))
    ellipsoid(side+'_elbow_cuff',elbow,(0,0,0),(.049,.045,.048),cloth)
    ellipsoid(side+'_forearm',elbow,(0,-.108,0),(.042,.135,.043),cloth)
    ellipsoid(side+'_hand',elbow,(0,-.249,.008),(.041,.073,.027),skin)
# Separate first-person sleeve/palm is held relative to the mug; no cloned body
# attached to the camera, so looking down does not rotate one's legs into view.
handroot=joint('cup_hand',None,(0,0,0))
ellipsoid('grip_palm',handroot,(.06,.04,0),(.034,.045,.025),skin)
for n in range(4):ellipsoid('grip_finger_'+str(n),handroot,(.045,.014+n*.013,.008),(.024,.006,.014),skin)
ellipsoid('grip_thumb',handroot,(.045,.073,-.008),(.026,.012,.014),skin)
start=Vector((.065,.027,.017)); end=Vector((.33,-.20,.48))
centre=(start+end)/2
sleeve=ellipsoid('grip_sleeve',handroot,centre,(.055,(end-start).length/2+.06,.055),cloth)
sleeve.rotation_mode='QUATERNION'
sleeve.rotation_quaternion=Vector((0,0,1)).rotation_difference(Vector(xyz(end-start)))
# Export only this scene. Temporarily hide the hand for the source viewport.
bpy.ops.object.select_all(action='DESELECT')
for o in scene.objects:o.select_set(True)
path=ROOT/'public/assets/people/resident.glb'
bpy.ops.export_scene.gltf(filepath=str(path),export_format='GLB',use_selection=True,use_active_scene=True,export_yup=True,export_animations=False)
# Selection alone includes selected objects from other open scenes. Check the
# actual output, not just the source scene, before publishing an audit or blend.
data=path.read_bytes()
gltf=json.loads(data[20:20+struct.unpack_from('<I',data,12)[0]])
assert len(gltf['scenes'])==1 and not gltf.get('images')
assert {gltf['nodes'][i]['name'] for i in gltf['scenes'][0]['nodes']}=={'resident','cup_hand'}
assert len(data)<250000, 'Resident GLB exceeded its standalone asset budget'
report={'original':True,'heightMetres':1.76,'bytes':path.stat().st_size,'triangles':sum(sum(len(p.vertices)-2 for p in o.data.polygons) for o in scene.objects if o.type=='MESH'),'joints':[o.name for o in scene.objects if o.type=='EMPTY']}
(ROOT/'assets/blender/resident-audit.json').write_text(json.dumps(report,indent=2)+'\n')
handroot.hide_set(True)
# A source asset carries this scene and its dependencies, not the entire GUI
# session (which may also contain building/furniture authoring scenes).
bpy.data.libraries.write(str(ROOT/'assets/blender/resident.blend'),{scene},compress=True)
bpy.context.window.scene=previous
result=report
