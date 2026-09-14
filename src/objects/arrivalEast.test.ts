import {expect,test} from 'bun:test'
import {planCity} from './cityLayout'
import {rebuildNativeDistricts} from './nativeDistricts'
import {rebuildArrivalWest,rebuildArrivalCentral,isArrivalStreet} from './arrivalDistrict'
import {rebuildArrivalCore} from './arrivalCore'
import {ARRIVAL_EAST,ARRIVAL_EAST_ID,rebuildArrivalEast} from './arrivalEast'
import {captureBandPublicPlaces} from './bandPublicPlaces'
import {StreetSurfacePlan,relativeStreetPolygon} from './streetSurfacePlan'
import {StreetMarkingPlan} from './streetMarkings'
import {StreetNetwork} from './streetNetwork'
import {buildingFootprint} from './streetFrontage'
import {intersectStreetPolygons,polygonArea} from './streetPolygon'
import {sampleCitySurface} from './citySurfaceMesh'
import {planNeighborhoodRoute} from '../app/neighborhoodRoute'
import cafe from '../../assets/blender/cafe-pilot.json'
import lobby from '../../assets/blender/lobby-pilot.json'
import apartment from '../../assets/blender/nyaan-apartment.json'
import shops from '../../assets/blender/neighborhood-fronts.json'
import blocks from '../../assets/blender/city-block.json'

for(const maxBuildings of [16000,18000,64000])test(`eastern living places keep their doors and join the band roads at ${maxBuildings}`,()=>{
  const radius=3200,c=planCity({radius,length:40000,maxBuildings})
  rebuildNativeDistricts(c,radius);rebuildArrivalWest(c,radius,40000);rebuildArrivalCentral(c,radius,40000);rebuildArrivalCore(c,radius,40000)
  const places=captureBandPublicPlaces(c,radius),garden=structuredClone(c.places!.garden),count=c.buildings.length
  const contracts=[cafe.interior.building,lobby.interior.building,apartment.interior.building,shops.building,...blocks.blocks.map(b=>b.building)]
  const protectedBuildings=contracts.map(b=>c.buildings.find(p=>Math.abs(b.azimuth-p.azimuth)<1e-9&&Math.abs(b.axial-p.axial)<1e-6)).filter(b=>b!==undefined)
  const d=rebuildArrivalEast(c,radius,40000)!.district
  expect(d.id).toBe(ARRIVAL_EAST_ID);expect(d.replacedRoads).toBeGreaterThan(15);expect(d.buildings.length).toBeGreaterThan(0)
  expect(c.nativeDistricts).toHaveLength(16);expect(c.buildings.length).toBeLessThanOrEqual(count)
  expect(new Set(c.streetNetwork!.components).size).toBe(3)
  const districtNetwork=new StreetNetwork(d.streets,radius)
  const destinations=['civic-frontage','shop-frontage','band-0','band-2'].map(id=>districtNetwork.components[d.streets.findIndex(s=>s.id===`${ARRIVAL_EAST_ID}:${id}`)])
  expect(destinations.every(v=>v!==undefined&&v===destinations[0])).toBe(true)
  expect(captureBandPublicPlaces(c,radius)).toEqual(places);expect(c.places!.garden).toEqual(garden)
  expect(protectedBuildings).toHaveLength(maxBuildings===64000?7:6)
  for(const b of protectedBuildings){
    const kept=c.buildings.find(p=>p.azimuth===b.azimuth&&p.axial===b.axial)!
    expect({...kept,access:undefined}).toEqual({...b,access:undefined})
    expect(kept.access?.entrance).toEqual(b.access?.entrance)
  }
  for(const r of c.roads){
    const vertical=r.axialLength>r.tangentWidth,x=r.azimuth*radius,y=r.axial,h=(vertical?r.axialLength:r.tangentWidth)/2,b=ARRIVAL_EAST
    expect(vertical?x>b.x0+1e-5&&x<b.x1-1e-5&&y+h>b.y0+1e-5&&y-h<b.y1-1e-5:y>b.y0+1e-5&&y<b.y1-1e-5&&x+h>b.x0+1e-5&&x-h<b.x1-1e-5).toBe(false)
  }
  c.streetSurfaces=new StreetSurfacePlan(c.streetNetwork!.streets,radius,isArrivalStreet);c.streetMarkings=new StreetMarkingPlan(c.streetNetwork!)
  const nearby=c.streetSurfaces.roadSurfaces().filter(s=>s.source.id.startsWith(ARRIVAL_EAST_ID))
  for(const b of protectedBuildings)for(const s of nearby)expect(polygonArea(intersectStreetPolygons(buildingFootprint(b),relativeStreetPolygon(s,b,radius)))).toBeLessThan(1e-5)
  const square=places.find(p=>p.id==='square')!.walkingEntrances[0].point
  const walks=c.entranceWalks!.filter(w=>w.id==='arrival-cafe'||w.id==='arrival-apartment')
  expect(walks).toHaveLength(2)
  for(const w of walks){
    expect(w.width).toBe(2);expect(w.length).toBeCloseTo(7.25,5);expect(w.maximumGrade).toBeLessThan(.06)
    for(const t of [.1,.5,.9])expect(sampleCitySurface(w.surfaceMesh,0,-w.length*t)).toBeCloseTo(.12+.2*t,5)
    const b=c.buildings.find(b=>b.access?.entrance.azimuth===w.source.azimuth&&b.access?.entrance.axial===w.source.axial)!
    expect(b.access!.roadId.startsWith(`${ARRIVAL_EAST_ID}:`)).toBe(true)
    for(const goal of [walks.find(p=>p!==w)!.source,{azimuth:339.7/radius,axial:-281},{azimuth:square[0]/radius,axial:square[1]}])for(const reverse of [false,true])
      expect(planNeighborhoodRoute(c,radius,reverse?goal:w.source,reverse?w.source:goal,false,c.places!.park,c.places!.covered)).not.toBeNull()
  }
  expect(()=>rebuildArrivalEast(c,radius,40000)).toThrow();expect(rebuildArrivalEast(c,3000,40000)).toBeNull()
},30000)
