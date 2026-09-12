import { expect, test } from 'bun:test'
import { createBuildingInterior } from './buildingInteriors'
import type { CityBuilding } from './cityLayout'
import { MAX_RAIN_ARCS, planExpresswayRainRoofs, planRainRoofs, rainArcCoversPoint, rainRoofCoversPoint, rainRoofNearBox, sampleRainShelter } from './rainShelter'
import { getCityExpressway } from './cityLayout'

const building = { azimuth: 0, axial: 40, width: 18, depth: 24, height: 30, kind: 'block', front: { axis: 'axial', side: 1 } } as CityBuilding
const radius = 1000
const point = (tangent: number, axial: number, altitude: number) => ({ x: radius-altitude, y: 40+axial, z: tangent })

test('ceiling keeps a cafe dry while leaving the street and rooftop in the rain', () => {
  const roofs=planRainRoofs([createBuildingInterior(building,'cafe')],radius)
  const covered=(p:ReturnType<typeof point>)=>roofs.some(r=>rainRoofCoversPoint(r,p))
  expect(covered(point(0,0,1.6))).toBe(true)
  expect(covered(point(0,0,31))).toBe(false)
  expect(covered(point(0,16,1.6))).toBe(false)
  expect(covered(point(12,0,1.6))).toBe(false)
})

test('courtyard wings shelter their rooms without blocking rain in the light well', () => {
  const roofs=planRainRoofs([createBuildingInterior(building,'court')],radius)
  const covered=(p:ReturnType<typeof point>)=>roofs.some(r=>rainRoofCoversPoint(r,p))
  expect(covered(point(0,0,1.6))).toBe(false)
  expect(covered(point(8,0,1.6))).toBe(true)
  expect(covered(point(0,-11,1.6))).toBe(true)
})

test('roof coverage follows other land strips and never projects through the opposite wall', () => {
  const a=2*Math.PI/3,b={...building,azimuth:a},roof=planRainRoofs([createBuildingInterior(b,'cafe')],radius)[0]
  const p={x:(radius-1.6)*Math.cos(a),y:40,z:(radius-1.6)*Math.sin(a)}
  expect(rainRoofCoversPoint(roof,p)).toBe(true)
  expect(rainRoofNearBox(roof,p,30)).toBe(true)
  expect(rainRoofNearBox(roof,{...p,x:-p.x,z:-p.z},30)).toBe(false)
  expect(rainRoofNearBox(roof,{...p,y:200},30)).toBe(false)
})

test('continuous viaduct covers every land strip without covering its deck or neighbouring street', () => {
  const R=3200,road=getCityExpressway(R,40000)!,arcs=planExpresswayRainRoofs(road,R)
  expect(arcs.length).toBeLessThanOrEqual(MAX_RAIN_ARCS)
  expect(planExpresswayRainRoofs(null,R)).toEqual([])
  const at=(a:number,y:number,h:number)=>({x:Math.cos(a)*(R-h),y,z:Math.sin(a)*(R-h)})
  for(const a of [-Math.PI,-.001,0,.001,2*Math.PI/3,Math.PI]){
    expect(arcs.some(r=>rainArcCoversPoint(r,at(a,road.axial,1.8)))).toBe(true)
    expect(arcs.some(r=>rainArcCoversPoint(r,at(a,road.axial,20)))).toBe(false)
    expect(arcs.some(r=>rainArcCoversPoint(r,at(a,road.axial-road.deckWidth/2-1,1.8)))).toBe(false)
  }
})

test('rising on-ramps and merge shelves shelter only their real width and height', () => {
  const R=3200,road=getCityExpressway(R,40000)!,arcs=planExpresswayRainRoofs(road,R)
  const y=road.axial+road.deckWidth/2+road.rampWidth/2
  const covered=(a:number,ax:number,h:number)=>arcs.some(r=>rainArcCoversPoint(r,{x:Math.cos(a)*(R-h),y:ax,z:Math.sin(a)*(R-h)}))
  for(const ramp of road.ramps){
    const halfway=ramp.azimuthStart+ramp.azimuthSpan*.5
    expect(covered(halfway,y,3)).toBe(true)
    expect(covered(halfway,y,12)).toBe(false)
    expect(covered(halfway,y+road.rampWidth/2+.1,3)).toBe(false)
    expect(covered(ramp.azimuthStart-.005,y,1.8)).toBe(false)
    expect(covered(ramp.azimuthStart+ramp.azimuthSpan+road.collectorSpan*.9,y,2)).toBe(true)
    expect(covered(ramp.azimuthStart+ramp.azimuthSpan+road.collectorSpan+.005,y,2)).toBe(false)
  }
})

test('public rain sound fades across a roof edge and remains outside on the rooftop', () => {
  const R=3200,road=getCityExpressway(R,40000)!,arcs=planExpresswayRainRoofs(road,R)
  const point=(y:number,h=1.8)=>({x:R-h,y,z:0}),edge=road.axial-road.deckWidth/2
  expect(sampleRainShelter([],arcs,point(edge-.1))).toBe(0)
  expect(sampleRainShelter([],arcs,point(edge+.75))).toBeCloseTo(.5)
  expect(sampleRainShelter([],arcs,point(edge+2))).toBe(1)
  expect(sampleRainShelter([],arcs,point(road.axial,21))).toBe(0)
  const roof={cos:1,sin:0,axial:0,radial:R-5,halfWidth:8,halfDepth:5}
  expect(sampleRainShelter([roof],[],point(4.25))).toBeCloseTo(.5)
  expect(sampleRainShelter([roof],[],point(0))).toBe(1)
  expect(sampleRainShelter([roof],[],point(0,8))).toBe(0)
})

test('an oblique bridge covers its corner wedges while leaving the adjacent bank exposed', () => {
  const yaw=Math.atan(.25),c=Math.cos(yaw),s=Math.sin(yaw),R=3200
  const roof={cos:1,sin:0,axial:50,radial:R-5.12,halfWidth:25,halfDepth:5.8,yaw}
  const point=(u:number,v:number,h=2)=>({x:R-h,y:50+u*s+v*c,z:u*c-v*s})
  for(const side of [-1,1])for(const end of [-1,1]){
    const p=point(end*24,side*5.6)
    expect(rainRoofCoversPoint(roof,p)).toBe(true)
    expect(rainRoofNearBox(roof,p,30)).toBe(true)
    expect(rainRoofCoversPoint(roof,point(end*24,side*6.1))).toBe(false)
    expect(rainRoofCoversPoint(roof,point(end*24,side*5.6,8))).toBe(false)
  }
})
