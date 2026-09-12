import { expect, test } from 'bun:test'
import { Vector3 } from 'three'
import { RainStreaks } from './rain'
import { MAX_RAIN_ROOFS, planExpresswayRainRoofs, type RainRoof } from './rainShelter'
import { getCityExpressway } from './cityLayout'

const roof = (axial: number): RainRoof => ({ cos: 1, sin: 0, axial, radial: 970, halfWidth: 2, halfDepth: .4 })
const update = { cameraPosition: new Vector3(998, 0, 0), rainVelocity: new Vector3(8, 0, 0), cameraVelocity: new Vector3(), deltaSeconds: .016, intensity: 1 }

test('rain keeps the nearest shelter when a district exceeds the GPU roof budget', () => {
  const rain = new RainStreaks(10)
  rain.setBounds(1000, 3000)
  const roofs = Array.from({ length: 25 }, (_, i) => roof(25 - i))
  roofs.push(roof(0))
  rain.update({ ...update, roofs })
  const uniforms = (rain.lines.material as import('three').ShaderMaterial).uniforms
  expect(uniforms.uRoofCount.value).toBe(MAX_RAIN_ROOFS)
  expect(uniforms.uRoofFrames.value[0].z).toBe(0)
  expect(uniforms.uHabitat.value.toArray()).toEqual([1000, 1500])
  rain.dispose()
})

test('travel clears stale rain roofs and bounds the apparent streak after a fast move', () => {
  const rain = new RainStreaks(10)
  rain.setBounds(1000, 3000)
  rain.update({ ...update, roofs: [roof(0)] })
  const uniforms = (rain.lines.material as import('three').ShaderMaterial).uniforms
  expect(uniforms.uRoofCount.value).toBe(1)
  rain.update({ ...update, cameraPosition: new Vector3(-998, 0, 0), cameraVelocity: new Vector3(1e6, 0, 0), roofs: [roof(0)] })
  expect(uniforms.uRoofCount.value).toBe(0)
  expect(uniforms.uStreak.value.length()).toBeLessThanOrEqual(60 * .35 + 1e-9)
  rain.update({ ...update, intensity: 0, roofs: [] })
  expect(rain.lines.visible).toBe(false)
  rain.dispose()
})

test('a preset without a viaduct clears its cylindrical rain masks', () => {
  const rain=new RainStreaks(10),arcs=planExpresswayRainRoofs(getCityExpressway(3200,40000),3200)
  rain.setBounds(3200,40000)
  rain.update({...update,roofs:[],arcs})
  const uniforms=(rain.lines.material as import('three').ShaderMaterial).uniforms
  expect(uniforms.uArcCount.value).toBe(7)
  expect(uniforms.uArcFrames.value[0].toArray()).toEqual([0,Math.PI*2,arcs[0].axial,arcs[0].halfDepth])
  rain.setBounds(100,400)
  rain.update({...update,roofs:[]})
  expect(uniforms.uArcCount.value).toBe(0)
  rain.dispose()
})
