import {test,expect} from 'bun:test'
import {planCity} from './cityLayout'
import {planRiverDistrict} from './riverDistrictPlan'
import {planRiverTraffic,sampleRiverTraffic,riverTrafficYieldGap,trafficFollowingGap} from './riverTraffic'
import {sampleCitySurface} from './citySurfaceMesh'
import {advanceTraffic} from './trafficMotion'
const R=3200,city=planCity({radius:R,length:40000,maxBuildings:18000}),district=planRiverDistrict(city,R)!,loop=planRiverTraffic(district,city,R)!
const wrap=(a:number)=>Math.atan2(Math.sin(a),Math.cos(a))

test('riverside traffic forms the same road-supported closed circuit across city budgets',()=>{
  expect(loop).not.toBeNull();expect(loop.length).toBeGreaterThan(1200);expect(loop.length).toBeLessThan(1600)
  for(const budget of [16000,64000]){
    const c=planCity({radius:R,length:40000,maxBuildings:budget}),other=planRiverTraffic(planRiverDistrict(c,R),c,R)!
    expect(other.points).toEqual(loop.points);expect(other.gates).toEqual(loop.gates)
  }
  expect(planRiverTraffic(null,city,R)).toBeNull()
  expect(planRiverTraffic(district,{...city,roads:[]},R)).toBeNull()
  const roadSurfaces=district.surfaces.filter(s=>s.material==='road').map(s=>s.collider)
  let high=0,worstSupport=0
  for(let progress=0;progress<loop.length;progress+=.29){
    const p=sampleRiverTraffic(loop,progress),x=(p.azimuth-district.azimuth)*R,y=p.axial-district.axial
    high=Math.max(high,p.height)
    // Design wheel probes (2.5m axle span, 1.36m track), across the whole route.
    for(const axle of [-1.25,1.25])for(const side of [-.68,.68]){
      const dx=x+Math.sin(p.heading)*axle+Math.cos(p.heading)*side,dy=y+Math.cos(p.heading)*axle-Math.sin(p.heading)*side
      let surface=0
      if(city.roads.some(r=>Math.abs(wrap(district.azimuth+dx/R-r.azimuth))*R<=r.tangentWidth/2&&Math.abs(district.axial+dy-r.axial)<=r.axialLength/2))surface=.2
      for(const b of roadSurfaces)surface=Math.max(surface,sampleCitySurface(b.surfaceMesh!,dx-wrap(b.azimuth-district.azimuth)*R,dy-(b.axial-district.axial)))
      expect(surface).toBeGreaterThan(.19)
      worstSupport=Math.max(worstSupport,Math.abs(p.height+Math.sin(p.slope)*axle-surface))
    }
    const next=sampleRiverTraffic(loop,progress+.01)
    expect(Math.hypot(wrap(next.azimuth-p.azimuth)*R,next.axial-p.axial,next.height-p.height)).toBeLessThan(.012)
    expect(Math.abs(wrap(next.heading-p.heading))).toBeLessThan(.012)
  }
  expect(high).toBeCloseTo(5.2,2)
  expect(worstSupport).toBeLessThan(.19)
  expect(sampleRiverTraffic(loop,0)).toEqual(sampleRiverTraffic(loop,loop.length))
})

test('a riverside merge waits at its stop then clears without wrapping, reversing or jumping',()=>{
  const gate=loop.gates.find(g=>!g.crossing)!,s=gate.stop
  const car={azimuth:loop.azimuth+gate.x/R,axial:loop.axial+gate.y-12,height:.2,heading:gate.heading,speed:6}
  let motion={progress:s-35,speed:5}
  for(let i=0;i<600;i++)motion=advanceTraffic(motion,1/60,5,riverTrafficYieldGap(loop,motion.progress,[car]))
  expect(motion.progress).toBeCloseTo(s,6);expect(motion.speed).toBe(0)
  const resumed=advanceTraffic(motion,1/60,5,riverTrafficYieldGap(loop,motion.progress,[]))
  expect(resumed.progress).toBeGreaterThan(motion.progress);expect(resumed.progress-motion.progress).toBeLessThan(.01)
  expect(riverTrafficYieldGap(loop,s+.02,[car])).toBe(Infinity)
  expect(riverTrafficYieldGap(loop,s-10,[{...car,height:18}])).toBe(Infinity)
  const own=sampleRiverTraffic(loop,s-30)
  const leader={...own,azimuth:own.azimuth+Math.sin(own.heading)*8/R,axial:own.axial+Math.cos(own.heading)*8,speed:0}
  expect(trafficFollowingGap({...own,speed:5},[leader],R)).toBeCloseTo(6,4)
  expect(trafficFollowingGap({...own,speed:5},[{...leader,height:18}],R)).toBe(Infinity)
})

test('intermediate crossings see approaching cross traffic without yielding to the same lane or viaduct',()=>{
  const gate=loop.gates.find(g=>g.crossing)!
  const car={azimuth:loop.azimuth+(gate.x-18)/R,axial:loop.axial+gate.y-1.5,height:.2,heading:Math.PI/2,speed:7}
  expect(riverTrafficYieldGap(loop,gate.stop-20,[car])).toBeCloseTo(23.2,4)
  expect(riverTrafficYieldGap(loop,gate.stop,[car])).toBeCloseTo(3.2,4)
  expect(riverTrafficYieldGap(loop,gate.stop+.02,[car])).toBe(Infinity)
  expect(riverTrafficYieldGap(loop,gate.stop-20,[{...car,heading:gate.heading}])).toBe(Infinity)
  expect(riverTrafficYieldGap(loop,gate.stop-20,[{...car,height:18}])).toBe(Infinity)
})
