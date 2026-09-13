import { expect, test } from 'bun:test'
import { planCity, type CityPlan } from './cityLayout'
import { rebuildNativeDistricts, type DistrictTrafficStreet } from './nativeDistricts'
import { StreetMarkingPlan } from './streetMarkings'
import { StreetSignalPlan } from './streetSignals'
import { buildingFootprint, certifyStreetAccess } from './streetFrontage'
import { intersectStreetPolygons, polygonArea } from './streetPolygon'
import { DistrictTrafficPath } from './districtTraffic'
import { createTrafficSignalIndex,routeTrafficSignals,trafficSignalGap } from './intersectionSignals'
import { sampleStreetPath, streetRibbon } from './streetPath'
import { isDrivingStreetPoint, paintDistrictFootways } from '../app/streetRouteGrid'
import { containsStreetPolygon } from './streetPolygon'
import { planNeighborhoodRoute } from '../app/neighborhoodRoute'
const R=3200,wrap=(a:number)=>Math.atan2(Math.sin(a),Math.cos(a))
let middle:CityPlan
let middleTraffic:DistrictTrafficStreet[]
for(const maxBuildings of [16000,18000,64000])test(`connected districts preserve lots, budgets and actual frontage at ${maxBuildings}`,()=>{
 const p=planCity({radius:R,length:40000,maxBuildings}),before=p.buildings.length,old=p.buildings.filter(b=>b.axial<4000)
 const {districts,traffic}=rebuildNativeDistricts(p,R),network=p.streetNetwork!
 expect(districts).toHaveLength(3);expect(p.buildings.length).toBe(before)
 expect(p.buildings.filter(b=>b.axial<4000).map(b=>[b.azimuth,b.axial,b.width,b.depth,b.height])).toEqual(old.map(b=>[b.azimuth,b.axial,b.width,b.depth,b.height]))
 expect(new Set(network.components).size).toBe(3);expect(traffic).toHaveLength(18)
 const ids=new Set(network.streets.map(s=>s.id));expect(p.buildings.every(b=>b.access&&ids.has(b.access.roadId))).toBe(true)
 const m=new StreetMarkingPlan(network),s=new StreetSignalPlan(m,p.intersections);p.streetMarkings=m;p.streetSignals=s
 const junctions=m.junctions.filter(j=>j.arms.some(a=>network.streets[a.street].id.startsWith('district-')))
 expect(junctions).toHaveLength(63)
 for(const j of junctions){
  expect(m.junctionCrossings(j)).toHaveLength(j.arms.length)
  if(j.arms.some(a=>network.streets[a.street].kind==='arterial')){
   const n=network.nodes[j.node];expect(s.controlsJunction(n.azimuth,n.axial)).toBe(true)
  }
 }
 for(const d of districts){
  expect(d.buildings.length).toBe(d.replacedBuildings);expect(d.streets).toHaveLength(6)
  const own=certifyStreetAccess(d.buildings,network,R,6);expect(own.rejected).toEqual([])
  for(let i=0;i<d.buildings.length;i++)for(let j=0;j<i;j++){
   const a=d.buildings[i],b=d.buildings[j],dx=wrap(b.azimuth-a.azimuth)*R,dy=b.axial-a.axial
   if(Math.abs(dx)>80||Math.abs(dy)>80)continue
   expect(polygonArea(intersectStreetPolygons(buildingFootprint(a),buildingFootprint(b).map(v=>({...v,x:v.x+dx,y:v.y+dy}))))).toBeLessThan(1e-6)
  }
 }
 if(maxBuildings===18000){middle=p;middleTraffic=traffic}
},10000)
test('native lanes retain continuous positions, headings and signal stops through district edges',()=>{
 const p=planCity({radius:R,length:40000,maxBuildings:18000}),{traffic}=rebuildNativeDistricts(p,R)
 const signals=new StreetSignalPlan(new StreetMarkingPlan(p.streetNetwork!),p.intersections),index=createTrafficSignalIndex([],signals,p.roads)
 for(const t of traffic){
  const lane=new DistrictTrafficPath(t,R,signals),vertical=lane.vertical
  for(const direction of [-1,1] as const)for(const edge of [lane.stations[0],lane.stations.at(-1)!]){
   const a=lane.sample(edge-.001,direction*1.5,direction),b=lane.sample(edge+.001,direction*1.5,direction)
   expect(Math.hypot(wrap(a.azimuth-b.azimuth)*R,a.axial-b.axial)).toBeLessThan(.01)
   expect(Math.abs(wrap(a.heading-b.heading))).toBeLessThan(.001)
  }
  for(let i=1;i<100;i++){
   const station=lane.stations[0]+(lane.stations.at(-1)!-lane.stations[0])*i/100
   for(const direction of [-1,1] as const){
    const p0=lane.sample(station,direction*1.5,direction)
    expect(isDrivingStreetPoint(p.streetNetwork!,p0.azimuth,p0.axial)).toBe(true)
    expect(p0.stationRate).toBeGreaterThan(.7)
   }
  }
  const start=vertical?t.road.axial-t.road.axialLength/2:-t.road.tangentWidth/2,length=vertical?t.road.axialLength:t.road.tangentWidth
  const stops=routeTrafficSignals(index,t.road,R,start,length,t.sourceRoadIds)
  expect(stops.length).toBeGreaterThan(0)
  for(const stop of stops.filter(s=>s.along>lane.stations[0]&&s.along<lane.stations.at(-1)!)){
   expect(stop.control).toBeDefined()
   const red=stop.control!.group*16-stop.phase+14
   expect(trafficSignalGap([stop],vertical?'avenue':'street',stop.along-stop.direction!*10,stop.direction!,0,red)).toBeCloseTo(10.5,5)
  }
 }
},10000)
test('foot and driving guidance follows a curved native block',()=>{
 const p=middle,d=p.nativeDistricts![0],street=d.streets[1]
 const point=(t:number,offset:number)=>{const v=sampleStreetPath(street,t,offset);return{azimuth:street.azimuth+v.x/R,axial:street.axial+v.y,groundHeight:0}}
 for(const driving of [false,true]){
  const offset=driving?1.6:street.width/2+1.5
  const route=planNeighborhoodRoute(p,R,point(.04,offset),point(.20,offset),driving)
  expect(route).not.toBeNull();expect(route!.length).toBeGreaterThan(2)
  if(driving)expect(route!.every(v=>isDrivingStreetPoint(p.streetNetwork!,v.azimuth,v.axial))).toBe(true)
 }
})

test('foot guidance crosses the old collector at the native district boundary only on a zebra',()=>{
 const p=middle,m=p.streetMarkings!,n=p.streetNetwork!
 const junction=m.junctions.find(j=>j.arms.some(a=>n.streets[a.street].id.startsWith('district-'))&&j.arms.some(a=>!n.streets[a.street].id.startsWith('district-')&&n.streets[a.street].kind==='collector'))!
 expect(junction).toBeDefined()
 const c=m.junctionCrossings(junction).find(c=>c.source.kind==='collector'&&!c.source.id.startsWith('district-'))!,street=c.source,t=(c.start+c.end)/2
 const point=(offset:number)=>{const v=sampleStreetPath(street,t,offset);return{azimuth:street.azimuth+v.x/R,axial:street.axial+v.y,groundHeight:0}}
 const start=point(-street.width/2-1),goal=point(street.width/2+1),centre=point(0)
 const grid={startAzimuth:centre.azimuth,startAxial:centre.axial,minX:-30,minY:-30,nx:61,ny:61,step:1,cost:new Uint8Array(61*61)}
 paintDistrictFootways(p,R,grid);expect(grid.cost[30*61+30]).toBe(3)
 const route=planNeighborhoodRoute(p,R,start,goal,false)
 expect(route).not.toBeNull();expect(route!.some(v=>v.crosswalk)).toBe(true)
 const crossing=streetRibbon(street,c.start,c.end,-street.width/2,street.width/2)
 let crossed=0
 for(let i=1;i<route!.length;i++)for(let j=0;j<=20;j++){
  const a=route![i-1],b=route![i],x=wrap(a.azimuth-street.azimuth)*R+wrap(b.azimuth-a.azimuth)*R*j/20,y=a.axial-street.axial+(b.axial-a.axial)*j/20
  if(containsStreetPolygon(streetRibbon(street,0,1,-street.width/2,street.width/2),x,y)){
   crossed++;expect(containsStreetPolygon(crossing,x,y)).toBe(true)
  }
 }
 expect(crossed).toBeGreaterThan(0)
})

test('unsignalled native side streets yield to real crossing traffic and release after it clears',()=>{
 const n=middle.streetNetwork!,m=middle.streetMarkings!,signals=middle.streetSignals!
 const source=middleTraffic.find(t=>t.path.kind==='local'&&t.road.tangentWidth>t.road.axialLength)!
 const junction=m.junctions.find(j=>j.arms.some(a=>n.streets[a.street].id===source.path.id)&&j.arms.some(a=>n.streets[a.street].kind==='collector')&&!signals.controlsJunction(n.nodes[j.node].azimuth,n.nodes[j.node].axial))!
 expect(junction).toBeDefined()
 const node=n.nodes[junction.node],lane=new DistrictTrafficPath(source,R,signals),station=wrap(node.azimuth-source.road.azimuth)*R
 const crossing={azimuth:node.azimuth,axial:node.axial,heading:0,height:0,speed:4}
 for(const direction of [-1,1] as const){
  const approach=station-direction*24
  expect(lane.yieldGap(approach,direction,[crossing])).toBeLessThan(24)
  expect(lane.yieldGap(approach,direction,[])).toBe(Infinity)
  expect(lane.yieldGap(approach,direction,[{...crossing,height:4}])).toBe(Infinity)
  expect(lane.yieldGap(approach,direction,[{...crossing,heading:Math.PI/2}])).toBe(Infinity)
  expect(lane.yieldGap(station+direction*20,direction,[crossing])).toBe(Infinity)
 }
})

test('nearby residents and supported lamps use the native pavement without entering carriageways',async()=>{
 const {planDistrictWalkerRoutes}=await import('./districtWalkerRoutes'),{planDistrictLampSpots}=await import('./streetLamps')
 const p=middle,street=p.nativeDistricts![0].streets[1],v=sampleStreetPath(street,.12,11.3)
 const focus={azimuth:street.azimuth+v.x/R,axial:street.axial+v.y,range:110}
 const walkers=planDistrictWalkerRoutes(p,focus);expect(walkers.length).toBeGreaterThan(0);expect(walkers.length).toBeLessThan(40)
 const repeated=planDistrictWalkerRoutes(p,focus);expect(repeated).toHaveLength(walkers.length);expect(repeated.every((route,i)=>route===walkers[i])).toBe(true)
 expect(planDistrictWalkerRoutes(p,{azimuth:0,axial:-10000,range:110})).toEqual([])
 const returned=planDistrictWalkerRoutes(p,focus);expect(returned).toEqual(walkers);expect(returned.every((route,i)=>route!==walkers[i])).toBe(true)
 for(const walker of walkers)for(const point of walker.path!)expect(isDrivingStreetPoint(p.streetNetwork!,point.azimuth,point.axial,0)).toBe(false)
 const lamps=planDistrictLampSpots(p.nativeDistricts!,R,p.streetMarkings!);expect(lamps.length).toBeGreaterThan(250);expect(lamps.length).toBeLessThan(450)
 for(const lamp of lamps){
  const offset=lamp.side*(lamp.roadHalfWidth+.6),azimuth=lamp.azimuth-Math.sin(lamp.heading!)*offset/R,axial=lamp.axial+Math.cos(lamp.heading!)*offset
  expect(isDrivingStreetPoint(p.streetNetwork!,azimuth,axial,0)).toBe(false)
 }
})

test('paving risers block the oblique view of grass beneath a junction kerb',async()=>{
 const THREE=await import('three'),{StreetSurfacePlan}=await import('./streetSurfacePlan'),{legacyStreetPaths}=await import('./streetPath'),{buildDistrictKerbGeometry}=await import('./streetSurfaceGeometry')
 const paths=legacyStreetPaths([{azimuth:0,axial:0,tangentWidth:19.5,axialLength:200,kind:'arterial'},{azimuth:0,axial:0,tangentWidth:200,axialLength:6,kind:'local'}])
 const g=buildDistrictKerbGeometry(new StreetSurfacePlan(paths,R).sidewalks(),R,[{azimuth:0,axial:0,width:100,length:100}])!
 const point=(x:number,y:number,h:number)=>new THREE.Vector3(Math.cos(x/R)*(R-h),y,Math.sin(x/R)*(R-h))
 const origin=point(12,0,1.8),target=point(12,3,.15),ray=new THREE.Raycaster(origin,target.clone().sub(origin).normalize()),mesh=new THREE.Mesh(g,new THREE.MeshBasicMaterial({side:THREE.DoubleSide}))
 mesh.updateMatrixWorld();const hit=ray.intersectObject(mesh)[0]
 expect(hit).toBeDefined();expect(hit.point.distanceTo(target)).toBeLessThan(.03)
 g.dispose();mesh.material.dispose()
})

test('clipped avenue lamps keep intersection clearances in local road coordinates',async()=>{
 const {planLampSpots}=await import('./streetLamps')
 const road={azimuth:0,axial:5700,tangentWidth:19.5,axialLength:400,kind:'arterial' as const}
 const crossing={azimuth:0,axial:5600,avenueWidth:19.5,streetWidth:12,avenueKind:'arterial' as const,streetKind:'collector' as const}
 const a=planLampSpots([road],[crossing],R),b=planLampSpots([{...road,axial:0}],[{...crossing,axial:-100}],R)
 expect(a).toHaveLength(b.length)
 expect(a.map(p=>p.axial-5700)).toEqual(b.map(p=>p.axial))
 expect(a.every(p=>Math.abs(p.axial-5600)>=13)).toBe(true)
})
