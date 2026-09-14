import {expect,test} from 'bun:test'
import {planCity} from './cityLayout'
import {rebuildNativeDistricts} from './nativeDistricts'
import {rebuildArrivalWest,rebuildArrivalCentral,isArrivalStreet} from './arrivalDistrict'
import {rebuildArrivalCore} from './arrivalCore'
import {rebuildArrivalEast} from './arrivalEast'
import {retireArrivalSeams,joinedArrivalTraffic} from './arrivalSeams'
import {connectArrivalLocalStreets} from './arrivalLocalLinks'
import {captureBandPublicPlaces} from './bandPublicPlaces'
import {certifyStreetAccess} from './streetFrontage'
import {StreetSurfacePlan} from './streetSurfacePlan'
import {StreetMarkingPlan} from './streetMarkings'
import {planDistrictTraffic} from './districtTraffic'
import {isDrivingStreetPoint,paintDistrictFootways} from '../app/streetRouteGrid'
import {sampleStreetPath} from './streetPath'
let baseline:string|undefined
for(const maxBuildings of [16000,18000,64000])test(`arrival local streets retain buildings and connect usable land at ${maxBuildings}`,()=>{
 const radius=3200,c=planCity({radius,length:40000,maxBuildings});rebuildNativeDistricts(c,radius)
 rebuildArrivalWest(c,radius,40000);rebuildArrivalCentral(c,radius,40000);rebuildArrivalCore(c,radius,40000);rebuildArrivalEast(c,radius,40000);retireArrivalSeams(c,radius)
 const buildings=c.buildings.map(b=>({...b,access:undefined})),doors=c.buildings.map(b=>b.access?.entrance),places=captureBandPublicPlaces(c,radius),walks=c.entranceWalks
 const rejects=()=>certifyStreetAccess(c.buildings,c.streetNetwork!,radius,6).rejected.map(r=>({azimuth:r.building.azimuth,axial:r.building.axial,reason:r.reason}))
 const before=rejects(),result=connectArrivalLocalStreets(c,radius)
 expect(result.links).toHaveLength(4);expect(result.retired).toEqual(['district-arrival-west:band-392'])
 const geometry=JSON.stringify(result.links.map(l=>({knots:l.path.knots,before:l.before,after:l.after})))
 if(baseline)expect(geometry).toBe(baseline);else baseline=geometry
 expect(c.buildings.map(b=>({...b,access:undefined}))).toEqual(buildings);expect(c.buildings.map(b=>b.access?.entrance)).toEqual(doors)
 expect(captureBandPublicPlaces(c,radius)).toEqual(places);expect(c.entranceWalks).toBe(walks);expect(rejects()).toEqual(before)
 expect(c.buildings.every(b=>b.access&&c.streetNetwork!.streets[b.access.roadIndex]?.id===b.access.roadId)).toBe(true)
 expect(new Set(c.streetNetwork!.components).size).toBe(3)
 c.streetSurfaces=new StreetSurfacePlan(c.streetNetwork!.streets,radius,isArrivalStreet);c.streetMarkings=new StreetMarkingPlan(c.streetNetwork!)
 const routes=planDistrictTraffic(joinedArrivalTraffic(c,radius),radius)
 for(const l of result.links){
  expect(l.before/l.after).toBeGreaterThan(1.8)
  expect([...routes.values()].some(r=>r.sources.some(s=>s.path.id.endsWith(`:${l.path.id}`)))).toBe(true)
  for(let t=.08;t<=.92;t+=.04){
   const p=sampleStreetPath(l.path,t,0);expect(isDrivingStreetPoint(c.streetNetwork!,p.x/radius,p.y)).toBe(true)
   for(const side of [-1,1]){
    const p=sampleStreetPath(l.path,t,side*4),cost=new Uint8Array(1)
    paintDistrictFootways(c,radius,{startAzimuth:0,startAxial:0,minX:p.x,minY:p.y,nx:1,ny:1,step:.5,cost});expect(cost[0]).toBe(1)
   }
  }
 }
 expect(connectArrivalLocalStreets(c,radius).links).toEqual([])
},60000)
