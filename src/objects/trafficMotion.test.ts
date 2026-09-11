import { test, expect } from 'bun:test'
import { advanceTraffic, crossingGap } from './trafficMotion'
test('traffic stops with a bumper margin and resumes without a time jump',()=>{
 let s={progress:0,speed:12}
 for(let i=0;i<600;i++)s=advanceTraffic(s,1/60,12,35-s.progress)
 expect(s.progress).toBeLessThanOrEqual(31.8);expect(s.progress).toBeGreaterThan(31);expect(s.speed).toBeLessThan(.05)
 const resumed=advanceTraffic(s,1/60,12)
 expect(resumed.progress-s.progress).toBeLessThan(.01)
 expect(resumed.speed).toBeGreaterThan(0)
})
test('crossing uses travel direction, lane width and wrapped cylinder coordinates',()=>{
 const gate={axis:'tangent' as const,azimuth:-Math.PI+.001,axial:4,halfWidth:4,closed:true}
 expect(crossingGap(gate,3200,'street',Math.PI-.002,4,1)).toBeCloseTo(7.6)
 expect(crossingGap(gate,3200,'street',Math.PI-.002,4,-1)).toBe(Infinity)
 expect(crossingGap(gate,3200,'street',Math.PI-.002,40,1)).toBe(Infinity)
 expect(crossingGap({...gate,closed:false},3200,'street',Math.PI-.002,4,1)).toBe(Infinity)
})
