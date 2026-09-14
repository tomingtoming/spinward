import {expect,test} from 'bun:test'
import {planCity} from './cityLayout'
import {rebuildNativeDistricts} from './nativeDistricts'
import {rebuildArrivalWest,rebuildArrivalCentral,isArrivalStreet} from './arrivalDistrict'
import {ARRIVAL_CORE,ARRIVAL_CORE_ID,rebuildArrivalCore} from './arrivalCore'
import {captureBandPublicPlaces} from './bandPublicPlaces'
import {StreetSurfacePlan} from './streetSurfacePlan'
import {StreetMarkingPlan} from './streetMarkings'
import {buildingFootprint} from './streetFrontage'
import {intersectStreetPolygons,polygonArea} from './streetPolygon'
import {sampleCitySurface} from './citySurfaceMesh'
import {paintDistrictFootways} from '../app/streetRouteGrid'
import {planNeighborhoodRoute} from '../app/neighborhoodRoute'
import cafe from '../../assets/blender/cafe-pilot.json'
import lobby from '../../assets/blender/lobby-pilot.json'
import apartment from '../../assets/blender/nyaan-apartment.json'
import shops from '../../assets/blender/neighborhood-fronts.json'
import blocks from '../../assets/blender/city-block.json'

for(const maxBuildings of [16000,18000,64000])test(`the civic core retains its inhabited entrances and connects the park at ${maxBuildings}`,()=>{
 const radius=3200,c=planCity({radius,length:40000,maxBuildings})
 rebuildNativeDistricts(c,radius);rebuildArrivalWest(c,radius,40000);rebuildArrivalCentral(c,radius,40000)
  const places=captureBandPublicPlaces(c,radius),count=c.buildings.length
 const parkPatch=c.places!.park!.patch
 const parkTrees=c.trees.filter(t=>Math.abs((t.azimuth-parkPatch.azimuth)*radius)<=parkPatch.tangentExtent/2&&Math.abs(t.axial-parkPatch.axial)<=parkPatch.axialExtent/2)
 // The 64k baseline has no background-tree samples in this patch. Preserve
 // each quality's existing population, including an empty one.
 if(maxBuildings!==64000)expect(parkTrees.length).toBeGreaterThan(0)
 const contracts=[cafe.interior.building,lobby.interior.building,apartment.interior.building,shops.building,...blocks.blocks.map(b=>b.building)]
 const protectedBuildings=contracts.map(b=>c.buildings.find(p=>Math.abs(b.azimuth-p.azimuth)<1e-9&&Math.abs(b.axial-p.axial)<1e-6)).filter(b=>b!==undefined)
 expect(protectedBuildings).toHaveLength(maxBuildings===64000?7:6)
 const d=rebuildArrivalCore(c,radius,40000)!.district
 expect(d.id).toBe(ARRIVAL_CORE_ID);expect(d.streets).toHaveLength(14);expect(d.replacedRoads).toBe(18)
 expect(d.buildings.length).toBeGreaterThan(40);expect(c.buildings.length).toBeLessThanOrEqual(count)
 expect(c.nativeDistricts).toHaveLength(15);expect(new Set(c.streetNetwork!.components).size).toBe(3)
  expect(captureBandPublicPlaces(c,radius)).toEqual(places)
 expect(c.patches.find(p=>p.azimuth===parkPatch.azimuth&&p.axial===parkPatch.axial)).toEqual(parkPatch)
 expect(c.trees.filter(t=>Math.abs((t.azimuth-parkPatch.azimuth)*radius)<=parkPatch.tangentExtent/2&&Math.abs(t.axial-parkPatch.axial)<=parkPatch.axialExtent/2)).toEqual(parkTrees)
 for(const b of protectedBuildings){
  const kept=c.buildings.find(p=>p.azimuth===b.azimuth&&p.axial===b.axial)!
  expect({...kept,access:undefined}).toEqual({...b,access:undefined})
  expect(kept.access?.entrance).toEqual(b.access?.entrance);expect(kept.access?.roadEdge).toEqual(b.access?.roadEdge)
 }
 for(const b of d.buildings){
  const footprint=buildingFootprint(b).map(v=>({...v,x:v.x+b.azimuth*radius,y:v.y+b.axial}))
  for(const p of places.slice(0,2))expect(polygonArea(intersectStreetPolygons(footprint,p.footprint.map(([x,y])=>({x,y,u:0,v:0}))))).toBeLessThan(1e-5)
 }
 for(const r of c.roads){
  const vertical=r.axialLength>r.tangentWidth,x=r.azimuth*radius,y=r.axial,h=(vertical?r.axialLength:r.tangentWidth)/2,b=ARRIVAL_CORE
  expect(vertical?x>b.x0+1e-5&&x<b.x1-1e-5&&y+h>b.y0+1e-5&&y-h<b.y1-1e-5:y>b.y0+1e-5&&y<b.y1-1e-5&&x+h>b.x0+1e-5&&x-h<b.x1-1e-5).toBe(false)
 }
 c.streetSurfaces=new StreetSurfacePlan(c.streetNetwork!.streets,radius,isArrivalStreet);c.streetMarkings=new StreetMarkingPlan(c.streetNetwork!)
 const w=c.entranceWalks!.find(w=>w.id==='arrival-park')!
 expect(w.length).toBeCloseTo(11.52,5);expect(w.width).toBe(2.2);expect(w.maximumGrade).toBeLessThan(.06)
 for(let i=1;i<10;i++){
  const x=w.length*i/10,cost=new Uint8Array(1)
  expect(sampleCitySurface(w.surfaceMesh,x,0)).toBeGreaterThan(.14)
  paintDistrictFootways(c,radius,{startAzimuth:w.source.azimuth,startAxial:w.source.axial,minX:x,minY:0,nx:1,ny:1,step:.5,cost})
  expect(cost[0]).toBe(1)
 }
 const start={azimuth:blocks.blocks[0].building.access.entrance.azimuth,axial:12.75}
 for(const place of places.slice(0,2))for(const reverse of [false,true]){
  const [x,y]=place.walkingEntrances[0].point,goal={azimuth:x/radius,axial:y}
  expect(planNeighborhoodRoute(c,radius,reverse?goal:start,reverse?start:goal,false,c.places!.park,c.places!.covered)).not.toBeNull()
 }
 expect(planNeighborhoodRoute(c,radius,{azimuth:50/radius,axial:0},{azimuth:-100/radius,axial:-313},true)).not.toBeNull()
 expect(()=>rebuildArrivalCore(c,radius,40000)).toThrow('already applied')
 expect(rebuildArrivalCore(c,3000,40000)).toBeNull()
},30000)
