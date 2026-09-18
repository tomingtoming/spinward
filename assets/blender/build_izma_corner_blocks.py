"""Save oblique corner shops, their entrances and three matching native LODs."""
import bpy
import hashlib
import json
import math
import sys
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2];ASSETS=ROOT/'assets/blender'
sys.path.insert(0,str(ASSETS))
from izma_mesh_builder import BuildingMeshBuilder
from izma_facades import window_rows

plan=json.loads((ASSETS/'izma-corner-blocks-plan.json').read_text())
for name,digest in plan['dependencies'].items():
    assert hashlib.sha256((ASSETS/name).read_bytes()).hexdigest()==digest,('Replan corners',name)
definitions=json.loads((ASSETS/'izma-neighbourhood-parcels.json').read_text())['materials']
scene=bpy.data.scenes.new('SW_izma_corner_blocks');scene['owner']='spinward-izma-corner-blocks-v1'
scene.unit_settings.system='METRIC';materials={}
for name,definition in definitions.items():
    material=bpy.data.materials.new('SWC_'+name)
    material.diffuse_color=tuple(int(definition['color'][i:i+2],16)/255 for i in [1,3,5])+(1,)
    materials[name]=material


def wall(builder,a,b,plot,edge,lod,material):
    length=math.dist(a,b);tx,ty=(b[0]-a[0])/length,(b[1]-a[1])/length;nx,ny=ty,-tx
    def at(u,z,out=0):return (a[0]+tx*(u+length/2)+nx*out,a[1]+ty*(u+length/2)+ny*out,z)
    rows=window_rows(length,plot['floors'],'shop-house',plot['seed'],0 if edge in plot['frontEdges'] else 1)
    cuts=sorted({opening[k] for row in rows for opening in row for k in ['left','right']})
    def rect(left,right,low,high,mat,out=0):
        if right-left<1e-7 or high-low<1e-7:return
        points=[left,*[v for v in cuts if left<v<right],right] if lod==0 else [left,right]
        for p,q in zip(points,points[1:]):builder.quad(at(p,low,out),at(q,low,out),at(q,high,out),at(p,high,out),mat)
    if lod:
        rect(-length/2,length/2,0,plot['height'],material)
    if lod==2:return
    for i,openings in enumerate(rows):
        if lod==0:
            if not openings:rect(-length/2,length/2,i*3.2,(i+1)*3.2,material)
            else:
                low,high=openings[0]['bottom'],openings[0]['top']
                rect(-length/2,length/2,i*3.2,low,material);rect(-length/2,length/2,high,(i+1)*3.2,material)
                left=-length/2
                for opening in openings:
                    rect(left,opening['left'],low,high,material);left=opening['right']
                rect(left,length/2,low,high,material)
        for opening in openings:
            left,right,low,high=[opening[k] for k in ['left','right','bottom','top']]
            if lod==0:
                corners=[(left,low),(right,low),(right,high),(left,high)]
                for p,q in zip(corners,corners[1:]+corners[:1]):
                    builder.face([at(*p),at(*q),at(*q,-.16),at(*p,-.16)],'foundation')
            rect(left,right,low,high,'metal',.012 if lod else -.16)
            rect(left+.065,right-.065,low+.065,high-.065,opening['pane'],.022 if lod else -.148)
    door=plot['entrance']['end']
    middle=((a[0]+b[0])/2,(a[1]+b[1])/2)
    if math.dist(middle,door[:2])<.01:
        rect(-.68,.68,.04,2.48,'metal',.02)
        rect(-.58,.58,.12,2.38,'glass',.035)


for plot in plan['parcels']:
    polygon=plot['outline'];floor=plot['floor'];height=plot['height']
    wall_material=['wall-ivory','wall-grey','wall-ochre','wall-brick','wall-white','wall-sage'][(plot['seed']//100)%6]
    plot['wall']=wall_material
    parcel={'id':plot['id'],'district':plot['district'],'family':plot['family'],'position':[0,0],'floor':floor,'yaw':0}
    for lod in [0,1,2]:
        builder=BuildingMeshBuilder(scene,materials)
        for edge,(a,b) in enumerate(zip(polygon,polygon[1:]+polygon[:1])):
            wall(builder,a,b,plot,edge,lod,wall_material)
            builder.quad((*a,height),(*b,height),(*b,height+.18),(*a,height+.18),'roof-slate')
            builder.quad((*a,plot['foundationBottom']-floor),(*b,plot['foundationBottom']-floor),(*b,0),(*a,0),'foundation')
        # A convex fan uses the very same outline at all detail levels.
        centre=tuple(sum(p[k] for p in polygon)/len(polygon) for k in range(2))
        for a,b in zip(polygon,polygon[1:]+polygon[:1]):
            builder.face([(*centre,height+.18),(*a,height+.18),(*b,height+.18)],'roof-slate',lod==0)
        obj=builder.finish(plot['id']+f'_lod{lod}',parcel,lod);obj['corner_id']=plot['id']
        obj.hide_render=lod!=0
    # Collision walls use the same polygon, independently of facade recesses
    # and detail loading. Include only the outer shell, not a bounding box.
    physical=BuildingMeshBuilder(scene,materials)
    for a,b in zip(polygon,polygon[1:]+polygon[:1]):
        physical.quad((*a,plot['foundationBottom']-floor),(*b,plot['foundationBottom']-floor),
                      (*b,height+.18),(*a,height+.18),'foundation',True)
    obj=physical.finish(plot['id']+'_physics',parcel,-2);obj['corner_id']=plot['id'];obj.hide_render=True
    access=plot['entrance'];a,b=access['start'],access['end'];length=math.dist(a[:2],b[:2])
    dx,dy=(b[0]-a[0])/length,(b[1]-a[1])/length;half=access['width']/2
    points=[(p[0]-dy*side*half,p[1]+dx*side*half,p[2]-floor) for p,side in [(a,-1),(a,1),(b,1),(b,-1)]]
    builder=BuildingMeshBuilder(scene,materials);builder.face(points,'paving',True)
    obj=builder.finish(plot['id']+'_access',parcel,-1);obj['corner_id']=plot['id']

scene.view_layers[0].update()
bpy.data.libraries.write(str(ASSETS/'izma-corner-blocks.blend'),{scene},fake_user=True,compress=True)
contract={**plan,'materials':definitions,'planHash':hashlib.sha256((ASSETS/'izma-corner-blocks-plan.json').read_bytes()).hexdigest()}
(ASSETS/'izma-corner-blocks.json').write_text(json.dumps(contract,separators=(',',':'))+'\n')
print(json.dumps({'parcels':len(plan['parcels']),'objects':len(scene.objects),'blendBytes':(ASSETS/'izma-corner-blocks.blend').stat().st_size}),flush=True)
