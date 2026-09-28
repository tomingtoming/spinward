"""Author the JCT replacement and clipped retained pieces in native Blender.

The edit ledger binds every retired triangle to the current source hash. Both
base and the installed motorway layer are examined. Canonical files are never
modified here; export and combined-mesh acceptance are separate stages.
"""
import argparse
from collections import defaultdict
import hashlib
import json
import math
from pathlib import Path
import sys
import bpy

ASSETS=Path(__file__).resolve().parent;ROOT=ASSETS.parents[1]
sys.path.insert(0,str(ASSETS))
from colony_manifest_io import read_manifest,encoded
from izma_mesh_builder import BuildingMeshBuilder
from izma_motorway_replacement import FootprintCuts,prism_planes,split_planes,face_area
from plan_izma_junctions import at_axis


def compose(candidate,output):
    assert candidate.is_absolute() and output.is_absolute() and not output.exists() and output!=ROOT
    native=candidate/'assets/blender/izma-junctions.blend'
    plan_path=native.with_name('izma-junction-plan.json');plan=json.loads(plan_path.read_text())
    model=json.loads(native.with_suffix('.json').read_text())
    assert hashlib.sha256(native.read_bytes()).hexdigest()==model['nativeSha256']
    assert hashlib.sha256(plan_path.read_bytes()).hexdigest()==model['planSha256']
    document=ROOT/'src/worlds/generated/izmaColony.json'
    assert json.loads(document.read_text())['sourceSha256']==plan['sourceSha256']
    source=read_manifest(document)
    routes=json.loads((ASSETS/'izma-motorway-routes.json').read_text())
    assert routes['sourceSha256']==plan['sourceSha256']
    profiles={r['id']:r['points'] for r in routes['profiles']}
    intervals=[]
    for road in model['mainlinePatches']:
        site=next(s for s in plan['sites'] if s['id']==road['site'])
        ys=[p[1] for p in road['points']]
        intervals.append({'owner':site['id'],'kind':'replace','band':site['band'],'x':site['x'],
                          'low':min(ys),'high':max(ys),'halfWidth':12.32})
    for tail in plan['terminalRetirements']:
        # The old shared terminal cap now belongs to the general road. Keep
        # its complete 12.25 m radius, paving margins and retaining structure.
        end=tail['to']-math.copysign(15.5,tail['to'])
        intervals.append({'owner':tail['id'],'kind':'retire-tail','band':tail['band'],'x':tail['x'],
                          'low':min(tail['from'],end),'high':max(tail['from'],end),'halfWidth':12.32})
    cuts=[];planes=[]
    for region in intervals:
        original=profiles[f"band-{region['band']}-expressway"]
        ps=[at_axis(original,region['low'],1),*[p for p in original if region['low']<p[1]<region['high']],at_axis(original,region['high'],1)]
        for a,b in zip(ps,ps[1:]):
            x=region['x'];w=region['halfWidth'];lo,hi=a[1],b[1]
            poly=[(x-w,lo),(x+w,lo),(x+w,hi),(x-w,hi)]
            slope=(b[2]-a[2])/(hi-lo);intercept=a[2]-slope*lo
            cuts.append((region['owner'],poly))
            planes.append(prism_planes(poly)+[((0,-slope,1),-intercept+2.42),
                                               ((0,slope,-1),intercept+6.8)])
    grid=FootprintCuts(cuts)
    area_error=0.
    def clip(poly):
        nonlocal area_error
        indices=sorted({i for cell in grid.cells(poly) for i in grid.grid.get(cell,[])})
        remaining=[poly];removed=[]
        for index in indices:
            parts=[]
            for part in remaining:
                outside,inside=split_planes(part,planes[index]);parts.extend(outside)
                if inside:removed.append((cuts[index][0],inside))
            remaining=parts
            if not remaining:break
        if removed:
            difference=abs(face_area(poly)-sum(face_area(p) for p in remaining)-sum(face_area(p) for _,p in removed))
            area_error=max(area_error,difference)
            assert difference<.0001,('Nonconserving cut',difference)
        return remaining,removed

    retired_boxes=[]
    for index,box in enumerate(source['structures']):
        x,y,z,w,d,h,yaw=box
        if abs(w-2.4)>.015 or abs(d-2.4)>.015:continue
        for tail in plan['terminalRetirements']:
            last=tail['to']-math.copysign(18,tail['to'])
            if min(tail['from'],last)+2<y<max(tail['from'],last)-2 and abs(x-tail['x'])<10:
                deck=at_axis(profiles[f"band-{tail['band']}-expressway"],y,1)[2]
                if abs(z+h-(deck-2.4))<.02:
                    retired_boxes.append({'index':index,'before':box,'owner':tail['id'],'drawingTriangles':0})
    def old_pier(poly):
        for item in retired_boxes:
            x,y,z,w,d,h,yaw=item['before'];c,s=math.cos(yaw),math.sin(yaw)
            if all(abs((p[0]-x)*c+(p[1]-y)*s)<=w/2+.015 and
                   abs(-(p[0]-x)*s+(p[1]-y)*c)<=d/2+.015 and z-.015<=p[2]<=z+h+.015 for p in poly):return item
        return None

    bpy.ops.wm.open_mainfile(filepath=str(native));original=bpy.data.scenes['SW_izma_junctions']
    original.view_layers[0].update()
    scene=bpy.data.scenes.new('SW_izma_junctions_integration');bpy.context.window.scene=scene
    scene['owner']='spinward-izma-junctions-integration-v1';scene['sourceSha256']=plan['sourceSha256']
    scene['candidateSha256']=model['nativeSha256'];scene['runtime_accepted']=False
    scene.unit_settings.system='METRIC';scene.unit_settings.scale_length=1
    palette=dict(source['palette']);palette.update({'junction-'+k:v for k,v in
                                                  {'road':'#676c69','structure':'#969b96','rail':'#737d79','mark':'#d5cdb8'}.items()})
    materials={}
    for name,color in palette.items():
        material=bpy.data.materials.new('SWJI_'+name);material.diffuse_color=tuple(int(color[i:i+2],16)/255 for i in [1,3,5])+(1,)
        material['spinward_material']=name;materials[name]=material
    builders={};counts=defaultdict(int)
    def append(owner,kind,material,poly,drawing,physical,floor):
        key=(owner,kind,drawing,physical)
        builder=builders.setdefault(key,BuildingMeshBuilder(scene,materials))
        site=next(s for s in plan['sites'] if s['id']==owner)
        for i in range(1,len(poly)-1):
            tri=[poly[0],poly[i],poly[i+1]]
            if face_area(tri)<1e-8:continue
            builder.face([(p[0]-site['x'],p[1]-site['y'],p[2]) for p in tri],material,floor)
            counts[kind]+=1
    drawing_remove={};collision_remove={}
    for layer,packed in [('base',source['base']),('motorway',source['motorway']['fixed'])]:
        points=[tuple(packed['vertices'][i:i+3]) for i in range(0,len(packed['vertices']),3)]
        drawing_remove[layer]=defaultdict(list);collision_remove[layer]=defaultdict(list)
        for material,ids in packed['meshes'].items():
            if material in ['earth','reserve','water','verge','ballast']:continue
            for offset in range(0,len(ids),3):
                poly=[points[i] for i in ids[offset:offset+3]]
                pier=old_pier(poly) if layer=='base' and material=='structure' else None
                if pier:
                    drawing_remove[layer][material].append(offset//3);pier['drawingTriangles']+=1;continue
                kept,removed=clip(poly)
                if not removed:continue
                owners={owner for owner,_ in removed};assert len(owners)==1,owners
                drawing_remove[layer][material].append(offset//3)
                for part in kept:append(next(iter(owners)),'retained-drawing',material,part,True,False,False)
        for surface_index,surface in enumerate(packed['surfaces']):
            ids=surface['indices'];floor=surface.get('groundSurface',True)
            for offset in range(0,len(ids),3):
                poly=[points[i] for i in ids[offset:offset+3]]
                kept,removed=clip(poly)
                if not removed:continue
                owners={owner for owner,_ in removed};assert len(owners)==1,owners
                collision_remove[layer][str(surface_index)].append(offset//3)
                for part in kept:append(next(iter(owners)),'retained-collision','expressway' if floor else 'parapet',part,False,True,floor)
        print(json.dumps({'phase':layer,'drawing':sum(len(v) for v in drawing_remove[layer].values()),
                          'collision':sum(len(v) for v in collision_remove[layer].values())}),flush=True)
    assert all(p['drawingTriangles']==12 for p in retired_boxes),retired_boxes
    records=[]
    for (owner,kind,drawing,physical),builder in builders.items():
        site=next(s for s in plan['sites'] if s['id']==owner)
        parcel={'position':[site['x'],site['y']],'floor':0,'yaw':0,'id':owner+'-'+kind,'district':'junctions','family':'infrastructure'}
        obj=builder.finish('SWJI_'+parcel['id'],parcel,-1)
        obj['owner']=scene['owner'];obj['junction_id']=owner;obj['role']=kind;obj['drawing']=drawing;obj.hide_render=not drawing
        flag=obj.data.attributes.new('physical','BOOLEAN','FACE')
        for value in flag.data:value.value=physical
        records.append({'name':obj.name,'faces':len(obj.data.polygons),'drawing':drawing,'physical':physical})
    for obj in original.objects:
        copy=obj.copy();copy.data=obj.data.copy();scene.collection.objects.link(copy)
        copy['owner']=scene['owner'];copy['drawing']=copy.get('role')!='centreline'
        if copy['drawing']:records.append({'name':copy.name,'faces':len(copy.data.polygons),'drawing':True,'physical':'mixed'})
    retired_lights=[]
    for index,light in enumerate(source['motorway']['lights']):
        x,y,h=light['position']
        if any(abs(x-r['x'])<14 and r['low']<=y<=r['high'] for r in intervals):retired_lights.append(index)
    scene.view_layers[0].update()
    output.mkdir(parents=True)
    target=output/'izma-junctions-integration.blend'
    bpy.data.libraries.write(str(target),{scene},fake_user=True,compress=True)
    result={'origin':'ai','created':'2026-09-21','sourceSha256':plan['sourceSha256'],
            'candidateSha256':model['nativeSha256'],'planSha256':model['planSha256'],
            'nativeSha256':hashlib.sha256(target.read_bytes()).hexdigest(),'owner':scene['owner'],
            'intervals':intervals,'drawingRemove':drawing_remove,'collisionRemove':collision_remove,
            'retiredStructures':retired_boxes,'retiredMotorwayLights':retired_lights,
            'palette':palette,'maximumAreaConservationError':area_error,'objects':records,
            'status':'Uninstalled native replacement. Complete source mesh, lighting, collision budget, LOD and runtime verification remain.'}
    target.with_suffix('.json').write_bytes(encoded(result))
    return {'nativeSha256':result['nativeSha256'],'retiredStructures':len(retired_boxes),
            'retiredMotorwayLights':len(retired_lights),'areaError':area_error,
            'drawingRemoved':{k:sum(map(len,v.values())) for k,v in drawing_remove.items()},
            'collisionRemoved':{k:sum(map(len,v.values())) for k,v in collision_remove.items()}}


if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--candidate-root',type=Path,required=True);p.add_argument('--output-root',type=Path,required=True)
    a=p.parse_args(sys.argv[sys.argv.index('--')+1:]);print(json.dumps(compose(a.candidate_root,a.output_root)),flush=True)
