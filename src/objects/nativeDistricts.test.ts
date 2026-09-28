import { expect, test } from 'bun:test'
import { planCity, type CityPlan } from './cityLayout'
import { rebuildNativeDistricts, type DistrictTrafficStreet } from './nativeDistricts'
import { StreetMarkingPlan } from './streetMarkings'
import { StreetSignalPlan } from './streetSignals'
import { buildingFootprint, certifyStreetAccess } from './streetFrontage'
import { intersectStreetPolygons, polygonArea } from './streetPolygon'
import { DistrictTrafficPath, planDistrictTraffic, districtTrafficCoverage } from './districtTraffic'
import { trafficRoadKey } from './trafficRoadSpans'
import { createTrafficSignalIndex,routeTrafficSignals,trafficSignalGap } from './intersectionSignals'
import { sampleStreetPath, streetRibbon } from './streetPath'
import { isDrivingStreetPoint, paintDistrictFootways } from '../app/streetRouteGrid'
import { containsStreetPolygon } from './streetPolygon'
import { planNeighborhoodRoute } from '../app/neighborhoodRoute'
import { StreetNetwork } from './streetNetwork'
import { landContains } from './streetParcels'
import { planOldTownBlock, planOldTownCourt } from './oldTownBlockPlan'
const R=3200,wrap=(a:number)=>Math.atan2(Math.sin(a),Math.cos(a))
let middle:CityPlan
let middleTraffic:DistrictTrafficStreet[]
const districtLand=new Map<string,unknown>()
for(const maxBuildings of [16000,18000,64000])test(`connected districts preserve lots, budgets and actual frontage at ${maxBuildings}`,()=>{
 const unchanged=(b:{azimuth:number;axial:number})=>b.axial<4000&&(Math.abs(wrap(b.azimuth))*R>600||b.axial<-8850||b.axial>-6150)
 const p=planCity({radius:R,length:40000,maxBuildings}),before=p.buildings.length,old=p.buildings.filter(unchanged)
 const oldTown=planOldTownBlock(p.buildings,p.roads,R,40000)
 const oldCourt=planOldTownCourt(oldTown,p.buildings,p.roads,R,40000)
 const {districts,traffic}=rebuildNativeDistricts(p,R),network=p.streetNetwork!
 // Remote migration may split an avenue, but cannot move the arrival block
 // or make its existing public court disappear.
 const preservedTown=planOldTownBlock(p.buildings,p.roads,R,40000)
 const townShape=(lots:typeof oldTown)=>lots.map(l=>{const {access,...building}=l.spec.building;return building})
 expect(townShape(preservedTown)).toEqual(townShape(oldTown))
 expect(planOldTownCourt(preservedTown,p.buildings,p.roads,R,40000)).toEqual(oldCourt)
 expect(districts).toHaveLength(11);expect(p.buildings.length).toBe(before)
 expect(p.buildings.filter(unchanged).map(b=>[b.azimuth,b.axial,b.width,b.depth,b.height])).toEqual(old.map(b=>[b.azimuth,b.axial,b.width,b.depth,b.height]))
 expect(new Set(network.components).size).toBe(3);expect(traffic).toHaveLength(74)
 // An arbitrary migration perimeter may cut an old frontage even when the
 // building centre is outside. Retained neighbours must still have real access.
 expect(certifyStreetAccess(p.buildings,network,R,6).rejected).toEqual([])
 const ids=new Set(network.streets.map(s=>s.id));expect(p.buildings.every(b=>b.access&&ids.has(b.access.roadId))).toBe(true)
 const m=new StreetMarkingPlan(network),s=new StreetSignalPlan(m,p.intersections);p.streetMarkings=m;p.streetSignals=s
 const junctions=m.junctions.filter(j=>j.arms.some(a=>network.streets[a.street].id.startsWith('district-')))
 expect(junctions).toHaveLength(356)
 expect(junctions.filter(j=>j.arms.length===3)).toHaveLength(95)
 for(const j of junctions){
  expect(m.junctionCrossings(j)).toHaveLength(j.arms.length)
  if(j.arms.some(a=>network.streets[a.street].kind==='arterial')){
   const n=network.nodes[j.node];expect(s.controlsJunction(n.azimuth,n.axial)).toBe(true)
  }
 }
 // Certify every rebuilt building together. Rebuilding the same road index
 // separately for each district repeats setup and omits neighbouring districts
 // from the obstacle set; a single batch retains and strengthens the check.
 expect(certifyStreetAccess(districts.flatMap(d=>d.buildings),network,R,6).rejected).toEqual([])
 for(const d of districts){
  expect(d.buildings.length).toBe(d.replacedBuildings);expect(d.streets).toHaveLength(d.layout==='anchor-led'?32:d.layout==='place-led'?14:d.character==='mixed'?11:d.character==='residential'?9:13)
  for(const link of d.streets.filter(p=>p.id.includes(':link-'))){
   const index=network.streets.indexOf(link)
   expect(network.closedEnds[index]).toEqual([false,false])
   const ends=junctions.filter(j=>j.arms.some(a=>a.street===index))
   expect(ends).toHaveLength(2);expect(ends.every(j=>j.arms.length===3)).toBe(true)
  }
  if(d.layout){
   expect(d.land!.blocks.length).toBeGreaterThan(2)
   expect(d.land!.parcels.length).toBeGreaterThan(d.replacedBuildings)
   if(districtLand.has(d.id))expect(d.land).toEqual(districtLand.get(d.id));else districtLand.set(d.id,d.land)
   for(const b of d.buildings){
    const parcel=d.land!.parcels.find(p=>p.id===b.nativeParcel)!
    expect(parcel).toBeDefined();expect(b.access!.roadId).toBe(parcel.front.streetId)
    expect(landContains(parcel.pieces,buildingFootprint(b).map(v=>({...v,x:v.x+wrap(b.azimuth-d.azimuth)*R,y:v.y+b.axial-d.axial})))).toBe(true)
   }
  }
  for(let i=0;i<d.buildings.length;i++)for(let j=0;j<i;j++){
   const a=d.buildings[i],b=d.buildings[j],dx=wrap(b.azimuth-a.azimuth)*R,dy=b.axial-a.axial
   if(Math.abs(dx)>80||Math.abs(dy)>80)continue
   expect(polygonArea(intersectStreetPolygons(buildingFootprint(a),buildingFootprint(b).map(v=>({...v,x:v.x+dx,y:v.y+dy}))))).toBeLessThan(1e-6)
  }
 }
 if(maxBuildings===18000){middle=p;middleTraffic=traffic}
},30000) // Validate up to 64,000 lots; the deadline is only a test-runner guard.
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
    expect(p0.stationRate).toBeGreaterThan(t.path.id==='district-park:bypass'?.35:.7)
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

test('the park district changes connectivity instead of warping an intersection grid',()=>{
 const p=middle,d=p.nativeDistricts!.find(d=>d.layout==='place-led')!,n=new StreetNetwork(d.streets,R)
 const junctions=new StreetMarkingPlan(n).junctions
 expect(new Set(n.components).size).toBe(1)
 expect(junctions.length).toBe(12);expect(junctions.every(j=>j.arms.length===3)).toBe(true)
 // One circuit around the reserved park, with branches ending at that circuit.
 // A rectangular street lattice has several independent interior circuits.
 expect(n.edges.length-n.nodes.length+1).toBe(1)
 expect(n.nodes.filter(v=>v.edges.length===1)).toHaveLength(12)
 expect(d.growth!.deferredLinks).toEqual([])
 expect(d.growth!.links[0].added).toBe(true)
 expect(d.growth!.links[0].before).toBeGreaterThan(d.growth!.links[0].after*1.8)
 expect(d.growth!.connections.filter(c=>c.destination.startsWith('approach-')&&c.street!=='district-park:bypass').length).toBeGreaterThan(1)
 const old=new StreetMarkingPlan(new StreetNetwork(p.nativeDistricts![0].streets,R))
 expect(old.junctions.some(j=>j.arms.length===4)).toBe(true)
 const reserve=d.reserves![0]
 for(const segment of n.segments){
  const street=n.streets[segment.street]
  expect(polygonArea(intersectStreetPolygons(streetRibbon(street,segment.start.t,segment.end.t,-street.width/2-3,street.width/2+3),reserve))).toBeLessThan(1e-6)
 }
 for(const b of d.buildings){
  const footprint=buildingFootprint(b).map(v=>({...v,x:v.x+wrap(b.azimuth-d.azimuth)*R,y:v.y+b.axial-d.axial}))
  expect(polygonArea(intersectStreetPolygons(footprint,reserve))).toBeLessThan(1e-6)
 }
 for(const street of d.streets)expect(p.streetNetwork!.closedEnds[p.streetNetwork!.streets.indexOf(street)]).toEqual([false,false])
})

test('settlement boundaries, character and guidance follow the shared network',()=>{
 const p=middle,d=p.nativeDistricts!.find(d=>d.layout==='anchor-led')!,n=p.streetNetwork!,spine=d.streets[0]
 for(const s of d.streets){
  const ends=n.closedEnds[n.streets.indexOf(s)]
  expect(ends[1]).toBe(false)
  if(s.id.includes(':approach-')||s===spine||s.id.endsWith('-connection'))expect(ends[0]).toBe(false)
 }
 const homes=d.buildings.filter(b=>b.urban===.42),centre=d.buildings.filter(b=>b.urban===.84)
 expect(homes.length).toBeGreaterThan(20);expect(centre.length).toBeGreaterThan(20)
 expect(homes.every(b=>b.height<=24)).toBe(true);expect(centre.some(b=>b.height>=50)).toBe(true)
 const point=(s:typeof spine,t:number,offset:number)=>{const v=sampleStreetPath(s,t,offset);return{azimuth:s.azimuth+v.x/R,axial:s.axial+v.y,groundHeight:0}}
 const drive=planNeighborhoodRoute(p,R,point(spine,.31,1.5),point(spine,.63,1.5),true)
 expect(drive).not.toBeNull();expect(drive!.every(v=>isDrivingStreetPoint(n,v.azimuth,v.axial))).toBe(true)
 const branch=d.streets.find(s=>s.id.endsWith(':market-1'))!
 const walk=planNeighborhoodRoute(p,R,point(branch,.4,branch.width/2+1.2),point(spine,.36,spine.width/2+1.5),false)
 expect(walk).not.toBeNull();expect(walk!.length).toBeGreaterThan(2)
 const coverage=districtTrafficCoverage(planDistrictTraffic(middleTraffic,R,p.streetSignals),p.roads,R)
 for(const span of coverage.spans){
  const route=coverage.routes.get(trafficRoadKey(span.road))
  if(!route||!span.isAvenue)continue
  const lo=Math.max(span.spanStart,d.axial-d.length/2),hi=Math.min(span.spanStart+span.spanLength,d.axial+d.length/2)
  for(let along=lo;along<=hi;along+=5)for(const direction of [-1,1] as const){
   const v=route.sample(along,direction*1.5,direction)
   expect(isDrivingStreetPoint(n,v.azimuth,v.axial)).toBe(true)
  }
 }
},10000)

test('driving around the reserved park uses the circuit and walking joins a terminating branch',()=>{
 const p=middle,d=p.nativeDistricts!.find(d=>d.layout==='place-led')!,n=p.streetNetwork!,bypass=d.streets[0],circuit=d.streets.find(s=>s.id==='district-park:east-connection')!
 const point=(street:typeof bypass,t:number,offset:number)=>{const v=sampleStreetPath(street,t,offset);return{azimuth:street.azimuth+v.x/R,axial:street.axial+v.y,groundHeight:0}}
 const start=point(bypass,.5,1.5),end=point(circuit,.5,1.5),drive=planNeighborhoodRoute(p,R,start,end,true)
 expect(drive).not.toBeNull()
 expect(drive!.every(v=>isDrivingStreetPoint(n,v.azimuth,v.axial))).toBe(true)
 let length=0
 for(let i=1;i<drive!.length;i++)length+=Math.hypot(wrap(drive![i].azimuth-drive![i-1].azimuth)*R,drive![i].axial-drive![i-1].axial)
 expect(length).toBeGreaterThan(Math.hypot(wrap(end.azimuth-start.azimuth)*R,end.axial-start.axial)*1.4)
 const branch=d.streets.find(s=>s.id==='district-park:approach-3')!
 const walk=planNeighborhoodRoute(p,R,point(branch,.5,branch.width/2+1),point(d.streets[1],.5,d.streets[1].width/2+1.5),false)
 expect(walk).not.toBeNull();expect(walk!.some(v=>v.crosswalk)).toBe(true)
})

test('native traffic cannot continue on straight fallback through a removed road',()=>{
 const p=middle,d=p.nativeDistricts!.find(d=>d.layout==='place-led')!,coverage=districtTrafficCoverage(planDistrictTraffic(middleTraffic,R,p.streetSignals),p.roads,R)
 for(const span of coverage.spans){
  const route=coverage.routes.get(trafficRoadKey(span.road))!
  expect(route).toBeDefined()
  if(!span.isAvenue)continue
  const lo=Math.max(span.spanStart,d.axial-d.length/2),hi=Math.min(span.spanStart+span.spanLength,d.axial+d.length/2)
  for(let along=lo;along<=hi;along+=5)for(const direction of [-1,1] as const){
   const v=route.sample(along,direction*1.5,direction)
   expect(isDrivingStreetPoint(p.streetNetwork!,v.azimuth,v.axial)).toBe(true)
  }
 }
 const central=coverage.spans.filter(s=>s.road.azimuth===d.azimuth&&s.road.kind==='arterial')
 expect(central).toHaveLength(1)
 // Both former straight side avenues really end and restart outside the park.
 for(const x of [-224.9978738570976,224.9978738570976]){
  const spans=coverage.spans.filter(s=>Math.abs(s.road.azimuth*R-x)<.01)
  expect(spans).toHaveLength(3) // Also split at the separate settlement corridor.
  expect(spans.every(s=>s.spanStart>=d.axial+d.length/2-.01||s.spanStart+s.spanLength<=d.axial-d.length/2+.01)).toBe(true)
 }
})

test('district corridors share real boundary nodes, keep varied massing and allow local foot and driving guidance across them',()=>{
 const p=middle,n=p.streetNetwork!
 for(const band of [0,1,2]){
  const regions=p.nativeDistricts!.filter(d=>d.band===band&&!d.layout)
  expect(regions.map(d=>d.character)).toEqual(['mixed','residential','centre'])
  expect(Math.max(...regions[1].buildings.map(b=>b.height))).toBeLessThanOrEqual(24)
  expect(Math.max(...regions[2].buildings.map(b=>b.height))).toBeGreaterThan(45)
  for(let i=1;i<regions.length;i++){
   const a=regions[i-1],b=regions[i]
   expect(a.axial+a.length/2).toBeCloseTo(b.axial-b.length/2,6)
   for(let road=0;road<3;road++){
    const left=n.streets.indexOf(a.streets[road]),right=n.streets.indexOf(b.streets[road])
    expect(n.nodes.some(node=>node.edges.some(e=>n.edges[e].street===left)&&node.edges.some(e=>n.edges[e].street===right))).toBe(true)
   }
   const point=(street:typeof a.streets[number],t:number,offset:number)=>{const q=sampleStreetPath(street,t,offset);return{azimuth:street.azimuth+q.x/R,axial:street.axial+q.y,groundHeight:0}}
   for(const driving of [false,true]){
    const route=planNeighborhoodRoute(p,R,point(a.streets[1],.96,driving?1.5:11.3),point(b.streets[1],.04,driving?1.5:11.3),driving)
    expect(route).not.toBeNull();expect(route!.some(v=>v.axial>b.axial-b.length/2)).toBe(true)
    if(driving)expect(route!.every(v=>isDrivingStreetPoint(n,v.azimuth,v.axial))).toBe(true)
   }
  }
 }
},10000)

test('a through car and its signals follow every district piece without duplicate routes or a boundary jump',()=>{
 const p=middle,routes=planDistrictTraffic(middleTraffic,R,p.streetSignals),index=createTrafficSignalIndex([],p.streetSignals,p.roads)
 expect(routes.size).toBe(54)
 const through=[...routes.values()].filter(r=>r.pieces.length>1)
 expect(through).toHaveLength(9)
 for(const route of through){
   expect(route.pieces).toHaveLength(route.sources.some(s=>s.path.id==='district-park:bypass')?5:3)
  const road=route.source.road,stops=routeTrafficSignals(index,road,R,road.axial-road.axialLength/2,road.axialLength,route.source.sourceRoadIds)
  for(const piece of route.pieces){
   expect(route.source.sourceRoadIds).toContain(piece.source.path.id)
   for(const direction of [-1,1] as const)for(let i=1;i<30;i++){
    const along=piece.stations[0]+(piece.stations.at(-1)!-piece.stations[0])*i/30
    const v=route.sample(along,direction*1.5,direction)
    expect(v).toEqual(piece.sample(along,direction*1.5,direction));expect(isDrivingStreetPoint(p.streetNetwork!,v.azimuth,v.axial)).toBe(true)
   }
   if(road.kind==='arterial')expect(stops.some(s=>s.along>piece.stations[0]&&s.along<piece.stations.at(-1)!)).toBe(true)
  }
  for(let i=1;i<route.pieces.length;i++)for(const direction of [-1,1] as const){
   const boundary=route.pieces[i].stations[0],a=route.sample(boundary-.001,direction*1.5,direction),b=route.sample(boundary+.001,direction*1.5,direction)
   expect(Math.hypot(wrap(a.azimuth-b.azimuth)*R,a.axial-b.axial)).toBeLessThan(.01);expect(Math.abs(wrap(a.heading-b.heading))).toBeLessThan(.001)
  }
 }
})

test('oblique local streets connect foot and driving routes to the arterial at real T junctions',()=>{
 const p=middle
 for(const district of p.nativeDistricts!.filter(d=>!d.layout)){
  const link=district.streets.find(s=>s.id.endsWith(':link-0'))!,arterial=district.streets[1]
  const point=(street:typeof link,t:number,offset:number)=>{const v=sampleStreetPath(street,t,offset);return{azimuth:street.azimuth+v.x/R,axial:street.axial+v.y,groundHeight:0}}
  for(const driving of [false,true]){
   const start=point(link,.7,driving?1.5:4.2),goal=point(arterial,.18,driving?1.6:11.2)
   const route=planNeighborhoodRoute(p,R,start,goal,driving)
   expect(route).not.toBeNull();expect(route!.length).toBeGreaterThan(2)
   if(driving)expect(route!.every(v=>isDrivingStreetPoint(p.streetNetwork!,v.azimuth,v.axial))).toBe(true)
  }
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
 const lamps=planDistrictLampSpots(p.nativeDistricts!,R,p.streetMarkings!);expect(lamps.length).toBeGreaterThan(1400);expect(lamps.length).toBeLessThan(2000)
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
