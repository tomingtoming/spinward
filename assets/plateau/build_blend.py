"""Run through Blender MCP's isolated CLI process. Keep GUI and accepted world untouched."""
import bpy
import json
import math
from pathlib import Path
import numpy as np


def build(root,target=None):
    root=Path(root);derived=root/'derived';study=json.loads((derived/'study.json').read_text())
    # Only the new background process is reset; no user-open scene or source file is overwritten.
    bpy.ops.wm.read_factory_settings(use_empty=True)
    materials={}
    def material(name,color,roughness=.96):
        if name in materials:return materials[name]
        m=bpy.data.materials.new(name);rgb=[int(color[k:k+2],16)/255 for k in (1,3,5)]
        # JSON colours are sRGB, Blender material values are scene linear.
        linear=[c/12.92 if c<=.04045 else ((c+.055)/1.055)**2.4 for c in rgb]
        m.diffuse_color=(*linear,1);m.use_nodes=True
        m.node_tree.nodes.get('Principled BSDF').inputs['Base Color'].default_value=(*linear,1)
        m.node_tree.nodes.get('Principled BSDF').inputs['Roughness'].default_value=roughness
        materials[name]=m;return m
    def mesh_object(collection,name,p,idx,mat):
        mesh=bpy.data.meshes.new(name);mesh.from_pydata(p.tolist(),[],idx.reshape(-1,3).tolist());mesh.update()
        obj=bpy.data.objects.new(name,mesh);collection.objects.link(obj);mesh.materials.append(mat);return obj
    def setup(scene):
        scene.unit_settings.system='METRIC';scene.unit_settings.scale_length=1
        scene['source']='PLATEAU / GSI / MLIT N02; transformed by Spinward, 2026-09-22'
        scene['scope']='1.4 km square samples; LOD1 massing, not completed streets or full bands'
    report=[];curved=bpy.data.scenes.new('04_Cylinder_3_bands');setup(curved)
    for sample in study['samples']:
        scene=bpy.data.scenes.new(f"{sample['band']+1:02}_{sample['id']}_source");setup(scene)
        source=bpy.data.collections.new(sample['station']+'_source_geometry');scene.collection.children.link(source)
        wrapped=bpy.data.collections.new(sample['id']+'_wrapped');curved.collection.children.link(wrapped)
        source['epsg']=sample['frame']['epsg'];source['baseline_orthometric_m']=sample['baselineM']
        source['projection_origin']=sample['frame']['origin'];source['rotation_radians']=sample['frame']['angle']
        features=json.loads((derived/sample['features']).read_text())
        replacements=set(json.loads((derived/sample['frontage']).read_text())['buildingIds']) if sample.get('frontage') else set()
        for item in sample['meshes']:
            p=np.fromfile(derived/item['path']/item['positions'],dtype='<f4').reshape(-1,3)
            idx=np.fromfile(derived/item['path']/item['indices'],dtype='<u4')
            mat=material(item['name'],item['material'],item.get('roughness',.96))
            if item['name']=='buildings':
                for f in features:
                    selected=idx[f['firstIndex']:f['firstIndex']+f['indexCount']]
                    ids,local=np.unique(selected,return_inverse=True)
                    obj=mesh_object(source,f['id'],p[ids],local,mat)
                    obj['gml_id']=f['id'];obj['source_lod']=f['sourceLod'];obj['source_bounds_lon_lat_height']=f['bounds']
                    obj['usage']=f['usage'] or 'unknown'
                    if f['id'] in replacements:
                        obj.hide_render=True;obj.hide_viewport=True
                        obj['replaced_by']='authored frontage meshes; original retained as hidden source'
            else:mesh_object(source,item['name'],p,idx,mat)
            a=(p[:,0]+sample['anchor']['local'][0])/study['radius']+sample['band']*math.tau/3
            r=study['radius']-p[:,2]
            q=np.column_stack([r*np.sin(a),p[:,1]+sample['anchor']['local'][1],-r*np.cos(a)])
            wrapped_indices=np.concatenate([idx[f['firstIndex']:f['firstIndex']+f['indexCount']] for f in features if f['id'] not in replacements]) if item['name']=='buildings' and replacements else idx
            mesh_object(wrapped,sample['id']+'_'+item['name'],q,wrapped_indices,mat)
        report.append(dict(id=sample['id'],buildings=len(features),sourceObjects=len(source.objects),wrappedObjects=len(wrapped.objects)))
    guides=bpy.data.collections.new('Unimported_band_boundaries_ONLY');curved.collection.children.link(guides)
    for band in range(3):
        curve=bpy.data.curves.new(f'band_{band+1}_40km_boundary','CURVE');curve.dimensions='3D'
        sp=curve.splines.new('POLY');coordinates=[]
        for y in (-study['span']/2,study['span']/2):
            for i in range(49):
                x=(i/48-.5)*study['bandWidth']*(1 if y<0 else -1);a=x/study['radius']+band*math.tau/3
                coordinates.append((study['radius']*math.sin(a),y,-study['radius']*math.cos(a),1))
        sp.points.add(len(coordinates)-1)
        for pt,co in zip(sp.points,coordinates):pt.co=co
        sp.use_cyclic_u=True;obj=bpy.data.objects.new(curve.name,curve);guides.objects.link(obj)
    note=bpy.data.texts.new('READ_ME_Source_and_limits')
    note.write('Spinward — real-city transfer study\n\n'+json.dumps(study,ensure_ascii=False,indent=2))
    bpy.context.window.scene=bpy.data.scenes['01_tokyo_source']
    for screen in bpy.data.screens:
        for area in screen.areas:
            if area.type=='VIEW_3D':
                area.spaces.active.clip_end=100000
                area.spaces.active.region_3d.view_distance=2100
                area.spaces.active.region_3d.view_location=(0,0,0)
    target=Path(target) if target else root/'spinward-plateau-three-cities.blend'
    bpy.ops.wm.save_as_mainfile(filepath=str(target),compress=True)
    result=dict(path=str(target),scenes=[s.name for s in bpy.data.scenes],samples=report,objects=len(bpy.data.objects))
    (root/'blender-report.json').write_text(json.dumps(result,ensure_ascii=False,indent=2))
    return result
