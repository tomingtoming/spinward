import {expect,test} from 'bun:test'
import {planCity} from './cityLayout'
import {rebuildNativeDistricts} from './nativeDistricts'
import {rebuildArrivalWest,rebuildArrivalCentral,isArrivalStreet,arrivalStreets} from './arrivalDistrict'
import {rebuildArrivalCore} from './arrivalCore'
import {rebuildArrivalEast} from './arrivalEast'
import {retireArrivalSeams,joinedArrivalTraffic} from './arrivalSeams'
import {captureBandPublicPlaces} from './bandPublicPlaces'
import {certifyStreetAccess} from './streetFrontage'
import {planDistrictTraffic,districtTrafficCoverage} from './districtTraffic'
import {StreetSurfacePlan} from './streetSurfacePlan'
import {StreetMarkingPlan} from './streetMarkings'
import {StreetSignalPlan} from './streetSignals'
import {paintDistrictFootways,isDrivingStreetPoint} from '../app/streetRouteGrid'
import {planNeighborhoodRoute} from '../app/neighborhoodRoute'
const radius=3200,wrap=(a:number)=>Math.atan2(Math.sin(a),Math.cos(a))

for(const maxBuildings of [16000,18000,64000])test(`arrival seams retire only internal roads and keep through traffic at ${maxBuildings}`,()=>{
 const c=planCity({radius,length:40000,maxBuildings});rebuildNativeDistricts(c,radius)
 rebuildArrivalWest(c,radius,40000);rebuildArrivalCentral(c,radius,40000);rebuildArrivalCore(c,radius,40000);rebuildArrivalEast(c,radius,40000)
 const buildings=c.buildings.map(b=>({...b,access:undefined})),doors=c.buildings.map(b=>b.access?.entrance),places=captureBandPublicPlaces(c,radius),walks=c.entranceWalks
 const rejects=()=>certifyStreetAccess(c.buildings,c.streetNetwork!,radius,6).rejected.map(r=>({azimuth:r.building.azimuth,axial:r.building.axial,reason:r.reason}))
 const beforeRejected=rejects(),result=retireArrivalSeams(c,radius)
 expect(result.retiredPieces).toBe(7);expect(result.retiredLength).toBeCloseTo(4241.600146368392,6)
 expect(c.buildings.map(b=>({...b,access:undefined}))).toEqual(buildings);expect(c.buildings.map(b=>b.access?.entrance)).toEqual(doors)
 expect(captureBandPublicPlaces(c,radius)).toEqual(places);expect(c.entranceWalks).toBe(walks)
 expect(rejects()).toEqual(beforeRejected)
 const ids=new Set(c.streetNetwork!.streets.map(s=>s.id));expect(c.buildings.every(b=>b.access&&ids.has(b.access.roadId))).toBe(true)
 expect(new Set(c.streetNetwork!.components).size).toBe(3)
 expect(result.restored).toEqual(['district-arrival-south:band-504'])
 // Every source continuation at a removed internal boundary must be present,
 // even when that fragment was too short for the previous migration stage.
 const applied=c.nativeDistricts!.flatMap(d=>d.streets)
 for(const d of c.nativeDistricts!.filter(d=>d.streets.some(isArrivalStreet))){
  const x=wrap(d.azimuth)*radius
  for(const p of arrivalStreets(radius,d.id,{x0:x-d.width/2,x1:x+d.width/2,y0:d.axial-d.length/2,y1:d.axial+d.length/2})){
   const band=p.id.match(/:band-\d+$/)![0]
   if(p.knots.some(k=>result.seams.some(s=>Math.abs(k.point[s.vertical?0:1]-s.at)<1e-5&&k.point[s.vertical?1:0]>=s.low-1e-5&&k.point[s.vertical?1:0]<=s.high+1e-5)
    &&applied.some(o=>o.id!==p.id&&o.id.endsWith(band)&&o.knots.some(v=>Math.hypot(v.point[0]-k.point[0],v.point[1]-k.point[1])<1e-5))))expect(applied.some(o=>o.id===p.id)).toBe(true)
  }
 }
 for(const s of result.seams)for(const r of c.roads){
  const x=wrap(r.azimuth)*radius,vertical=r.axialLength>r.tangentWidth
  if(vertical!==s.vertical||Math.abs((vertical?x:r.axial)-s.at)>1e-5)continue
  const mid=vertical?r.axial:x,half=(vertical?r.axialLength:r.tangentWidth)/2
  expect(Math.min(mid+half,s.high)-Math.max(mid-half,s.low)).toBeLessThan(1e-5)
 }
 c.streetSurfaces=new StreetSurfacePlan(c.streetNetwork!.streets,radius,isArrivalStreet)
 c.streetMarkings=new StreetMarkingPlan(c.streetNetwork!);const signals=new StreetSignalPlan(c.streetMarkings,c.intersections)
 const routes=planDistrictTraffic(joinedArrivalTraffic(c,radius),radius,signals),joined=[...routes.values()].filter(r=>r.pieces.length>1)
 expect(joined).toHaveLength(13)
 for(const route of joined)for(let i=1;i<route.pieces.length;i++){
  const prev=route.pieces[i-1],next=route.pieces[i],station=prev.stations.at(-1)!
  expect(next.stations[0]).toBeCloseTo(station,6)
  for(const direction of [-1,1] as const){
   const a=route.sample(station-.001,direction*1.5,direction),b=route.sample(station+.001,direction*1.5,direction)
   expect(Math.hypot(wrap(a.azimuth-b.azimuth)*radius,a.axial-b.axial)).toBeLessThan(.01)
   expect(Math.abs(wrap(a.heading-b.heading))).toBeLessThan(.001)
   expect(isDrivingStreetPoint(c.streetNetwork!,a.azimuth,a.axial)).toBe(true)
   expect(isDrivingStreetPoint(c.streetNetwork!,b.azimuth,b.axial)).toBe(true)
  }
 }
 expect(districtTrafficCoverage(routes,c.roads,radius).spans.length).toBe(routes.size)
 if(maxBuildings===18000){
  const route=joined.find(r=>r.source.path.id.endsWith(':band-627'))!,p=route.source.path
  const a={azimuth:-475/radius,axial:416.426},b={azimuth:-400/radius,axial:410.69}
  for(const [start,goal] of [[a,b],[b,a]])expect(planNeighborhoodRoute(c,radius,start,goal,false,c.places!.park,c.places!.covered)).not.toBeNull()
  for(let x=-460;x<=-440;x+=.5){
   const y=406.9859546748541+(x+449.9957477141951)*(395.42331543193546-419.90285889525063)/320.0238022103039+7.2
   const cost=new Uint8Array(1);paintDistrictFootways(c,radius,{startAzimuth:0,startAxial:0,minX:x,minY:y,nx:1,ny:1,step:.5,cost})
   expect(cost[0]).toBe(1)
  }
  expect(p.id.startsWith('district-arrival-west:')).toBe(true)
 }
 expect(retireArrivalSeams(c,radius).retiredPieces).toBe(0)
},45000)
