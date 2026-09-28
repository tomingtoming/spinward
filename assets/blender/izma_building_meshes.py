"""Rebuild a saved parcel's visible near/middle meshes without changing its site."""
import json
from izma_building_forms import building_form
from izma_facades import facade
from izma_building_identity import building_identity, entrance

def render_building(Builder, parcel, n, config):
    family=parcel['family'];w,d,height=parcel['size'];floors=parcel['floors']
    floor_h=3.4 if family=='office' else (5.2 if family=='warehouse' else 3.2)
    floor=parcel['floor'];bottom=parcel['foundationBottom'];wall=parcel['wall'];roof=parcel['roof']
    parcel_id=parcel['id']
    identity=building_identity(parcel) if config.get('buildingIdentity') else None
    _,expected,roofs=building_form(family,w,d,floors,floor_h,n,config.get('variedMassing',False))
    volumes=parcel.get('volumes',expected)
    assert [list(v)for v in expected]==[list(v)for v in volumes],('Saved building form changed',parcel_id)
    main=volumes[0];du=main[0];dv=main[1]-main[4]/2
    if family=='warehouse':du=-w/2+1.5
    for lod in [0,1]:
        b=Builder();b.box(0,0,bottom-floor,w+.5,d+.5,floor-bottom,'foundation',cap=False)
        # Only exposed aprons/courts are walking surfaces. Hidden foundation
        # caps under closed rooms would waste collision triangles.
        cuts_x=sorted(set([-w/2-.25,w/2+.25]+[u+side*pw/2 for u,v,z,pw,pd,ph in volumes if z==0 for side in [-1,1]]))
        cuts_y=sorted(set([-d/2-.25,d/2+.25]+[v+side*pd/2 for u,v,z,pw,pd,ph in volumes if z==0 for side in [-1,1]]))
        for x0,x1 in zip(cuts_x,cuts_x[1:]):
            for y0,y1 in zip(cuts_y,cuts_y[1:]):
                if any(z==0 and abs((x0+x1)/2-u)<pw/2 and abs((y0+y1)/2-v)<pd/2 for u,v,z,pw,pd,ph in volumes):continue
                b.quad((x0,y0,0),(x1,y0,0),(x1,y1,0),(x0,y1,0),'foundation',True)
        for volume_index,(u,v,z,pw,pd,ph) in enumerate(volumes):
            # The visible roof slab/gable supplies the walking surface. The
            # hidden wall-volume top must not add a second subdivided roof.
            if family=='warehouse':b.box(u,v,z,pw,pd,ph,wall)
            else:facade(b,u,v,z,pw,pd,round(ph/floor_h),family,n+round(z)*17,lod,wall,family=='apartment' and volume_index==0,parcel['groundShop'] and z==0,identity)
        for u,v,z,pw,pd,ph,shape in roofs:
            if shape=='gable':b.gable(u,v,z,pw,pd,ph,roof)
            else:b.box(u,v,z,pw,pd,ph,roof,True)
        # Human-scale doorway, porch canopy and visible support posts.
        public=family in ['office','civic'];dw=2.8 if public else (1.9 if family=='apartment' else 1.1)
        if identity:
            entrance(b,parcel,identity,du,dv,dw,lod,config.get('signWriter'))
        else:
            door_material='wood' if family in ['house','farmhouse'] else 'metal'
            b.box(du,dv-.055,0,dw,.1,2.4,door_material)
            b.box(du,dv-.118,.35,dw-.22,.025,1.86,'glass')
            if public:b.box(du,dv-.14,.15,.065,.035,2.2,'metal')
            canopy=4.2 if public else dw+1.0
            b.box(du,dv-.85,2.75,canopy,1.8,.16,'roof-slate' if public else roof)
            for u in [-1,1]:b.box(du+u*(canopy/2-.13),dv-1.6,0,.09,.09,2.75,'metal')
            if family in ['shop-house','workshop','pavilion'] or parcel['groundShop']:
                b.box(0,dv-.25,2.75,w*.86,.35,.48,wall)
                b.box(0,dv-.8,config.get('shopAwningBottom',2.55),w*.88,1.6,.12,roof)
        if family=='warehouse':
            count=max(1,int((w-4)/7))
            for k in range(count):
                u=-w/2+4+(k+.5)*(w-4)/count
                b.box(u,-d/2-.035,.1,4.0,.04,3.8,'metal')
                if lod==0:
                    for row in range(9):b.box(u,-d/2-.063,.35+row*.4,4,.02,.035,'foundation')
        if lod==0:
            if not identity:b.box(du+.46,dv-.15,.95,.035,.035,.27,'metal')
            if family in ['office','apartment','civic']:
                top=volumes[-1];b.box(top[0],top[1],top[2]+top[5]+.24,min(2.5,top[3]*.2),2.4,1.1,'metal')
        obj=b.finish(parcel_id+f'_lod{lod}',parcel,lod)
        if identity and obj is not None:
            obj['building_identity']=json.dumps(identity,sort_keys=True)
            obj['facade_revision']='civilian-premises-v1'
