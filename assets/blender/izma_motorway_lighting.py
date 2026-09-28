"""Supported IC luminaires, avoiding adjacent carriageways at merging height."""
import math
import bpy
from izma_mesh_builder import BuildingMeshBuilder
from plan_izma_motorway import stations, sample
from izma_motorway_replacement import FootprintCuts, split_footprint


def add_lighting(scene, plan, materials, append, road_quads, master, transport):
    records=[]
    highways={p['band']:p['points'] for p in transport['profiles'] if p['kind']=='expressway'}
    for ic in plan['interchanges']:
        original=highways[ic['band']];shift=ic['band']*plan['radius']*math.tau/3
        full=[[p[0]+shift,p[1],p[2]] for p in original];full_along=stations(full)
        assert abs(full_along[-1]-(full[-1][1]-full[0][1]))<1e-5, 'Mainline must be axial'
        neighbours=sorted((i for i in plan['interchanges'] if i['band']==ic['band']),key=lambda i:i['node'][1])
        index=next(i for i,other in enumerate(neighbours) if other['id']==ic['id'])
        start=full[0][1] if index==0 else (neighbours[index-1]['node'][1]+ic['node'][1])/2
        end=full[-1][1] if index==len(neighbours)-1 else (ic['node'][1]+neighbours[index+1]['node'][1])/2
        # Mainlines are axial and their stations measure the same y distance.
        highway=[sample(full,full_along,start-full[0][1]),
                 *[p for p in full if start<p[1]<end],sample(full,full_along,end-full[0][1])]
        roads=[{'id':ic['id']+'-mainline','kind':'expressway','width':24.,'footway':0.,
                'points':highway},*ic['roads']]
        entries=[]
        for road in roads:
            for i,polygon in enumerate(road_quads(road,extra=.55)):
                a,b=road['points'][i:i+2]
                entries.append(((road['id'],min(a[2],b[2]),max(a[2],b[2])),polygon))
        occupancy=FootprintCuts(entries)
        for road in roads:
            points=road['points'];along=stations(points);express=road['kind']=='expressway'
            spacing=20. if road['kind']!='ramp' else 24.
            first=math.ceil((points[0][1]-full[0][1]-8)/spacing) if express else 0
            for ordinal in range(math.ceil(along[-1]/spacing)+1):
                n=first+ordinal
                distance=full[0][1]+8+n*spacing-points[0][1] if express else 8+n*spacing
                if distance<0 or distance>=along[-1]:continue
                p=sample(points,along,distance)
                a=sample(points,along,max(0,distance-.25));b=sample(points,along,min(along[-1],distance+.25))
                dx,dy=b[0]-a[0],b[1]-a[1];norm=math.hypot(dx,dy);nx,ny=-dy/norm,dx/norm
                side=1 if n%2 else -1
                if road['kind']=='ramp':
                    # Use the edge away from the mainline until its lamps take over.
                    side=1 if nx*(p[0]-ic['node'][0])>0 else -1
                lateral=side*(road['width']/2+road['footway']-.22)
                x,y=p[0]+nx*lateral,p[1]+ny*lateral
                foot=p[2]+(.14 if road['footway'] else 0)
                footprint=[(x-.18,y-.18,foot),(x+.18,y-.18,foot),
                           (x+.18,y+.18,foot),(x-.18,y+.18,foot)]
                candidates={i for cell in occupancy.cells(footprint) for i in occupancy.grid.get(cell,[])}
                if any(key[0]!=road['id'] and key[1]-1<foot<key[2]+1 and split_footprint(footprint,polygon)[1]
                       for key,polygon in (entries[i] for i in candidates)):continue
                # Existing central transfer T junctions are outside the IC replacement.
                if express and any(node['band']==ic['band'] and '-jct-' in node['id'] and abs(y-node['xy'][1])<25
                                   for node in master['nodes']):continue
                reach=1.45 if express else .85
                hx,hy=x-nx*side*reach,y-ny*side*reach
                fixture=BuildingMeshBuilder(scene,materials)
                fixture.box(x,y,foot-.04,.28,.28,.2,'motorway-structure')
                fixture.box(x,y,foot+.14,.14,.14,6.25,'motorway-rail')
                # A solid arm connects the lamp housing to the pole; the emitting underside is small.
                corners=[(x+ny*.09,y-nx*.09,foot+6.3),(hx+ny*.09,hy-nx*.09,foot+6.3),
                         (hx-ny*.09,hy+nx*.09,foot+6.3),(x-ny*.09,y+nx*.09,foot+6.3)]
                top=[(px,py,z+.16) for px,py,z in corners]
                fixture.face(top,'motorway-rail')
                fixture.face(list(reversed(corners)),'motorway-rail')
                for i in range(4):fixture.face([corners[i],corners[(i+1)%4],top[(i+1)%4],top[i]],'motorway-rail')
                fixture.face([(hx-.31,hy+.23,foot+6.27),(hx+.31,hy+.23,foot+6.27),
                              (hx+.31,hy-.23,foot+6.27),(hx-.31,hy-.23,foot+6.27)],'motorway-lamp')
                fixture.box(hx,hy,foot+6.27,.72,.54,.22,'motorway-rail')
                for face,material in zip(fixture.f,fixture.m):
                    append(ic['id'],'supported-luminaires',material,[fixture.v[i] for i in face],
                           physical=material!='motorway-lamp')
                data=bpy.data.lights.new('SWMI_lamp_'+str(len(records)),'POINT')
                data.energy=360;data.color=(1.,.9,.73)
                obj=bpy.data.objects.new(data.name,data);scene.collection.objects.link(obj)
                obj.location=(hy,-hx,foot+6.24)
                for key,value in {'owner':scene['owner'],'motorway_id':ic['id'],'road_id':road['id'],
                                  'color':'#ffe5b9','intensity':360.,'distance':44.,
                                  'runtime_accepted':False,'fixture_foot':[x,y,foot],
                                  'fixture_height':6.49}.items():obj[key]=value
                records.append({'id':obj.name,'ic':ic['id'],'road':road['id'],'foot':[x,y,foot],
                                'position':[hx,hy,foot+6.24],'intensity':360.,'distance':44.})
    return records
