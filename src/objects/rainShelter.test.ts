import { expect, test } from 'bun:test'
import { createBuildingInterior } from './buildingInteriors'
import type { CityBuilding } from './cityLayout'
import { planRainRoofs, rainRoofCoversPoint, rainRoofNearBox } from './rainShelter'

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
