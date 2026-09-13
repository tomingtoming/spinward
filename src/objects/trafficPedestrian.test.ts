import {test,expect} from 'bun:test'
import {trafficPedestrianGap} from './trafficPedestrian'
import {advanceTraffic,fillLaneLeaderGaps} from './trafficMotion'
const radius=3200,car={azimuth:0,axial:0,height:.2,heading:0}

test('on-foot traffic clearance preserves sidewalks, separate decks, rear and seam',()=>{
 const person={azimuth:0,axial:20,height:0}
 expect(trafficPedestrianGap(car,person,radius)).toBeCloseTo(19.45)
 expect(trafficPedestrianGap(car,{...person,azimuth:1.5/radius},radius)).toBe(Infinity)
 expect(trafficPedestrianGap(car,{...person,axial:-1},radius)).toBe(Infinity)
 expect(trafficPedestrianGap(car,{...person,height:5.34},radius)).toBe(Infinity)
 expect(trafficPedestrianGap({...car,height:5.2},person,radius)).toBe(Infinity)
 expect(trafficPedestrianGap(car,{...person,height:1.3},radius)).toBeLessThan(Infinity)
 expect(trafficPedestrianGap(car,{...person,height:2.5},radius)).toBeLessThan(Infinity)
 expect(trafficPedestrianGap(car,{...person,height:2.8},radius)).toBe(Infinity)
 expect(trafficPedestrianGap(car,null,radius)).toBe(Infinity)
 expect(trafficPedestrianGap({...car,heading:Math.PI}, {...person,axial:-20},radius)).toBeCloseTo(19.45)
 expect(trafficPedestrianGap({...car,azimuth:Math.PI-.003,heading:Math.PI/2},
  {azimuth:-Math.PI+.003,axial:0,height:.34},radius)).toBeCloseTo(18.65)
})

test('a pedestrian stops a whole queue with nose clearance and releases it continuously',()=>{
 const person={azimuth:0,axial:40,height:.2};let cars=[{progress:0,speed:12},{progress:-9,speed:12}]
 let minimum=Infinity
 for(let frame=0;frame<1200;frame++){
  const gaps=new Map<number,number>();fillLaneLeaderGaps(cars.map((c,index)=>({index,along:c.progress})),1000,gaps)
  cars=cars.map((c,index)=>advanceTraffic(c,1/60,12,Math.min(gaps.get(index)??Infinity,
   trafficPedestrianGap({...car,axial:c.progress},frame<900?person:null,radius))))
  minimum=Math.min(minimum,cars[0].progress-cars[1].progress)
  if(frame===899){expect(cars[0].progress).toBeCloseTo(36.25,5);expect(cars[0].speed).toBe(0);expect(cars[1].speed).toBe(0)}
  if(frame===900){expect(cars[0].progress-36.25).toBeLessThan(.01);expect(cars[0].speed).toBeGreaterThan(0)}
 }
 expect(minimum).toBeGreaterThan(5.19);expect(cars[0].progress).toBeGreaterThan(50)
})

test('bend samples follow a curve and its rising road, not its extended tangent',()=>{
 const curve=(s:number)=>({azimuth:10*(1-Math.cos(s/10))/radius,axial:10*Math.sin(s/10),height:.2+s*.1})
 const p=curve(10)
 expect(trafficPedestrianGap(car,p,radius,curve,15)).toBeCloseTo(9.45,1)
 expect(trafficPedestrianGap(car,{azimuth:0,axial:20,height:.2},radius,curve,15)).toBe(Infinity)
 expect(trafficPedestrianGap(car,{...p,height:6},radius,curve,15)).toBe(Infinity)
 expect(trafficPedestrianGap(car,{...p,height:-2},radius,curve,15)).toBe(Infinity)
 let samples=0;const sample=(s:number)=>{samples++;return curve(s)}
 expect(trafficPedestrianGap(car,{...p,axial:200},radius,sample)).toBe(Infinity);expect(samples).toBe(0)
})
