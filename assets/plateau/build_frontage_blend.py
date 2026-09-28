"""Execute in an isolated Blender MCP CLI process; save an editable bounded block.

Real source bodies are retained exactly. Added openings are exterior representations,
not cut-through interiors. All design additions are labelled as Spinward adaptations.
"""
import bpy,json,math,hashlib
from pathlib import Path
import numpy as np

PALETTE={'plaster-sand':'#cfc6b4','plaster-grey':'#b3b8b5','brick-muted':'#ab9181',
         'plaster-ivory':'#e1d9c9','cladding-grey':'#8c9c9c',
         'frame':'#555b5a','sill':'#b9b9af','glass-blue':'#526971',
         'glass-neutral':'#71817f','curtain-cream':'#a99f87','curtain-grey':'#8d9391',
         'shop-glass':'#485f65','shop-band':'#69786c','door':'#666255','roof':'#8a8b85'}

def build(root,target):
    root=Path(root);folder=root/'derived/tokyo';plan=json.loads((root/'frontage-plan.json').read_text())
    study=json.loads((root/'derived/study.json').read_text());sample=study['samples'][0]
    m=next(m for m in sample['meshes'] if m['name']=='buildings')
    p=np.fromfile(folder/m['positions'],dtype='<f4').reshape(-1,3);idx=np.fromfile(folder/m['indices'],dtype='<u4')
    fs={f['id']:f for f in json.loads((folder/'features.json').read_text())}
    bpy.ops.wm.read_factory_settings(use_empty=True);scene=bpy.context.scene;scene.name='Higashikoenji_authored_frontage'
    scene.unit_settings.system='METRIC';scene['scope']='Source footprint/height preserved; designed civilian exteriors; interiors not modelled'
    mats={};combined={};audit=[]
    for name,colour in PALETTE.items():
        mat=bpy.data.materials.new(name);rgb=[int(colour[k:k+2],16)/255 for k in (1,3,5)]
        rgb=[c/12.92 if c<=.04045 else ((c+.055)/1.055)**2.4 for c in rgb]
        mat.diffuse_color=(*rgb,1);mat.use_nodes=True
        bsdf=mat.node_tree.nodes.get('Principled BSDF');bsdf.inputs['Base Color'].default_value=(*rgb,1)
        bsdf.inputs['Roughness'].default_value=.32 if 'glass' in name else .86;mats[name]=mat
    for row in plan['buildings']:
        seed=row['seed'];usage=row['usage'];id_=row['id'];collection=bpy.data.collections.new(id_);scene.collection.children.link(collection)
        collection['source_gml_id']=id_;collection['source_usage']=usage
        collection['adaptation']='Window rhythm/materials/storefront are Spinward design, not real facade survey'
        buckets={};windows=0;doors=0
        def add(name,points,faces):
            pp,ff=buckets.setdefault(name,([],[]));start=len(pp);pp.extend(points);ff.extend([[start+int(i) for i in face] for face in faces])
        f=fs[id_]
        # If one GML feature has several disconnected parts, export its source body only once.
        if not any(a['id']==id_ for a in audit):
            selected=idx[f['firstIndex']:f['firstIndex']+f['indexCount']];ids,local=np.unique(selected,return_inverse=True)
            body=['plaster-sand','plaster-grey','brick-muted','plaster-ivory','cladding-grey'][seed%5]
            add(body,p[ids].tolist(),local.reshape(-1,3).tolist())
        office=usage in ['業務施設','官公庁施設','文教厚生施設']
        dwelling=('住宅' in usage)
        shop=('店舗' in usage or usage=='商業施設')
        # Only a subset of tall apartment buildings receive designed ground-floor retail.
        mixed=usage=='共同住宅' and max(w['top']-w['base'] for w in row['walls'])>18 and seed%3==0
        door_wall=min(range(len(row['walls'])),key=lambda i:row['walls'][i]['roadDistance']-min(row['walls'][i]['length'],12)*.04)
        for wi,w in enumerate(row['walls']):
            a=np.array(w['a']);u=(np.array(w['b'])-a)/w['length'];n=np.array(w['normal']);length=w['length']
            def box(name,cx,z,width,height,depth=.065,offset=.035):
                points=[]
                for d in [offset,offset+depth]:
                    for xx,zz in [(-width/2,-height/2),(width/2,-height/2),(width/2,height/2),(-width/2,height/2)]:
                        xy=a+u*(cx+xx)+n*d;points.append([float(xy[0]),float(xy[1]),float(z+zz)])
                add(name,points,[[0,3,2],[0,2,1],[4,5,6],[4,6,7],[0,1,5],[0,5,4],[1,2,6],[1,6,5],[2,3,7],[2,7,6],[3,0,4],[3,4,7]])
            def window(cx,bottom,width,height,material):
                nonlocal windows
                z=bottom+height/2
                box(material,cx,z,width,height,.015,.042)
                for xx in [cx-width/2,cx+width/2,cx]:box('frame',xx,z,.045,height+.07,.045,.052)
                for zz in [bottom,bottom+height]:box('frame',cx,zz,width+.065,.05,.045,.052)
                box('sill',cx,bottom-.045,width+.16,.085,.12,.025);windows+=1
            height=w['top']-w['base'];floor_count=max(1,round(height/(3.5 if office else 3.0)))
            floor_h=(height-.30)/floor_count;bay=(2.1+seed%3*.23) if office else (2.9+seed%3*.35)
            bays=max(1,math.floor((length-.8)/bay));spacing=(length-.8)/bays
            for floor in range(floor_count):
                z=w['base']+floor*floor_h
                if floor==0 and (shop or mixed):
                    for j in range(bays):
                        cx=.4+spacing*(j+.5);bottom=max(z+.18,max(w['ground'])+.22)
                        wh=min(2.25,z+floor_h-.55-bottom)
                        if wh>.8:window(cx,bottom,min(spacing-.3,2.7),wh,'shop-glass')
                    box('shop-band',length/2,z+floor_h-.28,max(.5,length-.2),.35,.09,.03)
                    continue
                for j in range(bays):
                    cx=.4+spacing*(j+.5)
                    # Keep the ground-floor entrance bay clear.
                    if floor==0 and wi==door_wall and j==bays//2:continue
                    bottom=z+( .55 if office else .95)
                    wh=min(floor_h-(.95 if office else 1.55),2.25 if office else 1.3)
                    if bottom<max(w['ground'])+.2 or wh<.6:continue
                    room=int(hashlib.sha256(f'{id_}:{wi}:{floor}:{j}'.encode()).hexdigest()[:8],16)
                    material='glass-blue' if office else ['glass-blue','glass-blue','glass-neutral','curtain-cream','curtain-grey'][room%5]
                    window(cx,bottom,min(spacing-.65,1.85 if office else 1.4),wh,material)
            # The shallow trim stays inside the collision skin; no uncollidable balcony slabs.
            box('sill',length/2,w['top']-.15,length,.18,.10,.025)
            if wi==door_wall and length>2.4 and max(w['ground'])-min(w['ground'])<.65:
                cx=.4+spacing*(bays//2+.5);bottom=w['ground'][1]+.20
                if bottom+2.3<w['top']:
                    box('frame',cx,bottom+1.12,1.17,2.24,.018,.048)
                    box('door',cx,bottom+1.08,1.01,2.12,.025,.07)
                    box('sill',cx+.37,bottom+1.04,.045,.30,.045,.102);doors+=1
        for name,(pp,ff) in buckets.items():
            mesh=bpy.data.meshes.new(id_+'_'+name);mesh.from_pydata(pp,[],ff);mesh.update()
            obj=bpy.data.objects.new(mesh.name,mesh);collection.objects.link(obj);mesh.materials.append(mats[name])
            obj['source_gml_id']=id_;obj['design_layer']='body' if name.startswith(('plaster','brick','cladding')) else 'authored_exterior'
            dst,faces=combined.setdefault(name,([],[]));offset=len(dst);dst.extend(pp);faces.extend([[i+offset for i in f] for f in ff])
        audit.append(dict(id=id_,usage=usage,windows=windows,doors=doors,groundRetail=shop or mixed,designedMixedUse=mixed))
    exported=[]
    for name,(pp,ff) in combined.items():
        pos=np.asarray(pp,dtype='<f4');indices=np.asarray(ff,dtype='<u4').ravel();key='frontage-'+name
        pos.tofile(folder/(key+'.positions.bin'));indices.tofile(folder/(key+'.indices.bin'))
        exported.append(dict(name=key,positions=key+'.positions.bin',indices=key+'.indices.bin',vertices=len(pos),triangles=len(indices)//3,
                             material=PALETTE[name],path='tokyo/',solid=True,roughness=.32 if 'glass' in name else .86,
                             sha256=hashlib.sha256(pos.tobytes()+indices.tobytes()).hexdigest()))
    result=dict(origin='ai',created='2026-09-22',source=plan['source'],design=plan['design'],buildingIds=plan['buildingIds'],buildings=audit,meshes=exported)
    (folder/'frontage.json').write_text(json.dumps(result,ensure_ascii=False,indent=2))
    sample['meshes']=[m for m in sample['meshes'] if not m['name'].startswith('frontage-')]+exported
    sample['frontage']='tokyo/frontage.json';(root/'derived/study.json').write_text(json.dumps(study,ensure_ascii=False,indent=2))
    note=bpy.data.texts.new('SOURCE_AND_DESIGN');note.write(json.dumps(plan,ensure_ascii=False,indent=2))
    bpy.ops.wm.save_as_mainfile(filepath=str(target),compress=True)
    return dict(path=str(target),buildings=len(plan['buildingIds']),windows=sum(a['windows'] for a in audit),doors=sum(a['doors'] for a in audit),triangles=sum(m['triangles'] for m in exported),objects=len(bpy.data.objects))
