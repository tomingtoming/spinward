"""Inspect the saved bridge scenes and actual supports above lamp emitters."""
import argparse
import hashlib
import json
import math
from pathlib import Path
import sys
import bpy
from mathutils.bvhtree import BVHTree

def audit(candidate):
    native=candidate/'assets/blender/izma-interband.blend'
    report=json.loads(native.with_suffix('.json').read_text())
    assert hashlib.sha256(native.read_bytes()).hexdigest()==report['nativeSha256']
    bpy.ops.wm.open_mainfile(filepath=str(native))
    scene=bpy.data.scenes['SW_izma_interband'];wrapped=bpy.data.scenes['SW_izma_interband_cylinder']
    scene.view_layers[0].update();wrapped.view_layers[0].update()
    vertices=[];triangles=[];maximum=0.;count=0
    for obj in scene.objects:
        assert obj.library is None and obj.get('owner')==report['owner']
        if obj.type!='MESH':continue
        other=wrapped.objects.get(obj.name+'_cylinder');assert other is not None
        assert len(other.data.vertices)==len(obj.data.vertices)
        base=len(vertices)
        for v,w in zip(obj.data.vertices,other.data.vertices):
            p=obj.matrix_world @ v.co;vertices.append(tuple(p));x,y,h=-p.y,p.x,p.z
            expected=(math.cos(x/3200)*(3200-h),y,math.sin(x/3200)*(3200-h))
            maximum=max(maximum,math.dist(expected,w.co));count+=1
        obj.data.calc_loop_triangles()
        triangles.extend(tuple(base+i for i in t.vertices) for t in obj.data.loop_triangles)
    assert maximum<.002,('Unfolded/cylindrical bridge scenes disagree',maximum)
    tree=BVHTree.FromPolygons(vertices,triangles,all_triangles=True)
    lamps=[]
    for obj in scene.objects:
        if obj.type!='LIGHT':continue
        hit=tree.ray_cast(obj.matrix_world.translation,(0,0,1),.4)
        assert hit[0] is not None,('Lamp has no physical upper housing',obj.name)
        lamps.append({'name':obj.name,'housingDistance':hit[3]})
    assert len(lamps)==report['supportedLights']
    result={'origin':'ai','created':'2026-09-20','nativeSha256':report['nativeSha256'],
            'mappedVertices':count,'maximumSceneError':maximum,'supportedLights':len(lamps),
            'maximumLampHousingDistance':max(l['housingDistance'] for l in lamps),
            'scope':'saved scene mapping and emitter housings; ground/traversal/collision audited separately'}
    (candidate/'interband-native-audit.json').write_text(json.dumps(result,indent=2)+'\n');print(json.dumps(result),flush=True)

if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--candidate-root',type=Path,required=True)
    args=parser.parse_args(sys.argv[sys.argv.index('--')+1:]);audit(args.candidate_root)
