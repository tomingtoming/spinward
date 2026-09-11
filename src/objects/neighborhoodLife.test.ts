import {test,expect} from 'bun:test'
import {planCity} from './cityLayout'
import {planLifeCrossing} from './neighborhoodLife'
import {getStreetProfile} from './streetProfile'
for(const maxBuildings of [64000,18000,16000])test(`crossing binds a real road and usable pavement in the ${maxBuildings} plan`,()=>{
 const radius=3200,plan=planCity({radius,length:40000,maxBuildings})
 const crossing=planLifeCrossing(plan,radius)
 expect(crossing).not.toBeNull()
 const c=crossing!,r=c.road
 expect(plan.roads.includes(r)).toBe(true)
 expect(getStreetProfile(r.kind,radius).sidewalk).toBeGreaterThanOrEqual(2)
 expect(c.halfWidth*2).toBeLessThanOrEqual(20)
 // Both pavement waiting points must be outside building footprints.
 for(const sign of [-1,1]){
  const a=c.azimuth+(c.axis==='axial'?sign*(c.halfWidth+.75)/radius:0)
  const ax=c.axial+(c.axis==='tangent'?sign*(c.halfWidth+.75):0)
  const blocked=plan.buildings.some(b=>Math.abs(Math.atan2(Math.sin(b.azimuth-a),Math.cos(b.azimuth-a))*radius)<b.width/2+.25&&Math.abs(b.axial-ax)<b.depth/2+.25)
  expect(blocked).toBe(false)
 }
})
test('tiny habitats without public rooms do not acquire a floating crossing',()=>{
 expect(planLifeCrossing(planCity({radius:18,length:120}),18)).toBeNull()
})
