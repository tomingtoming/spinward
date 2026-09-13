import {expect,test} from 'bun:test'
import {sampleRoadCurve} from './roadCurve'
import {curvedStreetPoint,curvedFootwayHeight,planCurvedNeighborhood} from './curvedNeighborhood'
import {planCity,buildCityCollisionIndex,getCityGroundHeight} from './cityLayout'
import {planSidewalkSegments} from './sidewalks'
const radius=3200,length=40000,city=planCity({radius,length,maxBuildings:64000}),plan=planCurvedNeighborhood(city,radius)!
test('curved streets preserve a rotated metric normal and continuous shared-knot direction',()=>{
 const a={point:[4,9],tangent:[8,3]}as const,b={point:[9,20],tangent:[-2,10]}as const
 for(let i=0;i<=100;i++){
  const u=sampleRoadCurve({point:[...a.point],tangent:[...a.tangent]},{point:[...b.point],tangent:[...b.tangent]},i/100)
  const v=sampleRoadCurve({point:[...a.point],tangent:[...a.tangent]},{point:[...b.point],tangent:[...b.tangent]},i/100,3)
  expect(Math.hypot(v.x-u.x,v.y-u.y)).toBeCloseTo(3,10)
 }
 const x=curvedStreetPoint(plan,.5-1e-8),y=curvedStreetPoint(plan,.5+1e-8)
 expect(Math.hypot(x.x-y.x,x.y-y.y)).toBeLessThan(.0001);expect(Math.abs(x.heading-y.heading)).toBeLessThan(.00001)
})
test('a separate empty block gains nonorthogonal roads, two open connections and aligned buildings',()=>{
 expect(plan).not.toBeNull();expect(plan.buildings).toHaveLength(8)
 for(const budget of [18000,16000]){
  const other=planCurvedNeighborhood(planCity({radius,length,maxBuildings:budget}),radius)!
  expect([other.azimuth,other.axial,other.knots]).toEqual([plan.azimuth,plan.axial,plan.knots])
 }
 expect(planCurvedNeighborhood(city,250)).toBeNull()
 expect(planCurvedNeighborhood({...city,buildings:[...city.buildings,{...plan.buildings[0],azimuth:plan.azimuth,axial:plan.axial}]},radius)).toBeNull()
 const index=buildCityCollisionIndex(plan.colliders,radius,length)
 for(let i=0;i<=150;i++)for(const offset of [-4,-1.5,1.5,4]){
  const p=curvedStreetPoint(plan,i/150,offset)
  expect(getCityGroundHeight(index,radius,plan.azimuth+p.x/radius,plan.axial+p.y,.34,.1)).toBeCloseTo(Math.abs(offset)>3?curvedFootwayHeight(plan,i/150):.2,2)
 }
 expect(Math.max(...Array.from({length:100},(_,i)=>curvedStreetPoint(plan,i/100).heading))).toBeGreaterThan(.4)
 expect(plan.surfaces.reduce((n,s)=>n+s.collider.surfaceMesh!.length/9,0)).toBeLessThan(1300)
 const walks=planSidewalkSegments(city.roads,city.intersections,radius,3,()=>false,plan.sidewalkCuts)
 for(const cut of plan.sidewalkCuts)expect(walks.some(w=>Math.abs((w.azimuth-cut.azimuth)*radius)<w.tangentExtent/2&&Math.abs(w.axial-cut.axial)<w.axialExtent/2)).toBe(false)
})
