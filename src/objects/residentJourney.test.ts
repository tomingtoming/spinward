import {test,expect} from 'bun:test'
import {planCity} from './cityLayout'
import {planLifeCrossing} from './neighborhoodLife'
import {planResidentJourney,stepJourney} from './residentJourney'
import {planNeighborhoodTurn,sampleNeighborhoodTurn,TURN_APPROACH,TURN_ARC,junctionMajorBusy} from './neighborhoodTurn'
for(const maxBuildings of [64000,16000])test(`cafe journey clears solid furnishings and joins a real junction (${maxBuildings})`,()=>{
 const radius=3200,p=planCity({radius,length:40000,maxBuildings}),c=planLifeCrossing(p,radius)!,j=planResidentJourney(p,radius,c)!
 expect(j).not.toBeNull();expect(j.seat.id).toBe('cafe-1')
 for(let n=2;n<j.points.length-1;n++){
  let point=j.points[n]
  for(let steps=0;steps<1000;steps++){
   const next=stepJourney(point,j.points[n+1],radius,.1);point=next.point
   const x=(point.azimuth-j.room.building.azimuth)*radius,z=j.room.building.axial-point.axial
   for(const part of j.room.parts.filter(p=>p.solid&&p.y-p.height/2<1.7&&p.y+p.height/2>.35))
    expect(Math.abs(x-part.x)>part.width/2+.25||Math.abs(z-part.z)>part.depth/2+.25).toBe(true)
   if(next.arrived)break
  }
 }
 const turn=planNeighborhoodTurn(p,radius,c)!
 expect(turn).not.toBeNull()
 const a=sampleNeighborhoodTurn(turn,TURN_APPROACH-.001),b=sampleNeighborhoodTurn(turn,TURN_APPROACH+.001)
 expect(Math.hypot((a.azimuth-b.azimuth)*radius,a.axial-b.axial)).toBeLessThan(.003)
 const exit=sampleNeighborhoodTurn(turn,TURN_APPROACH+TURN_ARC)
 expect(exit.heading).toBeCloseTo(-Math.PI/2)
 expect(exit.axial).toBeCloseTo(c.axial-1.5)
 expect(junctionMajorBusy(turn,[{azimuth:turn.azimuth,axial:turn.axial+15,speed:6,height:.2}])).toBe(true)
 expect(junctionMajorBusy(turn,[{azimuth:turn.azimuth,axial:turn.axial+15,speed:6,height:10}])).toBe(false)
})
test('journey steps across the angular seam without taking a lap',()=>{
 const s=stepJourney({azimuth:Math.PI-.001,axial:0,height:.2},{azimuth:-Math.PI+.001,axial:0,height:.3},3200,1)
 expect(s.point.azimuth).toBeCloseTo(Math.PI-.001+1/3200)
 expect(s.arrived).toBe(false)
})

test('turn remains stopped at the priority line until the major road clears',async()=>{
 const {turnYieldGap}=await import('./neighborhoodTurn'),{advanceTraffic}=await import('./trafficMotion')
 let state={progress:85,speed:6}
 for(let n=0;n<600;n++)state=advanceTraffic(state,.016,6,turnYieldGap(state.progress,true))
 expect(state.progress).toBeCloseTo(TURN_APPROACH,5);expect(state.speed).toBe(0)
 for(let n=0;n<120;n++)state=advanceTraffic(state,.016,6,turnYieldGap(state.progress,false))
 expect(state.progress).toBeGreaterThan(TURN_APPROACH+2)
})
