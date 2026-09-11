import { test, expect } from 'bun:test'
import { advanceTraffic, crossingGap, fillLaneLeaderGaps } from './trafficMotion'
test('traffic stops with a bumper margin and resumes without a time jump',()=>{
 let s={progress:0,speed:12}
 for(let i=0;i<600;i++)s=advanceTraffic(s,1/60,12,35-s.progress)
 expect(s.progress).toBeLessThanOrEqual(31.8);expect(s.progress).toBeGreaterThan(31);expect(s.speed).toBeLessThan(.05)
 const resumed=advanceTraffic(s,1/60,12)
 expect(resumed.progress-s.progress).toBeLessThan(.01)
 expect(resumed.speed).toBeGreaterThan(0)
})

test('a repeating lane keeps a safe queue across its boundary and releases without a teleport overlap',()=>{
 const period=100,mod=(x:number)=>(x%period+period)%period
 let cars=[{progress:8,speed:0},{progress:80,speed:12}]
 let minimum=Infinity
 for(let frame=0;frame<1500;frame++){
  const gaps=new Map<number,number>()
  fillLaneLeaderGaps(cars.map((car,index)=>({index,along:mod(car.progress)})),period,gaps)
  cars=cars.map((car,index)=>advanceTraffic(car,1/60,index===0&&frame<300?0:12,gaps.get(index)))
  const separation=mod(cars[0].progress-cars[1].progress)
  minimum=Math.min(minimum,separation,period-separation)
  if(frame===299){expect(cars[1].progress).toBeLessThan(103);expect(cars[1].speed).toBeLessThan(.01)}
 }
 expect(minimum).toBeGreaterThanOrEqual(5.19)
 expect(cars.every(car=>car.progress>200)).toBe(true)
 const single=new Map<number,number>();fillLaneLeaderGaps([{index:0,along:5}],period,single)
 expect(single.size).toBe(0)
})
test('crossing uses travel direction, lane width and wrapped cylinder coordinates',()=>{
 const gate={axis:'tangent' as const,azimuth:-Math.PI+.001,axial:4,halfWidth:4,closed:true}
 expect(crossingGap(gate,3200,'street',Math.PI-.002,4,1)).toBeCloseTo(7.6)
 expect(crossingGap(gate,3200,'street',Math.PI-.002,4,-1)).toBe(Infinity)
 expect(crossingGap(gate,3200,'street',Math.PI-.002,40,1)).toBe(Infinity)
 expect(crossingGap({...gate,closed:false},3200,'street',Math.PI-.002,4,1)).toBe(Infinity)
})
