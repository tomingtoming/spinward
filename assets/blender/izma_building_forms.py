"""Civilian building massing, with the saved street doorway kept in place.

Dimensions are Spinward design choices. The same volumes/roofs feed native
near/middle meshes, physical walls and distant silhouettes.
"""

def building_form(family,w,d,floors,floor_h,n,varied=False):
    height=floors*floor_h
    form=family;roof='gable' if family in ['house','farmhouse','shop-house','warehouse'] else 'flat'
    if family=='office':
        volumes=[(0,0,0,w,d,2*floor_h),(0,d*.06,2*floor_h,w*.78,d*.74,(floors-2)*floor_h)]
    elif family=='civic':
        volumes=[(w*.18,0,0,w*.64,d,height),(-w*.32,d*.24,0,w*.36,d*.52,max(1,floors-1)*floor_h)]
    elif family=='apartment':volumes=[(0,d*.08,0,w,d*.76,height)]
    else:volumes=[(0,0,0,w,d,height)]
    if varied:
        variant=(n//31)%3
        if family in ['house','farmhouse'] and variant:
            form='house-with-rear-wing'
            volumes=[(0,-d*.16,0,w,d*.68,height),
                     ((-1 if variant==1 else 1)*w*.17,d*.34,0,w*.66,d*.32,(floors-1)*floor_h)]
        elif family=='shop-house':
            if variant==0:
                form='shop-with-setback-home';roof='flat'
                volumes=[(0,0,0,w,d,floor_h),(0,d*.1,floor_h,w*.84,d*.8,(floors-1)*floor_h)]
            elif variant==1:form='flat-roof-shop-house';roof='flat'
            else:form='pitched-shop-house'
        elif family=='apartment':
            if variant==0 and w>=20:
                form='courtyard-apartment'
                volumes=[(0,-d*.11,0,w,d*.38,height),
                         (-w*.37,d*.29,0,w*.26,d*.42,(floors-1)*floor_h),
                         (w*.37,d*.29,0,w*.26,d*.42,(floors-1)*floor_h)]
            else:form='long-slab-apartment' if w>=30 else 'compact-apartment'
        elif family=='office' and variant==1:
            form='straight-office';volumes=[(0,0,0,w,d,height)]
        elif family=='office' and variant==2 and floors>=6:
            form='stepped-office'
            volumes=[(0,0,0,w,d,2*floor_h),(0,d*.04,2*floor_h,w*.84,d*.84,2*floor_h),
                     (0,d*.12,4*floor_h,w*.64,d*.62,(floors-4)*floor_h)]
        elif family=='workshop' and variant:
            form='sawtooth-workshop';roof='sawtooth'
    roofs=[]
    for u,v,z,pw,pd,ph in volumes:
        if roof=='gable':roofs.append((u,v,z+ph,pw+.65,pd+.65,min(3.1,pw*.19),'gable'))
        elif roof=='sawtooth':
            bays=max(2,round(pw/7));pitch=pw/bays
            for bay in range(bays):roofs.append((u-pw/2+pitch*(bay+.5),v,z+ph,pitch,pd+.3,1.5,'gable'))
        else:roofs.append((u,v,z+ph,pw+.25,pd+.25,.24,'box'))
    return form,volumes,roofs
