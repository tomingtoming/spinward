"""Save three complete street-wall/court replacements in native metres.

This scene is a replacement design. Export integration must retire the listed
old parcels and re-author dependent land/entrances; it must not overlap them.
"""
import bpy,json,hashlib,math,sys
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2];ASSETS=ROOT/'assets/blender'
sys.path.insert(0,str(ASSETS))
from izma_mesh_builder import BuildingMeshBuilder
from izma_polygon_facade import wall
from izma_block_parcels import faces_close_neighbour
from izma_ground_patches import GroundPatches,area,clip
from izma_street_frontages import clean
from plan_izma_urban import project,rectangle,corridor
from colony_manifest_io import read_manifest

plan=json.loads((ASSETS/'izma-block-parcels.json').read_text())
for name,digest in plan['dependencies'].items():
    assert hashlib.sha256((ASSETS/name).read_bytes()).hexdigest()==digest,('Replan complete blocks',name)
source=json.loads((ASSETS/'izma-neighbourhood-parcels.json').read_text())
definitions=source['materials'];scene=bpy.data.scenes.new('SW_izma_blocks')
scene['owner']='spinward-izma-complete-blocks-v1';scene.unit_settings.system='METRIC';materials={}
scene['plan_hash']=hashlib.sha256((ASSETS/'izma-block-parcels.json').read_bytes()).hexdigest()
for name,definition in definitions.items():
    m=bpy.data.materials.new('SWB_'+name);m.diffuse_color=tuple(int(definition['color'][i:i+2],16)/255 for i in [1,3,5])+(1,)
    materials[name]=m
ground=GroundPatches(read_manifest(ROOT/'src/worlds/generated/izmaColony.json')['base'])
streets={s['id']:s for s in source['streets']}
counts={'buildings':0,'courtPieces':0,'nearTriangles':0,'midTriangles':0,'farTriangles':0}

for block in plan['blocks']:
    profiles=[streets[block[k]] for k in ['outerStreet','returnStreet']]
    for original in block['plots']:
        plot=dict(original);polygon=plot['outline'];centre=[sum(p[k] for p in polygon)/len(polygon) for k in range(2)]
        token=int.from_bytes(hashlib.sha256(plot['id'].encode()).digest()[:4],'big');plot['seed']=token
        front=plot['front'];a,b=front;dx,dy=b[0]-a[0],b[1]-a[1];length=math.hypot(dx,dy)
        distances=[abs(dx*(p[1]-a[1])-dy*(p[0]-a[0]))/length for p in polygon]
        neighbours=[p['outline'] for p in block['plots'] if p['id']!=plot['id']]
        plot['frontEdges']=[];plot['blankEdges']=[]
        for i in range(len(polygon)):
            edge_depth=(distances[i]+distances[(i+1)%len(polygon)])/2
            if edge_depth<1e-4:plot['frontEdges'].append(i)
            elif faces_close_neighbour(polygon[i],polygon[(i+1)%len(polygon)],neighbours):plot['blankEdges'].append(i)
        plot['outline']=[[p[k]-centre[k] for k in range(2)] for p in polygon]
        plot['balconyEdges']=plot['frontEdges'] if plot['family']=='apartment' else []
        plot['entrance']={**plot['entrance'],'end':[plot['entrance']['end'][0]-centre[0],plot['entrance']['end'][1]-centre[1],plot['floor']]}
        floor=plot['floor'];height=plot['height'];poly=plot['outline']
        mat=['wall-ivory','wall-grey','wall-ochre','wall-brick','wall-white','wall-sage'][(token//100)%6]
        roof=['roof-slate','roof-tile','roof-green'][(token//1000)%3]
        parcel={**plot,'position':centre,'yaw':0}
        for lod in range(3):
            builder=BuildingMeshBuilder(scene,materials)
            for edge,(a,b) in enumerate(zip(poly,poly[1:]+poly[:1])):
                wall(builder,a,b,plot,edge,lod,mat)
                builder.quad((*a,height),(*b,height),(*b,height+.2),(*a,height+.2),roof)
                builder.quad((*a,plot['foundationBottom']-floor),(*b,plot['foundationBottom']-floor),(*b,0),(*a,0),'foundation')
                length=math.dist(a,b);tx,ty=(b[0]-a[0])/length,(b[1]-a[1])/length;nx,ny=ty,-tx
                def point(u,out,z):return (a[0]+tx*u+nx*out,a[1]+ty*u+ny*out,z)
                if edge in plot['balconyEdges']:
                    for storey in range(1,plot['floors']):
                        z=storey*3.2;lo,hi=.24,length-.24;front=1.05
                        builder.quad(point(lo,0,z),point(hi,0,z),point(hi,front,z),point(lo,front,z),'foundation',lod==0)
                        builder.quad(point(lo,front,z-.15),point(hi,front,z-.15),point(hi,front,z),point(lo,front,z),'foundation',lod==0)
                        for aa,bb in [((lo,front),(hi,front)),((lo,0),(lo,front)),((hi,front),(hi,0))]:
                            builder.quad(point(*aa,z),point(*bb,z),point(*bb,z+.98),point(*aa,z+.98),mat,lod==0)
                elif edge in plot['frontEdges'] and plot['family'] in ['shop-house','workshop']:
                    lo,hi=.25,length-.25;z=2.85
                    builder.quad(point(lo,0,z),point(hi,0,z),point(hi,.75,z),point(lo,.75,z),roof,lod==0)
                    builder.quad(point(lo,.75,z-.12),point(hi,.75,z-.12),point(hi,.75,z),point(lo,.75,z),roof)
            mid=tuple(sum(p[k] for p in poly)/len(poly) for k in range(2))
            peak=1.1 if plot['family']=='house' else 0
            for a,b in zip(poly,poly[1:]+poly[:1]):builder.face([(*mid,height+.2+peak),(*a,height+.2),(*b,height+.2)],roof,lod==0)
            obj=builder.finish(plot['id']+f'_lod{lod}',parcel,lod);obj['block_id']=block['id'];obj.hide_render=lod!=0
            obj.data.calc_loop_triangles();counts[['nearTriangles','midTriangles','farTriangles'][lod]]+=len(obj.data.loop_triangles)
        builder=BuildingMeshBuilder(scene,materials)
        for a,b in zip(poly,poly[1:]+poly[:1]):
            builder.quad((*a,plot['foundationBottom']-floor),(*b,plot['foundationBottom']-floor),(*b,height+.2),(*a,height+.2),'foundation',True)
        obj=builder.finish(plot['id']+'_physics',parcel,-2);obj['block_id']=block['id'];obj.hide_render=True
        # A shallow approach remains a ramp. Making its entire length one
        # raised tread also puts a riser across the adjoining walking route.
        # Steeper thresholds keep bounded-height treads.
        entry=original['entrance'];a,b=entry['start'],entry['end'];length=math.dist(a[:2],b[:2]);tx,ty=(b[0]-a[0])/length,(b[1]-a[1])/length
        steps=max(1,math.ceil(abs(b[2]-a[2])/.16));builder=BuildingMeshBuilder(scene,materials)
        ramp=abs(b[2]-a[2])/length<=.08
        if ramp:steps=1
        previous=a[2]
        for i in range(steps):
            t0,t1=i/steps,(i+1)/steps;h=a[2]+(b[2]-a[2])*t1;ends=[]
            for t in [t0,t1]:
                elevation=a[2]+(b[2]-a[2])*t if ramp else h
                ends.append([(a[0]+(b[0]-a[0])*t-ty*side*.75-centre[0],a[1]+(b[1]-a[1])*t+tx*side*.75-centre[1],elevation-floor) for side in [-1,1]])
            builder.face([*ends[0],*reversed(ends[1])],'paving',True)
            if not ramp and abs(h-previous)>1e-5:
                p,q=ends[0];builder.face([(p[0],p[1],previous-floor),(q[0],q[1],previous-floor),q,p],'foundation',True)
            previous=h
        obj=builder.finish(plot['id']+'_entry',parcel,-1);obj['block_id']=block['id'];counts['buildings']+=1
    # Shared court and front verges form one planned open-space system. Their
    # ground follows native terrain and rises gently to the saved road levels.
    def floor_height(q,terrain):
        candidates=[]
        for s in profiles:
            for a,b in zip(s['profile'],s['profile'][1:]):
                x,y,t=project(*q,a,b);candidates.append((math.dist(q,(x,y)),a[2]+(b[2]-a[2])*t,s['width']))
        distance,h,width=min(candidates)
        return max(terrain+.045,h+.04-max(0,distance-width/2)*.07)
    builder=BuildingMeshBuilder(scene,materials);cx,cy=block['centre']
    walks=[clean(corridor(a,b,g['width'])) for g in block['gates'] for a,b in [(g['start'],g['end']),(g['end'],block['centre'])]]
    for piece in block['courtPieces']:
        if abs(area(piece))<.01:continue
        x0,y0=[min(p[k] for p in piece) for k in range(2)];x1,y1=[max(p[k] for p in piece) for k in range(2)]
        for i in range(math.floor(x0/6),math.ceil(x1/6)):
            for j in range(math.floor(y0/6),math.ceil(y1/6)):
                patch=clip(piece,clean(rectangle(i*6+3,j*6+3,0,6,6)))
                if not patch:continue
                centre=[sum(p[k] for p in patch)/len(patch) for k in range(2)]
                near_street=min(math.dist(centre,project(*centre,a,b)[:2])-w/2 for a,b,w in zip(block['boundary'],block['boundary'][1:]+block['boundary'][:1],block['roadWidths']))<4
                material='paving' if near_street else block['courtMaterial']
                if any(abs(area(clip(patch,walk)))>.01 for walk in walks):material='paving'
                for cell in ground.split(patch):
                    builder.face([(x-cx,y-cy,floor_height((x,y),h)) for x,y,h in cell],material,True);counts['courtPieces']+=1
    obj=builder.finish(block['id']+'_court',{'id':block['id'],'district':block['district'],'family':'court','position':[cx,cy],'floor':0,'yaw':0},-1)
    obj['block_id']=block['id']

scene.view_layers[0].update()
bpy.data.libraries.write(str(ASSETS/'izma-blocks.blend'),{scene},fake_user=True,compress=True)
evidence=ROOT/'qa/webxr/evidence/colony-block-replot-20260918'
evidence.mkdir(parents=True,exist_ok=True)
summary={**counts,'blocks':len(plan['blocks']),'blendBytes':(ASSETS/'izma-blocks.blend').stat().st_size,'status':'native design; runtime replacement pending'}
(evidence/'native.json').write_text(json.dumps(summary,indent=2)+'\n');print(json.dumps(summary),flush=True)
