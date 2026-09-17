"""Export the edited SWL_ scene meshes, not regenerated terrain formulas.
Rendering and collision use the exact same LOD0 triangles. Overhangs and
vertical walls are retained in Rapier; analytic grounding samples top faces.
"""
import bpy
import json
import math
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
library={}
for world in ['izma','cooper','elysium']:
    scene=bpy.data.scenes['SWL_'+world]
    scene.view_layers[0].update()
    data={'name':scene['label'],'extent':list(scene['extent']),'spawn':list(scene['spawn']),
          'lookAt':list(scene['look_at']),'palette':{},'lods':[{}, {}, {}], 'surfaces':[], 'solids':[], 'routes':[]}
    for field in ['visits','walks','materialDetails']:
        if scene.get(field):data[field]=json.loads(scene[field])
    tiles={}
    for obj in scene.objects:
        if obj.type=='LIGHT' and obj.get('landscape_light'):
            data.setdefault('lights',[]).append({'position':[round(v,4) for v in obj.location],
                'color':obj['light_color'],'intensity':obj['light_intensity'],'distance':obj['light_distance']})
        if obj.type=='CURVE' and obj.get('route'):
            data['routes'].append({'name':obj.name.removesuffix('_alignment'),'width':obj['width'],
                                   'points':[[round(v,4) for v in (obj.matrix_world @ p.co.to_3d())] for p in obj.data.splines[0].points]})
        if obj.type!='MESH':continue
        obj.data.calc_loop_triangles()
        key=obj['material'];data['palette'][key]=obj.data.materials[0]['srgb']
        lod=obj['lod'];triangles=[]
        for tri in obj.data.loop_triangles:
            xyz=[obj.matrix_world @ obj.data.vertices[i].co for i in tri.vertices]
            flat=[round(v,4) for p in xyz for v in p]
            triangles.extend(flat)
            if obj.get('surface'):
                centre=[sum(p[k] for p in xyz)/3 for k in (0,1)]
                tile=(math.floor(centre[0]/64),math.floor(centre[1]/64))
                tiles.setdefault(tile,[]).extend(flat)
        for level in range(3):
            if lod in [-1,level]:data['lods'][level].setdefault(key,[]).extend(triangles)
        if obj.get('solid'):
            w,d,h=obj['solid'];x,y,z=obj.location
            if any(abs(s-1)>1e-6 for s in obj.scale) or abs(obj.rotation_euler.x)+abs(obj.rotation_euler.y)>1e-6:
                raise ValueError('Apply scale / use horizontal solids before export: '+obj.name)
            data['solids'].append({'x':x,'y':y,'z':z,'width':w,'depth':d,'height':h,'yaw':obj.rotation_euler.z})
    for vertices in tiles.values():
        xs,ys=vertices[0::3],vertices[1::3]
        data['surfaces'].append({'vertices':vertices,'bounds':[min(xs),min(ys),max(xs),max(ys)]})
    library[world]=data
packed={}
for key,data in library.items():
    pool=[];lookup={}
    def indices(values):
        result=[]
        for i in range(0,len(values),3):
            point=tuple(values[i:i+3])
            index=lookup.get(point)
            if index is None:
                index=len(pool)//3;lookup[point]=index;pool.extend(point)
            result.append(index)
        return result
    packed[key]={**data,'encoding':'indexed-v1','vertices':pool,
                 'lods':[{name:indices(v) for name,v in lod.items()} for lod in data['lods']],
                 'surfaces':[{'indices':indices(s['vertices']),'bounds':s['bounds']} for s in data['surfaces']]}
out=ROOT/'src/worlds/generated/worldLandscapes.json';out.parent.mkdir(parents=True,exist_ok=True)
out.write_text(json.dumps(packed,separators=(',',':'))+'\n')
result={'output':str(out),'bytes':out.stat().st_size,'worlds':{key:{'surfaces':len(d['surfaces']),'solids':len(d['solids']),
         'triangles':[sum(len(v)//9 for v in lod.values()) for lod in d['lods']]} for key,d in library.items()}}
