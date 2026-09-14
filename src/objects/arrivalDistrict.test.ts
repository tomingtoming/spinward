import {expect,test} from 'bun:test'
import snapshot from '../../assets/planning/band-roads.json'
import {proposedBandLand} from './bandLand'
import {proposedBandExpressway} from './bandExpresswayLand'
import {planBandTransport} from './bandExpressway'
import {prepareBandStreetGeometry} from './bandStreetGeometry'
import {planCity} from './cityLayout'
import {rebuildNativeDistricts} from './nativeDistricts'
import {ARRIVAL_WEST,ARRIVAL_WEST_ID,rebuildArrivalWest,clipArrivalRoad} from './arrivalDistrict'
import {captureBandPublicPlaces} from './bandPublicPlaces'
import {DistrictTrafficPath} from './districtTraffic'
import {sampleStreetPath} from './streetPath'
import {StreetSurfacePlan} from './streetSurfacePlan'
import {StreetMarkingPlan} from './streetMarkings'
import {planNeighborhoodRoute} from '../app/neighborhoodRoute'
import {paintDistrictFootways} from '../app/streetRouteGrid'
import {StreetNetwork} from './streetNetwork'
import type {StreetPath} from './streetPath'

test('runtime road snapshot is generated from the complete land and transport plan',()=>{
  const plan=planBandTransport(proposedBandLand(),proposedBandExpressway())
  const geometry=prepareBandStreetGeometry(plan.surface)
  expect(geometry.roads).toEqual(snapshot.roads)
  expect(geometry.remaining).toEqual({sharp:[],short:[]})
},30000)

test('arrival perimeter clips rather than bending whole-band roads',()=>{
  const b=ARRIVAL_WEST,y=(b.y0+b.y1)/2
  expect(clipArrivalRoad([b.x0-100,y],[b.x1+100,y])).toEqual([[b.x0,y],[b.x1,y]])
  expect(clipArrivalRoad([b.x0-100,y],[b.x0-1,y])).toBeNull()
  expect(clipArrivalRoad([b.x0+100,y-20],[b.x0+150,y+20])).toEqual([[b.x0+100,y-20],[b.x0+150,y+20]])
})

test('foot guidance includes the visible bevel outside a bent street and excludes its road corner',()=>{
  const path=(id:string,from:[number,number],to:[number,number]):StreetPath=>{
    const tangent:[number,number]=[to[0]-from[0],to[1]-from[1]]
    return{id,azimuth:0,axial:0,width:12,kind:'collector',level:0,groundHeight:0,knots:[{point:from,tangent},{point:to,tangent}]}
  }
  const streets=[path('a',[-30,0],[0,0]),path('b',[0,0],[0,30])],network=new StreetNetwork(streets,3200)
  const surface=new StreetSurfacePlan(streets,3200,true)
  const district={id:'bend',band:0,character:'mixed' as const,azimuth:0,axial:0,width:100,length:100,streets,buildings:[],replacedBuildings:0,replacedRoads:0}
  const city={roads:[],buildings:[],trees:[],patches:[],intersections:[],tower:null,expressway:null,streetNetwork:network,nativeDistricts:[district]}
  const probe=(x:number,y:number)=>{
    const cost=new Uint8Array(1)
    paintDistrictFootways(city,3200,{startAzimuth:0,startAxial:0,minX:x,minY:y,nx:1,ny:1,step:.5,cost})
    return cost[0]
  }
  expect(probe(4,-4)).toBe(0) // A deliberate gap in independent raw ribbons.
  city.nativeDistricts=[{...district,...{surfaces:{carriageways:surface.roadSurfaces(),sidewalks:surface.sidewalks()}}}]
  expect(probe(4,-4)).toBe(1)
  expect(probe(2,-2)).toBe(0)
})

for(const maxBuildings of [16000,18000,64000])test(`arrival west applies the independent roads and retains living places at ${maxBuildings}`,()=>{
  const city=planCity({radius:3200,length:40000,maxBuildings});rebuildNativeDistricts(city,3200)
  const before=captureBandPublicPlaces(city,3200),total=city.buildings.length
  const outside=city.buildings.filter(b=>b.azimuth>=0).map(b=>[b.azimuth,b.axial,b.width,b.depth,b.height,b.access?.entrance])
  const result=rebuildArrivalWest(city,3200,40000)!,d=result.district
  expect(d.streets).toHaveLength(19);expect(d.replacedRoads).toBe(46)
  expect(d.buildings.length).toBeGreaterThan(20);expect(city.buildings.length).toBeLessThanOrEqual(total)
  expect(d.buildings.every(b=>b.access?.roadId?.startsWith(ARRIVAL_WEST_ID)&&b.nativeParcel)).toBe(true)
  expect(city.buildings.filter(b=>b.azimuth>=0).map(b=>[b.azimuth,b.axial,b.width,b.depth,b.height,b.access?.entrance])).toEqual(outside)
  expect(captureBandPublicPlaces(city,3200)).toEqual(before)
  const network=city.streetNetwork!
  expect(new Set(network.components).size).toBe(3)
  expect(new Set(d.streets.map(p=>network.components[network.streets.indexOf(p)])).size).toBe(1)
  expect(d.streets.every(p=>!city.roads.some(r=>r.id===p.id))).toBe(true)
  // New traffic station descriptors are invisible: sample the moving poses
  // against their actual centreline, including both directions and end points.
  for(const source of result.traffic){
    const route=new DistrictTrafficPath(source,3200),a=route.stations[0],b=route.stations.at(-1)!
    for(const t of [0,.1,.5,.9,1])for(const direction of [-1,1] as const){
      const expected=sampleStreetPath(source.path,t,2),actual=route.sample(a+(b-a)*t,2,direction)
      expect(Math.hypot(actual.azimuth*3200-expected.x,actual.axial-expected.y)).toBeLessThan(1e-6)
      expect(actual.stationRate).toBeGreaterThan(.7)
    }
  }
  if(maxBuildings===16000){
    city.streetSurfaces=new StreetSurfacePlan(network.streets,3200,p=>p.id.startsWith(ARRIVAL_WEST_ID))
    city.streetMarkings=new StreetMarkingPlan(network)
    const p=d.streets.find(p=>p.knots[0].point[0]<-890&&p.knots[0].point[1]<-400&&p.knots[1].point[1]>-200)!
    const near=sampleStreetPath(p,.45,8),far=sampleStreetPath(p,.65,8)
    const walk=planNeighborhoodRoute(city,3200,{azimuth:near.x/3200,axial:near.y},{azimuth:far.x/3200,axial:far.y},false)
    expect(walk).not.toBeNull();expect(walk!.length).toBeGreaterThan(2)
    const lane=sampleStreetPath(p,.45)
    const drive=planNeighborhoodRoute(city,3200,{azimuth:lane.x/3200,axial:lane.y},{azimuth:-400/3200,axial:0},true)
    expect(drive).not.toBeNull()
  }
  expect(()=>rebuildArrivalWest(city,3200,40000)).toThrow('already applied')
  expect(rebuildArrivalWest(city,3000,40000)).toBeNull()
  expect(rebuildArrivalWest(city,3200,20000)).toBeNull()
},30000)
