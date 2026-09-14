import {expect,test} from 'bun:test'
import {planCity} from './cityLayout'
import {rebuildNativeDistricts} from './nativeDistricts'
import {rebuildArrivalWest,rebuildArrivalCentral,ARRIVAL_CENTRAL,ARRIVAL_CENTRAL_IDS,isArrivalStreet,arrivalStreets} from './arrivalDistrict'
import {captureBandPublicPlaces} from './bandPublicPlaces'
import {StreetSurfacePlan} from './streetSurfacePlan'
import {StreetMarkingPlan} from './streetMarkings'
import {sampleStreetPath} from './streetPath'
import {planNeighborhoodRoute,surfaceDistance} from '../app/neighborhoodRoute'
import cafe from '../../assets/blender/cafe-pilot.json'
import lobby from '../../assets/blender/lobby-pilot.json'
import apartment from '../../assets/blender/nyaan-apartment.json'
import shops from '../../assets/blender/neighborhood-fronts.json'
import blocks from '../../assets/blender/city-block.json'

test('migration defers a clipped terminal spur but keeps short junction links',()=>{
 const north=arrivalStreets(3200,ARRIVAL_CENTRAL_IDS[0],ARRIVAL_CENTRAL[0],true)
 const south=arrivalStreets(3200,ARRIVAL_CENTRAL_IDS[1],ARRIVAL_CENTRAL[1],true)
 expect(north.some(p=>p.id.endsWith(':band-111'))).toBe(true)
 expect(south.some(p=>p.id.endsWith(':band-278'))).toBe(true)
 expect(south.some(p=>p.id.endsWith(':band-504'))).toBe(false)
 expect(arrivalStreets(3200,ARRIVAL_CENTRAL_IDS[1],ARRIVAL_CENTRAL[1]).some(p=>p.id.endsWith(':band-504'))).toBe(true)
})

for(const maxBuildings of [16000,18000,64000])test(`central shoulders retain occupied places and connect both new road areas at ${maxBuildings}`,()=>{
 const radius=3200,city=planCity({radius,length:40000,maxBuildings})
 rebuildNativeDistricts(city,radius);rebuildArrivalWest(city,radius,40000)
 const publicPlaces=captureBandPublicPlaces(city,radius),total=city.buildings.length
 const contracts=[cafe.interior.building,lobby.interior.building,apartment.interior.building,shops.building,...blocks.blocks.map(b=>b.building)]
 const protectedBuildings=contracts.map(c=>city.buildings.find(b=>Math.abs(b.azimuth-c.azimuth)<1e-9&&Math.abs(b.axial-c.axial)<1e-6)!)
 // The authored lobby exists in the 64k city only; preserve that baseline
 // availability as well as every occupied contract in the smaller cities.
 expect(protectedBuildings.map(Boolean)).toEqual([true,maxBuildings===64000,true,true,true,true,true])
 const results=rebuildArrivalCentral(city,radius,40000)
 expect(results).toHaveLength(2);expect(city.nativeDistricts).toHaveLength(14)
 expect(captureBandPublicPlaces(city,radius)).toEqual(publicPlaces)
 expect(city.buildings.length).toBeLessThanOrEqual(total)
 for(const b of protectedBuildings.filter(Boolean)){
  const retained=city.buildings.find(p=>p.azimuth===b.azimuth&&p.axial===b.axial)!
  expect(retained).toBeDefined()
  expect({...retained,access:undefined}).toEqual({...b,access:undefined})
  expect(retained.access?.entrance).toEqual(b.access?.entrance)
  expect(retained.access?.roadEdge).toEqual(b.access?.roadEdge)
 }
 const network=city.streetNetwork!
 expect(new Set(network.components).size).toBe(3)
 city.streetSurfaces=new StreetSurfacePlan(network.streets,radius,isArrivalStreet)
 city.streetMarkings=new StreetMarkingPlan(network)
 for(const [i,{district:d}] of results.entries()){
  expect(d.id).toBe(ARRIVAL_CENTRAL_IDS[i]);expect(d.streets.length).toBe(i===0?11:8)
  expect(d.replacedRoads).toBe(i===0?23:21);expect(d.buildings.length).toBeGreaterThan(40)
  expect(new Set(d.streets.map(p=>network.components[network.streets.indexOf(p)])).size).toBe(1)
  expect(d.buildings.every(b=>b.access?.roadId?.startsWith(d.id)&&b.nativeParcel)).toBe(true)
  const bounds=ARRIVAL_CENTRAL[i],inside=(x:number,y:number)=>x>bounds.x0+1e-5&&x<bounds.x1-1e-5&&y>bounds.y0+1e-5&&y<bounds.y1-1e-5
  expect(city.intersections.some(p=>inside(p.azimuth*radius,p.axial))).toBe(false)
  for(const road of city.roads){
   const vertical=road.axialLength>road.tangentWidth,half=(vertical?road.axialLength:road.tangentWidth)/2
   const x=road.azimuth*radius,y=road.axial
   const overlap=vertical?x>bounds.x0+1e-5&&x<bounds.x1-1e-5&&y+half>bounds.y0+1e-5&&y-half<bounds.y1-1e-5:
    y>bounds.y0+1e-5&&y<bounds.y1-1e-5&&x+half>bounds.x0+1e-5&&x-half<bounds.x1-1e-5
   expect(overlap).toBe(false)
  }
  const path=d.streets.find(p=>p.id.endsWith(i===0?':band-109':':band-8'))!,near=sampleStreetPath(path,.45,path.width/2+1.5),start={azimuth:near.x/radius,axial:near.y}
  for(const place of publicPlaces.slice(0,2))for(const reverse of [false,true]){
   const [x,y]=place.walkingEntrances[0].point,goal={azimuth:x/radius,axial:y},a=reverse?goal:start,b=reverse?start:goal
   const walk=planNeighborhoodRoute(city,radius,a,b,false,city.places!.park,city.places!.covered)!
   expect(walk).not.toBeNull();expect(walk[0]).toEqual(a);expect(walk.at(-1)).toEqual(b)
   expect(walk.some(p=>p.crosswalk)).toBe(true)
   expect(walk.slice(1).reduce((n,p,i)=>n+surfaceDistance(walk[i],p,radius),0)).toBeLessThan(2000)
  }
  const lane=sampleStreetPath(path,.45)
  expect(planNeighborhoodRoute(city,radius,{azimuth:lane.x/radius,axial:lane.y},{azimuth:-400/radius,axial:0},true)).not.toBeNull()
 }
 expect(()=>rebuildArrivalCentral(city,radius,40000)).toThrow('already applied')
 expect(rebuildArrivalCentral(city,3000,40000)).toEqual([])
},30000)
