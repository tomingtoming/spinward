import {expect,test} from 'bun:test'
import {planCity} from './cityLayout'
import {rebuildNativeDistricts} from './nativeDistricts'
import {rebuildArrivalWest,rebuildArrivalCentral,isArrivalStreet,clipArrivalRoad} from './arrivalDistrict'
import {rebuildArrivalCore} from './arrivalCore'
import {rebuildArrivalEast} from './arrivalEast'
import {retireArrivalSeams,joinedArrivalTraffic} from './arrivalSeams'
import {connectArrivalLocalStreets} from './arrivalLocalLinks'
import {populateArrivalLocalStreets} from './arrivalInfill'
import {rebuildArrivalSouthernCorridor,ARRIVAL_SOUTHERN_CORRIDOR as bounds,ARRIVAL_SOUTHERN_CORRIDOR_ID as id,arrivalSouthernReserves} from './arrivalSouthernCorridor'
import {captureBandPublicPlaces} from './bandPublicPlaces'
import {buildingFootprint,certifyStreetAccess} from './streetFrontage'
import {StreetNetwork} from './streetNetwork'
import {StreetSurfacePlan} from './streetSurfacePlan'
import {StreetMarkingPlan} from './streetMarkings'
import {StreetSignalPlan} from './streetSignals'
import {planDistrictTraffic} from './districtTraffic'
import {intersectStreetPolygons,polygonArea} from './streetPolygon'
import {planNeighborhoodRoute,surfaceDistance} from '../app/neighborhoodRoute'
import {isDrivingStreetPoint,paintDistrictFootways} from '../app/streetRouteGrid'
import snapshot from '../../assets/planning/band-roads.json'
import type {BandPoint} from './bandStreetPlan'

const radius=3200,inside=(x:number,y:number)=>x>bounds.x0+1e-5&&x<bounds.x1-1e-5&&y>bounds.y0+1e-5&&y<bounds.y1-1e-5
let roadGeometry:string|undefined
for(const maxBuildings of [16000,18000,64000])test(`southern corridor reaches the next band centre and retains inhabited arrival at ${maxBuildings}`,()=>{
  const c=planCity({radius,length:40000,maxBuildings})
  rebuildNativeDistricts(c,radius);rebuildArrivalWest(c,radius,40000);rebuildArrivalCentral(c,radius,40000)
  rebuildArrivalCore(c,radius,40000);rebuildArrivalEast(c,radius,40000);retireArrivalSeams(c,radius)
  connectArrivalLocalStreets(c,radius);populateArrivalLocalStreets(c,radius,maxBuildings)
  const total=c.buildings.length,kept=c.buildings.filter(b=>!inside(b.azimuth*radius,b.axial)),places=captureBandPublicPlaces(c,radius),walks=c.entranceWalks
  const previous=c.nativeDistricts!.map(d=>({id:d.id,streets:JSON.stringify(d.streets),land:JSON.stringify(d.land),infill:JSON.stringify(d.infill)}))
  const result=rebuildArrivalSouthernCorridor(c,radius,40000)!,d=result.district,n=c.streetNetwork!
  expect(c.nativeDistricts).toHaveLength(17);expect(d.streets).toHaveLength(35);expect(d.replacedRoads).toBe(145)
  expect(d.buildings.length).toBeGreaterThan(300);expect(c.buildings.length).toBeLessThanOrEqual(total)
  expect(result.seams.retiredPieces).toBe(2);expect(result.seams.retiredLength).toBeCloseTo(bounds.x1-bounds.x0,6)
  expect(captureBandPublicPlaces(c,radius)).toEqual(places);expect(c.entranceWalks).toBe(walks)
  const byPosition=new Map(c.buildings.map(b=>[`${b.azimuth}:${b.axial}`,b]))
  for(const b of kept){
    const now=byPosition.get(`${b.azimuth}:${b.axial}`)!
    expect({...now,access:undefined}).toEqual({...b,access:undefined});expect(now.access?.entrance).toEqual(b.access?.entrance)
  }
  for(const old of previous){
    const now=c.nativeDistricts!.find(d=>d.id===old.id)!
    expect(JSON.stringify(now.streets)).toBe(old.streets);expect(JSON.stringify(now.land)).toBe(old.land);expect(JSON.stringify(now.infill)).toBe(old.infill)
  }
  const geometry=JSON.stringify(d.streets)
  if(roadGeometry)expect(geometry).toBe(roadGeometry);else roadGeometry=geometry
  for(const p of d.streets){
    const source=snapshot.roads[Number(p.id.split(':band-')[1])]
    expect(source.bridge??source.underpass).toBeUndefined()
    expect(p.knots.map(k=>k.point)).toEqual(clipArrivalRoad(source.from as BandPoint,source.to as BandPoint,bounds))
  }
  const arrival=new StreetNetwork(n.streets.filter(isArrivalStreet),radius)
  expect(new Set(n.components).size).toBe(3)
  const at=(suffix:string)=>{const i=arrival.streets.findIndex(p=>p.id===suffix);expect(i).toBeGreaterThanOrEqual(0);return arrival.components[i]}
  expect(at(`${id}:band-13`)).toBe(at('district-arrival-core:band-8'))
  for(const r of c.roads){
    const vertical=r.axialLength>r.tangentWidth,x=Math.atan2(Math.sin(r.azimuth),Math.cos(r.azimuth))*radius,y=r.axial
    const a=vertical?y:x,half=(vertical?r.axialLength:r.tangentWidth)/2
    expect(vertical?x>bounds.x0+1e-5&&x<bounds.x1-1e-5&&a+half>bounds.y0+1e-5&&a-half<bounds.y1-1e-5:
      y>bounds.y0+1e-5&&y<bounds.y1+1e-5&&a+half>bounds.x0+1e-5&&a-half<bounds.x1-1e-5).toBe(false)
  }
  const reserves=arrivalSouthernReserves()
  expect(reserves.length).toBeGreaterThan(0)
  for(const b of d.buildings){
    expect(b.access?.roadId.startsWith(id+':')).toBe(true)
    const poly=buildingFootprint(b).map(v=>({...v,x:v.x+b.azimuth*radius,y:v.y+b.axial}))
    for(const reserve of reserves)expect(polygonArea(intersectStreetPolygons(poly,reserve))).toBeLessThan(1e-5)
  }
  expect(certifyStreetAccess(c.buildings,n,radius,6).rejected.filter(r=>r.building.nativeDistrict===id)).toEqual([])
  expect(c.buildings.every(b=>b.access&&n.streets[b.access.roadIndex]?.id===b.access.roadId)).toBe(true)
  c.streetSurfaces=new StreetSurfacePlan(n.streets,radius,isArrivalStreet);c.streetMarkings=new StreetMarkingPlan(n)
  const traffic=planDistrictTraffic(joinedArrivalTraffic(c,radius),radius,new StreetSignalPlan(c.streetMarkings,c.intersections))
  const crossing=[...traffic.values()].filter(r=>r.pieces.some(p=>p.source.path.id.startsWith(id+':'))&&r.pieces.some(p=>!p.source.path.id.startsWith(id+':')))
  expect(crossing.length).toBeGreaterThan(0)
  for(const r of crossing)for(let i=1;i<r.pieces.length;i++){
    const s=r.pieces[i].stations[0]
    const a=r.sample(s-.001,1.5,1),b=r.sample(s+.001,1.5,1)
    expect(surfaceDistance(a,b,radius)).toBeLessThan(.01)
    expect(isDrivingStreetPoint(n,a.azimuth,a.axial)&&isDrivingStreetPoint(n,b.azimuth,b.axial)).toBe(true)
  }
  if(maxBuildings===18000){
    const p=d.streets.find(p=>p.knots.some(k=>Math.abs(k.point[1]-bounds.y1)<1e-5)&&p.kind==='arterial')!,a=p.knots[0].point,b=p.knots[1].point
    const dx=b[0]-a[0],dy=b[1]-a[1],length=Math.hypot(dx,dy),x=a[0]+(bounds.y1-a[1])*dx/dy,offset=p.width/2+1.5
    const point=(s:number)=>({azimuth:(x+s*dx/length-offset*dy/length)/radius,axial:bounds.y1+s*dy/length+offset*dx/length})
    for(const s of [-30,-1,0,1,30]){
      const q=point(s),cost=new Uint8Array(1)
      paintDistrictFootways(c,radius,{startAzimuth:0,startAxial:0,minX:q.azimuth*radius,minY:q.axial,nx:1,ny:1,step:.5,cost})
      expect(cost[0]).toBe(1)
    }
    for(const [start,goal] of [[point(-30),point(30)],[point(30),point(-30)]]){
      const route=planNeighborhoodRoute(c,radius,start,goal,false,c.places!.park,c.places!.covered)!
      expect(route).not.toBeNull();expect(route[0]).toEqual(start);expect(route.at(-1)).toEqual(goal)
    }
  }
  expect(()=>rebuildArrivalSouthernCorridor(c,radius,40000)).toThrow('already applied')
  expect(rebuildArrivalSouthernCorridor(c,3000,40000)).toBeNull()
},60000)
