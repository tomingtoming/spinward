"""Native street meshes and close frontage lots for the saved urban sketches."""
import math
from mathutils import Vector
from mathutils.bvhtree import BVHTree
from plan_izma_urban import rectangle, overlaps, corridor, project, ReservationIndex, SPACING
from izma_frontage_blocks import catchment_intervals, available_depth, dimensions

class UrbanFabric:
    def __init__(self,layout,specs,config,old,public,rail):
        self.layout=layout;self.specs=specs;self.config=config;self.old=old;self.public=public;self.rail=rail
        self.bvh=None;self.meshes=[];self.profiles=[];self.neighbourhoods=[];self.rejected_streets=[]

    def height(self,x,y):
        if self.bvh is None:return -10000
        a=x/3200;p=self.bvh.ray_cast(Vector((0,y,0)),Vector((math.cos(a),0,math.sin(a))))[0]
        return -10000 if p is None else 3200-math.hypot(p.x,p.z)

    def streets(self,env):
        all_triangles=[]
        for street in self.layout['streets']:
            if any(parent not in env['profiles'] for parent in street.get('parents',[])):
                self.rejected_streets.append({'id':street['id'],'district':street['district'],'reason':'parent-unavailable'})
                continue
            points=street['points'];rows=[];width=street['width']
            for a,b in zip(points,points[1:]):
                # Two-metre rows follow terrain triangle ridges without a
                # grass crest poking through the middle of a longer chord.
                steps=math.ceil(math.dist(a,b)/2)
                for i in range(steps):rows.append([a[j]+(b[j]-a[j])*i/steps for j in range(2)])
            rows.append(points[-1][:]);edges=[]
            for i,p in enumerate(rows):
                a=rows[max(0,i-1)];b=rows[min(len(rows)-1,i+1)]
                dx,dy=b[0]-a[0],b[1]-a[1];length=math.hypot(dx,dy)
                edge=[(p[0]-dy/length*side*width/2,p[1]+dx/length*side*width/2) for side in [-1,1]]
                p.append(max(env['ground'](*q)+.06 for q in [p[:2],*edge]))
                p[2]=max(p[2],*(env['street_height'](*q)+.018 for q in [p[:2],*edge]));edges.append(edge)
            # A curb or a terrain triangle ridge can lie between two rows.
            # Raise the complete strip above that support, then propagate the
            # permitted longitudinal grade. Vertex-only sampling misses it.
            for i in range(len(rows)-1):
                lift=0
                for t in [.25,.5,.75]:
                    left=[edges[i][0][k]*(1-t)+edges[i+1][0][k]*t for k in range(2)]
                    right=[edges[i][1][k]*(1-t)+edges[i+1][1][k]*t for k in range(2)]
                    for u in [0,.5,1]:
                        q=[left[k]*(1-u)+right[k]*u for k in range(2)]
                        support=max(env['ground'](*q)+.06,env['street_height'](*q)+.018)
                        lift=max(lift,support-(rows[i][2]*(1-t)+rows[i+1][2]*t))
                rows[i][2]+=lift;rows[i+1][2]+=lift
            for order in [range(1,len(rows)),range(len(rows)-2,-1,-1)]:
                for i in order:
                    j=i-1 if order.step==1 else i+1
                    rows[i][2]=max(rows[i][2],rows[j][2]-.075*math.dist(rows[i][:2],rows[j][:2]))
            # The graded lane can stand above the cross street. Join it with
            # a three-metre apron inside that street, rather than leave a lip
            # at its centreline. The outside apron corners inherit the actual
            # crossfall instead of flattening the existing road.
            apron_heights={}
            for at_start in [True,False] if len(street['connections'])>1 else [True]:
                i,j=(0,1) if at_start else (-1,-2)
                p,q=rows[i],rows[j];length=math.dist(p[:2],q[:2])
                apron=.65 if street.get('parents') and street['connections'][0 if at_start else -1] in street['parents'] else 3
                if 'aprons' in street:apron=street['aprons'][0 if at_start else -1]
                dx,dy=(p[0]-q[0])/length*apron,(p[1]-q[1])/length*apron
                edge=[(x+dx,y+dy) for x,y in edges[i]]
                heights=[env['street_height'](*v)+.018 for v in edge]
                assert min(heights)>-1000,('Apron must remain on the existing street',street['id'],
                    {'atStart':at_start,'parent':street['connections'][0 if at_start else -1],
                     'width':width,'apron':apron,'edge':edge,'heights':heights})
                row=[p[0]+dx,p[1]+dy,env['street_height'](p[0]+dx,p[1]+dy)+.018]
                if at_start:rows.insert(0,row);edges.insert(0,edge);apron_heights[0]=heights
                else:rows.append(row);edges.append(edge);apron_heights[len(rows)-1]=heights
            maximum_grade=max(abs(a[2]-b[2])/math.dist(a[:2],b[:2]) for a,b in zip(rows,rows[1:]))
            if maximum_grade>.075001:
                # This sketch requires a terrain cut or a different alignment.
                # Do not publish an abrupt ramp or let parcels front a road
                # that the saved ground cannot support at the specified grade.
                self.rejected_streets.append({'id':street['id'],'district':street['district'],
                    'reason':'junction-grade','maximumGrade':maximum_grade,
                    'steepestRows':max(zip(rows,rows[1:]),key=lambda pair:abs(pair[0][2]-pair[1][2])/math.dist(pair[0][:2],pair[1][:2]))})
                continue
            faces=[]
            for i in range(len(rows)-1):
                top=[(*edges[j][side],apron_heights[j][side] if j in apron_heights else rows[j][2]) for j,side in [(i,0),(i,1),(i+1,1),(i+1,0)]]
                faces.append((top,'lane',True,i//24))
                for a,b in [(top[0],top[3]),(top[2],top[1])]:
                    faces.append(([a,b,(b[0],b[1],env['ground'](*b[:2])-.04),(a[0],a[1],env['ground'](*a[:2])-.04)],'foundation',False,i//24))
                for tri in [(top[0],top[1],top[2]),(top[0],top[2],top[3])]:
                    all_triangles.extend((math.cos(x/3200)*(3200-h),y,math.sin(x/3200)*(3200-h)) for x,y,h in tri)
            self.meshes.append((street,faces));self.profiles.append({**street,'profile':rows})
            route={k:street[k] for k in ['id','kind','width','band','district','role','purpose','frontageFamilies'] if k in street};shift=street['band']*SPACING
            for a,b in zip(points,points[1:]):
                edge=([a[0]-shift,a[1]],[b[0]-shift,b[1]],route)
                env['segments'][street['band']].append(edge);env['all_segments'][street['band']].append(edge)
            env['profiles'][street['id']]={'points':[[p[0]-shift,p[1],p[2]] for p in rows]}
            # Child lanes join the already modelled parent surface, including
            # its actual grade. Keep that native surface available while building.
            self.bvh=BVHTree.FromPolygons(all_triangles,[tuple(range(i,i+3)) for i in range(0,len(all_triangles),3)],all_triangles=True)

    def plan(self,env):
        self.streets(env)
        master=env['MASTER'];seed=env['seed'];reserved=[ReservationIndex() for _ in range(3)]
        for p in self.old['parcels']:
            reserved[p['band']].append(rectangle(*p['position'],p['yaw'],p['size'][0]+3,p['size'][1]+3))
            reserved[p['band']].append(corridor(p['access']['start'],p['access']['end'],3))
        for p in self.public['places']:
            reserved[p['band']].append(rectangle(*p['position'],p['yaw'],p['size'][0]+3,p['size'][1]+3))
            reserved[p['band']].append(corridor(p['entry'],p['threshold'],5))
        for station in self.rail['stations']:
            for a,b in zip(station['approach'],station['approach'][1:]):reserved[station['band']].append(corridor(a,b,4.5))
        reserved[0].append(rectangle(0,0,0,700,860))
        routes=[[] for _ in range(3)];road_index=[ReservationIndex() for _ in range(3)];carriageways=[ReservationIndex() for _ in range(3)]
        for band in range(3):
            for a,b,r in env['all_segments'][band]:
                aa=[a[0]+band*SPACING,a[1]];bb=[b[0]+band*SPACING,b[1]]
                routes[band].append((aa,bb,r,corridor(aa,bb,r['width']+1)))
                road_index[band].append(routes[band][-1][3],r['id'])
                carriageways[band].append(corridor(aa,bb,r['width']-.06))
        blocks=[]
        for district in master['districts']:
            id=district['id'];band=district['band'];spec=self.specs['districts'][id];previous=self.config['districts'][id]
            region=next(d for d in self.layout['districts'] if d['id']==id)
            public=next(p for p in self.public['places'] if p['id']==id);anchor=public['entry']
            a,b=region['station'],region['centre'];dx,dy=b[0]-a[0],b[1]-a[1];length=math.hypot(dx,dy);dx/=length;dy/=length
            water=master['water'][band];wet=ReservationIndex()
            for aa,bb in zip(water['reach'],water['reach'][1:]):wet.append(corridor([aa[0]+band*SPACING,aa[1]],[bb[0]+band*SPACING,bb[1]],water['bankWidth']*2+4))
            candidates=[];rejected={};accepted=[]
            def reject(why):rejected[why]=rejected.get(why,0)+1
            for p,q,r,_ in routes[band]:
                if r['kind'] not in ['arterial','local'] or r['id'] not in env['profiles']:continue
                n=math.ceil(math.dist(p,q)/4);yaw=math.atan2(q[1]-p[1],q[0]-p[0])
                for k in range(1,n):
                    x=p[0]+(q[0]-p[0])*k/n;y=p[1]+(q[1]-p[1])*k/n
                    u=(x-a[0])*dx+(y-a[1])*dy;v=abs(-(x-a[0])*dy+(y-a[1])*dx)
                    in_station=30<u<region['reach']+45 and v<region['halfWidth']
                    distance=math.hypot(x-anchor[0],y-anchor[1]);in_public=distance<previous['radius']
                    if not in_station and not in_public:continue
                    for side in [-1,1]:candidates.append((min(math.hypot(x-a[0],y-a[1]),distance),x,y,yaw+(math.pi if side<0 else 0),r,in_station,distance))
            def add_plot(candidate,family,compact=False,allocation=None):
                _,rx,ry,yaw,route,in_station,distance=candidate
                n=seed(f'urban:{id}:{round(rx)}:{round(ry)}:{family}')
                dims=self.config['families'][family];widths=[6.5,8,11] if family=='shop-house' else dims['width']
                if spec['character']=='lanes' and family=='house':widths=[6.8,8.4,10.2]
                if id in ['b-housing','b-north','b-campus'] and family=='apartment':widths=[22,34,46]
                if compact:widths=[6.5,8] if family=='shop-house' else [6.8,8.4]
                w=widths[n%len(widths)];d=12 if family=='shop-house' else dims['depth'];floors=dims['floors'][n%len(dims['floors'])]
                if allocation:w,d=allocation['width'],allocation['depth']
                if id in ['b-housing','b-north'] and family=='apartment':floors=[4,5,7][(n//3)%3]
                if route.get('role')=='district-link':
                    storeys={'shop-house':[3,4],'apartment':[4,5,6],'office':[5,7]}.get(family,[floors])
                    floors=storeys[(n//3)%len(storeys)]
                c,s=math.cos(yaw),math.sin(yaw)
                setback=(min(spec['setback'],2) if compact else spec['setback'])+((n//13)%3)*.25
                if allocation:setback=allocation['setback']
                offset=route['width']/2+(2.15 if route['width']>=10 else 0)+setback+d/2
                x,y=rx-s*offset,ry+c*offset
                # Later small infill has a shallow private yard and a close
                # street frontage, unlike the original apartment/workshop lots.
                rear=min(spec['rear'],3) if compact else spec['rear']
                if allocation:rear=allocation['rear']
                lot_w=w+(allocation['gap'] if allocation else min(spec['sideGap'],1.2) if compact else spec['sideGap']);lot_d=d+setback+rear
                centre=(x-s*(rear-setback)/2,y+c*(rear-setback)/2);lot=rectangle(*centre,yaw,lot_w,lot_d)
                if any(abs(q[0]-band*SPACING)>3200*math.pi/6-master['edgeReserve'] or not district['axial'][0]<q[1]<district['axial'][1] for q in lot):reject('boundary');return False
                if reserved[band].intersects(lot,.15):reject('reserved');return False
                if wet.intersects(lot):reject('water');return False
                if road_index[band].intersects(lot,.2,route['id']):reject('route');return False
                # Sharing a route ID does not permit a lot across the next
                # segment of a curved street. Its front may meet the pavement
                # boundary, while the whole lot must remain outside its road.
                if carriageways[band].intersects(lot):reject('carriageway');return False
                placement=env['site'](band,x-band*SPACING,y,yaw,w,d,family)
                if not placement or placement['route']['id']!=route['id']:reject('frontage');return False
                if max(placement['samples'])-min(placement['samples'])>1.7:reject('foundation');return False
                if placement['stairs'] and family in ['warehouse','workshop']:reject('loading-grade');return False
                pid=f'neighbourhood-{id}-{len(accepted):03d}'
                lot_data={'polygon':[list(q) for q in lot],'width':lot_w,'depth':lot_d,'setback':setback,'rearGarden':rear,
                    'publicPlace':id,'distance':distance,'street':route['id'],'catchment':'station' if in_station else 'public',
                    'frontageUse':'shop' if family=='shop-house' else 'yard' if family in ['warehouse','workshop'] else 'garden' if family in ['house','farmhouse','apartment'] else 'forecourt',
                    'placement':'frontage-gap' if compact else 'principal'}
                if allocation:
                    lot_data.update({'placement':'block-frontage','frontageSegment':allocation['segment'],
                        'frontageRange':allocation['range'],'sharedBlockDepth':allocation['sharedDepth']})
                if route.get('role')=='district-link':
                    lot_data.update({'catchment':'district-link','purpose':route['purpose']})
                blocks.append({'id':pid,'band':band,'district':id,'family':family,'position':[x-band*SPACING,y,0],
                    'size':[w,d,floors*3.2],'yaw':yaw,'fixedSize':True,'lot':lot_data})
                reserved[band].append(lot);accepted.append(blocks[-1])
                return True
            ordered=sorted(candidates,key=lambda p:p[0])
            if spec['character']=='groves':
                for candidate in ordered:
                    if len(accepted)>=previous['target']*2+12:break
                    add_plot(candidate,spec['families'][len(accepted)%len(spec['families'])])
            else:
                # Allocate consecutive addresses along whole block edges. The
                # old radial candidate order left unusable slivers between
                # randomly sized plots and ignored the depth of the block.
                runs=[]
                for segment,(p,q,route,_) in enumerate(routes[band]):
                    if route['kind'] not in ['arterial','local'] or route['id'] not in env['profiles']:continue
                    if route.get('role')=='district-link' and route['district']!=id:continue
                    length2=math.dist(p,q)
                    intervals=[(0,1)] if route.get('role')=='district-link' else catchment_intervals(p,q,a,(dx,dy),region['reach'],region['halfWidth'],anchor,previous['radius'])
                    for lo,hi in intervals:
                        runs.append((length2*(hi-lo),segment,p,q,route,max(2,lo*length2),min(length2-2,hi*length2)))
                for _,segment,p,q,route,lo,hi in sorted(runs,reverse=True):
                    length2=math.dist(p,q);tx,ty=(q[0]-p[0])/length2,(q[1]-p[1])/length2
                    for side in [-1,1]:
                        cursor=lo;address=0;yaw=math.atan2(ty,tx)+(math.pi if side<0 else 0)
                        while cursor+6.8<hi:
                            token=seed(f'block:{id}:{route["id"]}:{segment}:{side}:{address}')
                            uses=route.get('frontageFamilies',spec['families'])
                            desired=uses[token%len(uses)]
                            families=list(dict.fromkeys([desired,*[f for f in uses if f in ['house','shop-house']]]))
                            fitted=False
                            for family in families:
                                widths,depths=dimensions(family,spec['character'],token,self.config)
                                setback=min(spec['setback'],2.2);rear=min(spec['rear'],2.5 if spec['character']=='lanes' else 4)
                                gap=max(1.2,min(spec['sideGap'],2))
                                for w in dict.fromkeys(widths):
                                    span=w+gap
                                    if cursor+span>hi:continue
                                    at=cursor+span/2;rx,ry=p[0]+tx*at,p[1]+ty*at
                                    depth=available_depth((rx,ry),(-ty*side,tx*side),route,routes[band],setback,rear,max(depths))
                                    if route['width']>=10:depth-=2.15
                                    choices=list(dict.fromkeys([math.floor(min(depth,max(depths))*2)/2,*[v for v in depths if v<=depth]]))
                                    u=(rx-a[0])*dx+(ry-a[1])*dy;v=abs(-(rx-a[0])*dy+(ry-a[1])*dx)
                                    in_station=30<u<region['reach']+45 and v<region['halfWidth']
                                    distance=math.hypot(rx-anchor[0],ry-anchor[1])
                                    candidate=(0,rx,ry,yaw,route,in_station,distance)
                                    for d in choices:
                                        if d<min(depths):continue
                                        allocation={'width':w,'depth':d,'setback':setback,'rear':rear,'gap':gap,
                                            'segment':segment,'range':[cursor,cursor+span],'sharedDepth':depth}
                                        if add_plot(candidate,family,allocation=allocation):
                                            cursor+=span+.16;fitted=True;break
                                    if fitted:break
                                if fitted:break
                            if not fitted:cursor+=1.5
                            address+=1
            # A large apartment/workshop can fail on a narrow leftover frontage.
            # Keep those principal buildings, then fit small homes and shops in
            # the remaining urban plots instead of leaving the frontage vacant.
            if spec['character']!='groves':
                small=[family for family in dict.fromkeys(spec['families']) if family in ['house','shop-house']]
                for candidate in ordered:
                    for family in small:
                        if add_plot(candidate,family,compact=True):break
            self.neighbourhoods.append({'id':id,'name':district['name'],'era':district['era'],'anchor':anchor,
                'radius':previous['radius'],'parcels':[p['id'] for p in accepted],
                'lotArea':sum(p['lot']['width']*p['lot']['depth'] for p in accepted),
                'footprintArea':sum(p['size'][0]*p['size'][1] for p in accepted),'rejected':rejected,
                'streets':[s['id'] for s in self.profiles if s['district']==id],'stationReach':region['reach']})
        return blocks

    def save_streets(self,built):
        for street,faces in self.meshes:
            by_chunk={}
            for points,mat,ground,chunk in faces:
                builder=by_chunk.setdefault(chunk,built['Builder']());builder.face(points,mat,ground)
            for chunk,builder in by_chunk.items():
                id=street['id']+'-'+str(chunk)
                obj=builder.finish(id,{'id':id,'position':[0,0],'floor':0,'yaw':0,'district':street['district'],'family':'street'},-1)
                del obj['parcel_id'];obj['urban_street_id']=id;obj['band']=street['band']
