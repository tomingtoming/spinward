"""Refresh native entrance sides and supported lights in a separate part set.

The parcel contract, doors, streets, buildings and existing LODs remain intact.
Pass explicit --source-root, --output-root (native asset directories) and
--manifest. The output index records every revised native file before export.
"""
import argparse
import hashlib
import json
import math
from pathlib import Path
import sys
import bpy
from mathutils.bvhtree import BVHTree

sys.path.insert(0, str(Path(__file__).resolve().parent))
from colony_manifest_io import read_manifest
from izma_mesh_builder import BuildingMeshBuilder
from izma_city_entry_sides import append_entry_sides


def digest(path):return hashlib.sha256(path.read_bytes()).hexdigest()


def refit(source, output, manifest_path):
    assert all(p.is_absolute() for p in [source, output, manifest_path])
    assert source != output and not output.exists(), 'Preserve the previous native parts'
    contract_path = source/'izma-city-neighbourhoods.json'
    contract = json.loads(contract_path.read_text())
    index = json.loads((source/'izma-city-neighbourhoods-native.json').read_text())
    assert index['contractSha256'] == digest(contract_path)
    manifest = read_manifest(manifest_path)
    base = manifest['base'];pool = base['vertices'];ids = base['meshes']['earth']
    points = [((3200-h)*math.cos(x/3200), y, (3200-h)*math.sin(x/3200))
              for x,y,h in [pool[i:i+3] for i in range(0,len(pool),3)]]
    earth = BVHTree.FromPolygons(points, [ids[i:i+3] for i in range(0,len(ids),3)], all_triangles=True)
    heights = {}
    def ground(p):
        key = tuple(p)
        if key not in heights:
            c,s = math.cos(p[0]/3200),math.sin(p[0]/3200)
            hit = earth.ray_cast((c*3000,p[1],s*3000),(c,0,s),400)[0]
            assert hit is not None, ('Entrance outside native earth', p)
            heights[key] = 3200-math.hypot(hit.x,hit.z)
        return heights[key]
    new_ids = set(contract['cityFabric']['newParcelIds'])
    existing_lamps = [p['position'][:2] for p in manifest['neighbourhoods']['lights']]
    lamps = {};positions = list(existing_lamps)
    for p in sorted(contract['parcels'],key=lambda p:p['id']):
        if p['id'] not in new_ids:continue
        a = p['entrance']['end'];c,s = math.cos(p['yaw']),math.sin(p['yaw'])
        width = 2.8 if p['family'] in ['office','civic'] else 1.9 if p['family']=='apartment' else 1.1
        offset = width/2+.18
        x,y = a[0]+c*offset+s*.18,a[1]+s*offset-c*.18
        if any((x-q[0])**2+(y-q[1])**2 < 30**2 for q in positions):continue
        positions.append([x,y]);lamps[p['id']]=[x,y,p['floor']+2.59]
    report = {'contractSha256':digest(contract_path),'sourceIndexSha256':digest(source/'izma-city-neighbourhoods-native.json'),
              'entrySidesSha256':digest(Path(__file__).with_name('izma_city_entry_sides.py')),
              'entrances':0,'addedCollisionTriangles':0,'lamps':len(lamps),'districts':{},'parts':[]}
    output.mkdir(parents=True)
    (output/contract_path.name).write_bytes(contract_path.read_bytes())
    for part in index['parts']:
        assert digest(source/part['file']) == part['sha256']
        bpy.ops.wm.read_factory_settings(use_empty=True)
        with bpy.data.libraries.load(str(source/part['file']),link=False) as (_,loaded):loaded.scenes=[part['scene']]
        scene = loaded.scenes[0];objects = {o.name:o for o in scene.objects}
        materials = {m.get('spinward_material',m.name.removeprefix('SWD_')):m
                     for o in scene.objects if o.type=='MESH' for m in o.data.materials}
        for name in ['foundation','metal','lantern']:
            if name not in materials:
                material=bpy.data.materials.new('SWD_'+name)
                definition=contract['materials'][name]
                material.diffuse_color=tuple(int(definition['color'][i:i+2],16)/255 for i in [1,3,5])+(1,)
                material['spinward_material']=name
                materials[name]=material
        count = 0;lights = 0
        for p in contract['parcels']:
            if p['id'] not in new_ids or p['district'] != part['district']:continue
            obj = objects[p['id']+'_entry']
            assert not obj.get('entry_sides_revision'), ('Already revised',obj.name)
            builder = BuildingMeshBuilder(scene,materials,objects)
            old = obj.data;flags = old.attributes['ground_surface']
            for face in old.polygons:
                material = old.materials[face.material_index]
                key = material.get('spinward_material',material.name.removeprefix('SWD_'))
                builder.face([tuple(old.vertices[i].co) for i in face.vertices],key,flags.data[face.index].value)
            before = len(builder.f)
            append_entry_sides(builder,p,ground)
            report['addedCollisionTriangles'] += 2*(len(builder.f)-before)
            obj = builder.finish(obj.name,p,-1);obj['entry_sides_revision']=1
            count += 1
            if p['id'] not in lamps:continue
            x,y,h = lamps[p['id']];c,s = math.cos(p['yaw']),math.sin(p['yaw'])
            dx,dy=x-p['position'][0],y-p['position'][1]
            u,v,z=c*dx+s*dy,-s*dx+c*dy,h-p['floor']
            for lod in [0,1]:
                lamp = BuildingMeshBuilder(scene,materials)
                # The back enters the wall by 2 cm; the front stays behind
                # the diffuser. A freestanding casing is not a wall fitting.
                lamp.box(u,v+.08,z-.09,.24,.24,.2,'metal')
                lamp.box(u,v-.045,z-.055,.17,.025,.11,'lantern')
                fixture=lamp.finish(p['id']+f'_entry_light{lod}',p,lod)
                fixture['fixture_revision']=2
            data=bpy.data.lights.new(p['id']+'_entry_light','POINT');data.energy=80
            light=bpy.data.objects.new(data.name,data);scene.collection.objects.link(light)
            light.location=(y-c*.075,-(x+s*.075),h)
            light['parcel_id']=p['id'];light['color']='#ffdfa8';light['intensity']=80;light['distance']=18
            lights += 1
        scene.view_layers[0].update()
        assert all(o.library is None and (o.type!='MESH' or o.data.library is None) for o in scene.objects)
        target=output/part['file'];bpy.data.libraries.write(str(target),{scene},fake_user=True,compress=True)
        part.update({'sha256':digest(target),'bytes':target.stat().st_size,'objects':len(scene.objects)})
        report['entrances']+=count;report['districts'][part['district']]={'entrances':count,'lights':lights}
        report['parts'].append(dict(part));print(json.dumps({'district':part['district'],'entrances':count,'lights':lights}),flush=True)
    assert report['entrances']==len(new_ids)
    assert sum(v['lights'] for v in report['districts'].values())==len(lamps)
    index['streetDetailsRevision']={'version':1,'sourceIndexSha256':report['sourceIndexSha256'],
                                    'scriptSha256':digest(Path(__file__)),'entrySidesSha256':report['entrySidesSha256'],
                                    'entrances':report['entrances'],'lights':len(lamps)}
    assert report['entrySidesSha256']==digest(Path(__file__).with_name('izma_city_entry_sides.py'))
    (output/'izma-city-neighbourhoods-native.json').write_text(json.dumps(index,indent=2)+'\n')
    (output/'street-details-report.json').write_text(json.dumps(report,indent=2)+'\n')
    print(json.dumps({k:v for k,v in report.items() if k!='parts'}),flush=True)


if __name__=='__main__':
    parser=argparse.ArgumentParser()
    parser.add_argument('--source-root',type=Path,required=True)
    parser.add_argument('--output-root',type=Path,required=True)
    parser.add_argument('--manifest',type=Path,required=True)
    args=parser.parse_args(sys.argv[sys.argv.index('--')+1:])
    refit(args.source_root,args.output_root,args.manifest)
