import { expect, test } from 'bun:test'
import * as THREE from 'three'
import { Starfield, starVisibility } from './starfield'

const points = (sky: Starfield) => sky.group.children[0] as THREE.Points<THREE.BufferGeometry, THREE.PointsMaterial>

test('colony daylight hides stars through air without switching off the vacuum sky', () => {
  expect(starVisibility(1, true)).toBe(0)
  expect(starVisibility(0, true)).toBeGreaterThan(0)
  for (const daylight of [-1, 0, .3, .5, 1, 2]) {
    expect(starVisibility(daylight, false)).toBe(starVisibility(0, false))
    expect(starVisibility(daylight, true)).toBeGreaterThanOrEqual(0)
    expect(starVisibility(daylight, true)).toBeLessThanOrEqual(1)
  }
})

test('air-to-vacuum visibility is gradual and independent of frame rate', () => {
  const values: number[] = []
  for (const fps of [30, 60, 120]) {
    const sky = new Starfield({ radius: 3200, length: 40000 })
    sky.setDaylight(1, true)
    sky.setDaylight(1, false, 0)
    expect(points(sky).material.opacity).toBe(0)
    sky.setDaylight(1, false, 1 / fps)
    expect(points(sky).material.opacity).toBeGreaterThan(0)
    expect(points(sky).material.opacity).toBeLessThan(starVisibility(1, false))
    for (let frame = 1; frame < fps; frame++) sky.setDaylight(1, false, 1 / fps)
    values.push(points(sky).material.opacity)
    sky.dispose()
  }
  expect(Math.max(...values) - Math.min(...values)).toBeLessThan(1e-12)
  expect(values[0]).toBeCloseTo(starVisibility(1, false), 2)
})

test('the single star batch contains varied faint lights with a soft round sprite', () => {
  const sky = new Starfield({ radius: 3200, length: 40000 }), mesh = points(sky)
  const positions = mesh.geometry.getAttribute('position'), colors = mesh.geometry.getAttribute('color')
  expect(colors.count).toBe(positions.count)
  expect(colors.count).toBe(1800)
  let dim = 0, bright = 0
  for (let i = 0; i < colors.count; i++) {
    const level = Math.max(colors.getX(i), colors.getY(i), colors.getZ(i))
    expect(level).toBeGreaterThan(0)
    expect(level).toBeLessThanOrEqual(1)
    if (level < .4) dim++
    if (level > .8) bright++
  }
  expect(dim).toBeGreaterThan(colors.count / 2)
  expect(bright).toBeGreaterThan(0)
  expect(bright).toBeLessThan(colors.count / 5)
  const { data, width, height } = mesh.material.map!.image as { data: Uint8Array; width: number; height: number }
  expect(data[3]).toBe(0)
  expect(data[(height / 2 * width + width / 2) * 4 + 3]).toBeGreaterThan(240)
  expect(mesh.material.depthTest).toBe(true)
  expect(mesh.material.depthWrite).toBe(false)
  sky.dispose()
})

test('changing habitats and final teardown release owned star geometry and sprite resources', () => {
  const sky = new Starfield({ radius: 3200, length: 40000 }), first = points(sky)
  let oldGeometry = 0, lastGeometry = 0, material = 0, texture = 0
  first.geometry.addEventListener('dispose', () => oldGeometry++)
  first.material.addEventListener('dispose', () => material++)
  first.material.map!.addEventListener('dispose', () => texture++)
  sky.setDimensions({ radius: 18, length: 120 })
  points(sky).geometry.addEventListener('dispose', () => lastGeometry++)
  expect(oldGeometry).toBe(1)
  sky.dispose()
  expect(lastGeometry).toBe(1)
  expect(material).toBe(1)
  expect(texture).toBe(1)
})
