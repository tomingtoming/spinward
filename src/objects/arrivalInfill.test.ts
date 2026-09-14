import {expect,test} from 'bun:test'
import {planCity} from './cityLayout'
import {rebuildNativeDistricts} from './nativeDistricts'
import {rebuildArrivalWest,rebuildArrivalCentral} from './arrivalDistrict'
import {rebuildArrivalCore} from './arrivalCore'
import {rebuildArrivalEast} from './arrivalEast'
import {retireArrivalSeams} from './arrivalSeams'
import {connectArrivalLocalStreets} from './arrivalLocalLinks'
import {populateArrivalLocalStreets} from './arrivalInfill'
import {captureBandPublicPlaces} from './bandPublicPlaces'
import {buildingFootprint,certifyStreetAccess} from './streetFrontage'
import {landContains} from './streetParcels'
import {intersectStreetPolygons,polygonArea} from './streetPolygon'
import {colonyBuildingUse} from './colonyBuildingUse'

let baseline:string|undefined
for(const maximumBuildings of [16000,18000,64000])test(`local arrival infill preserves inhabited land and budget at ${maximumBuildings}`,()=>{
 const radius=3200,c=planCity({radius,length:40000,maxBuildings:maximumBuildings})
 rebuildNativeDistricts(c,radius);rebuildArrivalWest(c,radius,40000);rebuildArrivalCentral(c,radius,40000)
 rebuildArrivalCore(c,radius,40000);rebuildArrivalEast(c,radius,40000);retireArrivalSeams(c,radius);connectArrivalLocalStreets(c,radius)
 const existing=[...c.buildings],network=c.streetNetwork,streets=JSON.stringify(c.nativeDistricts!.map(d=>d.streets)),places=captureBandPublicPlaces(c,radius),walks=c.entranceWalks
 const copy=()=>({...c,buildings:[...existing],nativeDistricts:c.nativeDistricts!.map(d=>({...d,buildings:[...d.buildings]}))})
 const limited=copy()
 const rejected=()=>certifyStreetAccess(c.buildings,network!,radius,6).rejected.map(r=>({azimuth:r.building.azimuth,axial:r.building.axial,reason:r.reason}))
 const before=rejected(),added=populateArrivalLocalStreets(c,radius,maximumBuildings)
 expect(added).toHaveLength(64);expect(c.buildings.length).toBeLessThanOrEqual(maximumBuildings)
 expect(c.buildings.slice(0,existing.length)).toEqual(existing);expect(c.buildings.slice(0,existing.length).every((b,i)=>b===existing[i])).toBe(true)
 expect(c.streetNetwork).toBe(network);expect(JSON.stringify(c.nativeDistricts!.map(d=>d.streets))).toBe(streets)
 expect(captureBandPublicPlaces(c,radius)).toEqual(places);expect(c.entranceWalks).toBe(walks);expect(rejected()).toEqual(before)
 const geometry=JSON.stringify(added.map(b=>({...b,access:undefined})))
 if(baseline)expect(geometry).toBe(baseline);else baseline=geometry
 expect(new Set(added.map(b=>b.access!.roadId)).size).toBe(4)
 expect(added.map(colonyBuildingUse).filter(u=>u.primary==='apartments')).toHaveLength(59)
 expect(added.map(colonyBuildingUse).filter(u=>u.mixed)).toHaveLength(7)
 expect(new Set(added.map(b=>b.height)).size).toBe(6)
 for(const b of added){
  const d=c.nativeDistricts!.find(d=>d.id===b.nativeDistrict)!,parcel=d.infill!.land.flatMap(l=>l.parcels).find(p=>p.id===b.nativeParcel)!
  expect(landContains(parcel.pieces,buildingFootprint(b).map(v=>({...v,x:v.x+(b.azimuth-d.azimuth)*radius,y:v.y+b.axial-d.axial})))).toBe(true)
  expect(b.access!.roadId).toBe(parcel.front.streetId);expect(network!.streets[b.access!.roadIndex].id).toBe(b.access!.roadId)
  const footprint=buildingFootprint(b),ys=footprint.map(v=>v.y+b.axial),e=c.expressway!
  expect(Math.max(...ys)<=e.axial-e.corridorHalfWidth||Math.min(...ys)>=e.axial+e.corridorHalfWidth).toBe(true)
  for(const other of c.buildings){
   if(other===b||Math.hypot((other.azimuth-b.azimuth)*radius,other.axial-b.axial)>(Math.hypot(b.width,b.depth)+Math.hypot(other.width,other.depth))/2+1)continue
   const p=buildingFootprint(other).map(v=>({...v,x:v.x+(other.azimuth-b.azimuth)*radius,y:v.y+other.axial-b.axial}))
   expect(polygonArea(intersectStreetPolygons(footprint,p))).toBeLessThan(1e-5)
  }
 }
 expect(populateArrivalLocalStreets(c,radius,maximumBuildings)).toEqual([])
 if(maximumBuildings===16000){
  expect(populateArrivalLocalStreets(limited,radius,existing.length+5)).toHaveLength(5)
  expect(limited.buildings.length).toBe(existing.length+5)
  expect(()=>populateArrivalLocalStreets(c,radius,NaN)).toThrow('Invalid arrival infill budget')
 }
},60000)
