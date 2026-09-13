import {expect,test} from 'bun:test'
import {planCity,buildCityCollisionIndex,getCityGroundHeight} from '../objects/cityLayout'
import {planCurvedNeighborhood,curvedStreetPoint} from '../objects/curvedNeighborhood'
import {planSidewalkSegments} from '../objects/sidewalks'
import {planRiverDistrict} from '../objects/riverDistrictPlan'
import {curvedWalkPaths,curvedLocalRoute} from './curvedWalkRoute'
import {planNeighborhoodRoute,surfaceDistance,NeighborhoodJourney} from './neighborhoodRoute'
const radius=3200,length=40000
for(const maxBuildings of [16000,18000,64000])test(`garden footways and four street mouths have physical support at ${maxBuildings}`,()=>{
 const city=planCity({radius,length,maxBuildings}),p=planCurvedNeighborhood(city,radius)!,paths=curvedWalkPaths(p,radius)
 const index=buildCityCollisionIndex(p.colliders,radius,length)
 expect(curvedWalkPaths(p,radius)).toBe(paths);expect(paths).toHaveLength(2)
 expect(paths.flat().length).toBeLessThan(450)
 const walks=planSidewalkSegments(city.roads,city.intersections,radius,3,()=>false,p.sidewalkCuts)
 for(const path of paths){
  for(const endpoint of [path[0],path.at(-1)!]){
   expect(endpoint.groundHeight).toBe(0)
   expect(walks.some(s=>Math.abs((endpoint.azimuth-s.azimuth)*radius)<s.tangentExtent/2-.35&&Math.abs(endpoint.axial-s.axial)<s.axialExtent/2-.35)).toBe(true)
  }
  for(let i=1;i<path.length;i++){
   const a=path[i-1],b=path[i],count=Math.ceil(surfaceDistance(a,b,radius)/.15)
   for(let j=0;j<=count;j++){
    const t=j/count,azimuth=a.azimuth+(b.azimuth-a.azimuth)*t,axial=a.axial+(b.axial-a.axial)*t,h=a.groundHeight+(b.groundHeight-a.groundHeight)*t
    expect(Math.abs(getCityGroundHeight(index,radius,azimuth,axial,h,.15)-h)).toBeLessThan(.012)
   }
  }
  const route=curvedLocalRoute(p,radius,path[8],path.at(-9)!)!
  expect(route.length).toBeGreaterThan(150)
  const back=curvedLocalRoute(p,radius,path.at(-9)!,path[8])!
  expect(back).toEqual([...route].reverse())
 }
})
test('garden directions use the two avenue pavements and never shortcut between opposite footways',()=>{
 const city=planCity({radius,length,maxBuildings:16000}),p=planCurvedNeighborhood(city,radius)!,paths=curvedWalkPaths(p,radius)
 for(const path of paths)for(const end of [0,1]){
  const portal=end?path.at(-1)!:path[0],start={azimuth:portal.azimuth,axial:portal.axial+(path===paths[0]?-18:18),groundHeight:0}
  const goal=path[95],route=planNeighborhoodRoute(city,radius,start,goal,false,null,null,null,[],p)!
  expect(route).not.toBeNull();expect(route.some(q=>q.curvedWalk)).toBe(true)
  expect(route.some(q=>surfaceDistance(q,portal,radius)<.05)).toBe(true)
 }
 const a=paths[0][95],b=paths[1][95]
 expect(curvedLocalRoute(p,radius,a,b)).toBeNull()
 const route=planNeighborhoodRoute(city,radius,a,b,false,null,null,null,[],p)!
 expect(route).not.toBeNull()
 expect(route.reduce((n,q,i)=>n+(i?surfaceDistance(q,route[i-1],radius):0),0)).toBeGreaterThan(180)
 const road=curvedStreetPoint(p,.5),invalid={azimuth:p.azimuth+road.x/radius,axial:p.axial+road.y,groundHeight:.2}
 expect(planNeighborhoodRoute(city,radius,invalid,a,false,null,null,null,[],p)).toBeNull()
 expect(planNeighborhoodRoute(city,radius,{...a,groundHeight:20},b,false,null,null,null,[],p)).toBeNull()
 expect(planNeighborhoodRoute(city,radius,a,b,true,null,null,null,[],p)).toEqual(planNeighborhoodRoute(city,radius,a,b,true))
 const square={azimuth:13.25/radius,axial:12.25,groundHeight:0}
 const fromSquare=planNeighborhoodRoute(city,radius,square,a,false,null,null,null,[],p)!
 expect(fromSquare).not.toBeNull();expect(fromSquare.some(q=>q.crosswalk)).toBe(true)
 const river=planRiverDistrict(city,radius)!,bank={azimuth:river.azimuth+18/radius,axial:river.axial+32,groundHeight:1.2}
 const toRiver=planNeighborhoodRoute(city,radius,a,bank,false,null,null,river,[],p)!
 expect(toRiver).not.toBeNull();expect(toRiver.some(q=>q.curvedWalk)).toBe(true);expect(toRiver.some(q=>q.riverWalk==='ramp')).toBe(true)
})
test('garden guidance cannot complete by standing above its destination',()=>{
 const j=new NeighborhoodJourney(),a={azimuth:0,axial:0,groundHeight:.34,curvedWalk:true},b={...a,axial:8}
 j.setRoute([a,b],false,'Garden street');j.update({...b,groundHeight:8},radius,1)
 expect(j.status).toBe('active');j.update(b,radius,.1);expect(j.status).toBe('arrived')
})
