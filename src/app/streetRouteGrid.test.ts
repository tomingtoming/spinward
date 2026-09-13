import { expect, test } from 'bun:test'
import { StreetNetwork } from '../objects/streetNetwork'
import { type StreetPath } from '../objects/streetPath'
import { planCity, buildCityCollisionIndex, getCityGroundHeight, type CityPlan } from '../objects/cityLayout'
import { planCurvedNeighborhood, curvedStreetPoint } from '../objects/curvedNeighborhood'
import { planNeighborhoodRoute, surfaceDistance } from './neighborhoodRoute'
import { isDrivingStreetPoint } from './streetRouteGrid'
const r=3200
const empty:CityPlan={roads:[],buildings:[],patches:[],trees:[],intersections:[],tower:null,expressway:null}
const point=(x:number,y:number)=>({azimuth:x/r,axial:y})
test('short dead ends and nearby pavements cannot become drivable through snapping',()=>{
  const make=(length:number):StreetPath=>({id:'end',azimuth:0,axial:0,kind:'local',width:6,level:0,groundHeight:0,
    knots:[{point:[0,0],tangent:[length,0]},{point:[length,0],tangent:[length,0]}]})
  const short=new StreetNetwork([make(1)],r)
  for(const x of [-.5,0,.5,1,1.5])expect(isDrivingStreetPoint(short,x/r,0)).toBe(false)
  const long=new StreetNetwork([make(40)],r)
  expect(isDrivingStreetPoint(long,20/r,0)).toBe(true)
  expect(isDrivingStreetPoint(long,20/r,2)).toBe(false)
  expect(isDrivingStreetPoint(long,20/r,4)).toBe(false)
  expect(planNeighborhoodRoute({...empty,streetNetwork:long},r,point(10,4),point(30,0),true)).toBeNull()
})
test('driving directions follow native diagonal streets and respect disconnected decks',()=>{
  const make=(level:number):StreetPath=>({id:'diagonal',azimuth:0,axial:0,kind:'local',width:6,groundHeight:0,level,
    knots:[{point:[-40,-20],tangent:[80,40]},{point:[40,20],tangent:[80,40]}]})
  const plan={...empty,streetNetwork:new StreetNetwork([make(0)],r)}
  const route=planNeighborhoodRoute(plan,r,point(-30,-15),point(30,15),true)!
  expect(route).not.toBeNull()
  for(const p of route)expect(Math.abs(p.azimuth*r/2-p.axial)/Math.hypot(1,.5)).toBeLessThan(1.91)
  expect(planNeighborhoodRoute({...plan,streetNetwork:new StreetNetwork([make(1)],r)},r,point(-30,-15),point(30,15),true)).toBeNull()
})
test('driving routes traverse the supported curved carriageway and both real avenue mouths',()=>{
  for(const maxBuildings of [16000,18000,64000]){
    const city=planCity({radius:r,length:40000,maxBuildings}),p=planCurvedNeighborhood(city,r)!
    const index=buildCityCollisionIndex(p.colliders,r,40000)
    const world=(t:number)=>{const v=curvedStreetPoint(p,t);return{azimuth:p.azimuth+v.x/r,axial:p.axial+v.y}}
    for(const [a,b] of [[.1,.9],[.9,.1]]){
      const route=planNeighborhoodRoute(city,r,world(a),world(b),true,null,null,null,[],p)!
      expect(route).not.toBeNull()
      const length=route.reduce((n,q,i)=>n+(i?surfaceDistance(route[i-1],q,r):0),0)
      expect(length).toBeGreaterThan(180);expect(length).toBeLessThan(300)
      for(let i=1;i<route.length;i++)for(let f=0;f<=1;f+=.1){
        const azimuth=route[i-1].azimuth+(route[i].azimuth-route[i-1].azimuth)*f,axial=route[i-1].axial+(route[i].axial-route[i-1].axial)*f
        expect(getCityGroundHeight(index,r,azimuth,axial,.2,.05)).toBeCloseTo(.2,2)
      }
      expect(route.some(v=>v.groundHeight!==undefined&&Math.abs(v.groundHeight-.2)<1e-6)).toBe(true)
    }
    for(const link of p.streetLinks){
      const v=link.knots[0].point,outside={azimuth:link.azimuth+v[0]/r,axial:link.axial+v[1]}
      expect(planNeighborhoodRoute(city,r,world(.5),outside,true,null,null,null,[],p)).not.toBeNull()
      expect(planNeighborhoodRoute(city,r,outside,world(.5),true,null,null,null,[],p)).not.toBeNull()
    }
  }
})
