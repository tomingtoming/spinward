import {expect,test} from 'bun:test'
import {planCity} from '../objects/cityLayout'
import {rebuildNativeDistricts} from '../objects/nativeDistricts'
import {rebuildArrivalWest,rebuildArrivalCentral,isArrivalStreet} from '../objects/arrivalDistrict'
import {rebuildArrivalCore} from '../objects/arrivalCore'
import {rebuildArrivalEast} from '../objects/arrivalEast'
import {retireArrivalSeams} from '../objects/arrivalSeams'
import {connectArrivalLocalStreets} from '../objects/arrivalLocalLinks'
import {populateArrivalLocalStreets} from '../objects/arrivalInfill'
import {StreetSurfacePlan} from '../objects/streetSurfacePlan'
import {StreetMarkingPlan} from '../objects/streetMarkings'
import {captureBandPublicPlaces} from '../objects/bandPublicPlaces'
import {buildingFootprint} from '../objects/streetFrontage'
import {containsStreetPolygon} from '../objects/streetPolygon'
import {streetRibbon} from '../objects/streetPath'
import {planNeighborhoodRoute,surfaceDistance,wrapAngle,NeighborhoodJourney} from './neighborhoodRoute'

for(const maxBuildings of [16000,18000,64000])test(`arrival streets reach the square and park on real crossings at ${maxBuildings}`,()=>{
  const radius=3200,city=planCity({radius,length:40000,maxBuildings})
  rebuildNativeDistricts(city,radius);rebuildArrivalWest(city,radius,40000);rebuildArrivalCentral(city,radius,40000)
  rebuildArrivalCore(city,radius,40000)
  rebuildArrivalEast(city,radius,40000)
  retireArrivalSeams(city,radius)
  connectArrivalLocalStreets(city,radius)
  populateArrivalLocalStreets(city,radius,maxBuildings)
  city.streetSurfaces=new StreetSurfacePlan(city.streetNetwork!.streets,radius,isArrivalStreet)
  city.streetMarkings=new StreetMarkingPlan(city.streetNetwork!)
  const places=captureBandPublicPlaces(city,radius).slice(0,2),park=city.places!.park,covered=city.places!.covered
  const start={azimuth:-857.7680744967984/radius,axial:-292.73692295435166}
  const absolute=(p:{azimuth:number;axial:number},poly:{x:number;y:number}[])=>poly.map(v=>({x:v.x+p.azimuth*radius,y:v.y+p.axial}))
  const majors=city.streetNetwork!.query(-400/radius,0,2200,2000).flatMap(s=>{
    const p=city.streetNetwork!.streets[s.street]
    return p.kind==='arterial'||p.kind==='collector'?[absolute(p,streetRibbon(p,s.start.t,s.end.t,-p.width/2+.15,p.width/2-.15))]:[]
  })
  const stripes=city.streetMarkings.crossings(-400/radius,0,1600).map(c=>absolute(c.source,streetRibbon(c.source,c.start,c.end,-c.source.width/2-5,c.source.width/2+5)))
  const obstacles=city.buildings.filter(b=>Math.abs(b.azimuth*radius+400)<1100&&Math.abs(b.axial)<1000).map(b=>absolute(b,buildingFootprint(b)))
  const outwardLengths=new Map<string,number>()
  for(const place of places)for(const phase of [0,.37])for(const reverse of [false,true]){
    const door=place.walkingEntrances[0],goal={azimuth:door.point[0]/radius,axial:door.point[1]},near={...start,axial:start.axial+phase}
    const [a,b]=reverse?[goal,near]:[near,goal]
    const route=planNeighborhoodRoute(city,radius,a,b,false,park,covered)!
    expect(route).not.toBeNull();expect(route.some(p=>p.crosswalk)).toBe(true)
    expect(route[0]).toEqual(a);expect(route.at(-1)).toEqual(b)
    let unmarked=0,blocked=0,length=0
    for(let i=1;i<route.length;i++){
      const u=route[i-1],v=route[i],distance=surfaceDistance(u,v,radius);length+=distance
      for(let j=0,n=Math.max(1,Math.ceil(distance/.75));j<=n;j++){
        const t=j/n,x=(u.azimuth+wrapAngle(v.azimuth-u.azimuth)*t)*radius,y=u.axial+(v.axial-u.axial)*t
        if(majors.some(p=>containsStreetPolygon(p,x,y))&&!stripes.some(p=>containsStreetPolygon(p,x,y)))unmarked++
        if(obstacles.some(p=>containsStreetPolygon(p,x,y)))blocked++
      }
    }
    expect(unmarked).toBe(0);expect(blocked).toBe(0)
    expect(length).toBeGreaterThan(surfaceDistance(a,b,radius));expect(length).toBeLessThan(2200)
    // Retiring the perimeter changes the route, but reversing its endpoints
    // must not erase a crossing through a different raster phase.
    const key=`${place.id}:${phase}`
    if(reverse)expect(length).toBeCloseTo(outwardLengths.get(key)!,5);else outwardLengths.set(key,length)
    const journey=new NeighborhoodJourney();journey.setRoute(route,false,place.id)
    for(const p of route)journey.update({...p,groundHeight:p.groundHeight??0},radius,.1)
    expect(journey.status).toBe('arrived')
  }
  // Without crossings the retry must stay unavailable, not cross an arterial.
  const crossings=city.streetMarkings;city.streetMarkings=undefined;const intersections=city.intersections;city.intersections=[]
  const door=places[0].walkingEntrances[0].point
  expect(planNeighborhoodRoute(city,radius,start,{azimuth:door[0]/radius,axial:door[1]},false,park,covered)).toBeNull()
  city.streetMarkings=crossings;city.intersections=intersections
  expect(planNeighborhoodRoute(city,radius,start,{...start,axial:start.axial+1700},false,park,covered)).toBeNull()
},30000)
