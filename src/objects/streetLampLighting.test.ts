import { test, expect } from 'bun:test'
import * as THREE from 'three'
import { StreetLampLighting, STREET_LIGHT_RANGE, type StreetLampSource } from './streetLampLighting'

const source = (id: string, z: number): StreetLampSource => ({ id, position: new THREE.Vector3(0, 12, z), down: new THREE.Vector3(0, -1, 0) })
const advance = (lighting: StreetLampLighting, focus: THREE.Vector3, available = true) => {
  for (let i = 0; i < 30; i++) lighting.update(focus, 1 / 60, available)
}

test('nearby lamp slots illuminate from actual fixed fixtures and point down', () => {
  const group = new THREE.Group(), lighting = new StreetLampLighting(group, 2)
  const lamps = [source('a', 0), source('b', 24), source('c', 70)]
  lighting.setSources(lamps); lighting.setDaylight(0)
  advance(lighting, new THREE.Vector3(0, 1.8, 2))
  expect(lighting.slots.map(s => s.source?.id)).toEqual(['a', 'b'])
  for (const slot of lighting.slots) {
    expect(slot.light.position.distanceTo(slot.source!.position)).toBe(0)
    expect(slot.light.target.position.clone().sub(slot.light.position).distanceTo(slot.source!.down)).toBe(0)
    expect(slot.light.intensity).toBeGreaterThan(0)
    expect(slot.light.castShadow).toBe(false)
  }
  lighting.dispose(); expect(group.children.length).toBe(0)
})

test('a moving observer cannot drag a lit source between lamp positions', () => {
  const lighting = new StreetLampLighting(new THREE.Group(), 1)
  lighting.setSources([source('a', 0), source('b', 30)]); lighting.setDaylight(0)
  advance(lighting, new THREE.Vector3(0, 1.8, 0))
  let previous = lighting.slots[0].source?.id, switched = false
  for (let i = 0; i < 60; i++) {
    lighting.update(new THREE.Vector3(0, 1.8, 30), 1 / 60)
    const slot = lighting.slots[0]
    if (slot.source?.id !== previous) {
      expect(slot.light.intensity).toBe(0); switched = true
    }
    expect([0, 30]).toContain(slot.light.position.z)
    previous = slot.source?.id
  }
  expect(switched).toBe(true)
  expect(lighting.slots[0].source?.id).toBe('b')
  expect(lighting.slots[0].light.intensity).toBeGreaterThan(0)
  lighting.dispose()
})

test('indoor shelter, distance, daytime and a plan reset remove local lamp light', () => {
  const lighting = new StreetLampLighting(new THREE.Group(), 1), focus = new THREE.Vector3(0, 1.8, 0)
  lighting.setSources([source('a', 0)]); lighting.setDaylight(0)
  advance(lighting, focus)
  advance(lighting, focus, false)
  expect(lighting.slots[0].light.intensity).toBe(0)
  advance(lighting, focus)
  expect(lighting.slots[0].light.intensity).toBeGreaterThan(0)
  lighting.setDaylight(1)
  expect(lighting.slots[0].light.intensity).toBe(0)
  lighting.setDaylight(0)
  advance(lighting, new THREE.Vector3(0, 1.8, STREET_LIGHT_RANGE + 1))
  expect(lighting.slots[0].light.intensity).toBe(0)
  advance(lighting, focus)
  lighting.reset()
  expect(lighting.slots[0].light.intensity).toBe(0)
  expect(lighting.slots[0].source).toBeNull()
  lighting.dispose()
})
