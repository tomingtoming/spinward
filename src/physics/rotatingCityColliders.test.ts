import { expect, test } from 'bun:test'

import { initRapier } from './rapierContext'
import { applyWorldLengthUnit } from './rapierBoundary'
import { createRotatingCityColliders } from './rotatingCityColliders'
import { buildCityCollisionIndex, type CityBuilding } from '../objects/cityLayout'
import { createUnitsContext, periodToOmega } from '../units/units'

const RADIUS = 3200
const LENGTH = 40000
const OMEGA = periodToOmega(113.5)
const SIM_SCALE = 0.02

const building = (azimuth: number, axial = 0): CityBuilding => ({
  azimuth,
  axial,
  width: 14,
  depth: 14,
  height: 30,
  tone: 0.5,
  kind: 'block'
})

test('the city colliders stream the active set to the focus and back', async () => {
  const rapier = await initRapier()
  const world = new rapier.World({ x: 0, y: 0, z: 0 })
  const units = createUnitsContext(SIM_SCALE)
  applyWorldLengthUnit(world, units)

  // Two tight clusters half a colony apart, plus a lone building well outside
  // the window from the first cluster.
  const clusterA = [building(-0.01), building(-0.004), building(0.004), building(0.01)]
  const clusterB = [building(Math.PI - 0.004), building(Math.PI + 0.004)]
  const farFromA = building(0.1) // ~320 m away, beyond the ~192 m window
  const index = buildCityCollisionIndex([...clusterA, ...clusterB, farFromA], RADIUS, LENGTH)

  const city = createRotatingCityColliders(rapier, world, { radius: RADIUS, index, units, omega: OMEGA })

  // Focus on cluster A: only A is active (B is half a colony away, the lone one
  // is outside the window).
  const atA = city.update(0, 0)
  expect(atA).toBe(clusterA.length)

  // Move the focus to cluster B: A is released, B streams in.
  const atB = city.update(Math.PI, 0)
  expect(atB).toBe(clusterB.length)

  // Back to A: B released, A back.
  expect(city.update(0, 0)).toBe(clusterA.length)
  expect(city.activeCount()).toBe(clusterA.length)

  city.dispose()
  world.free()
})

test('the city colliders body spins and survives a rebuild', async () => {
  const rapier = await initRapier()
  const world = new rapier.World({ x: 0, y: 0, z: 0 })
  const units = createUnitsContext(SIM_SCALE)
  applyWorldLengthUnit(world, units)

  const index = buildCityCollisionIndex([building(0), building(0.005)], RADIUS, LENGTH)
  const city = createRotatingCityColliders(rapier, world, { radius: RADIUS, index, units, omega: OMEGA })
  expect(city.update(0, 0)).toBe(2)

  // Rebuild onto a new (empty) plan: the old colliders are cleared.
  const emptyIndex = buildCityCollisionIndex([], RADIUS, LENGTH)
  city.rebuild({ radius: RADIUS, index: emptyIndex, units })
  expect(city.update(0, 0)).toBe(0)

  // The kinematic body genuinely rotates under angvel, so a few steps advance
  // its rotation (no throw, world stays valid).
  for (let i = 0; i < 5; i += 1) {
    world.timestep = 1 / 60
    world.step()
  }

  city.dispose()
  world.free()
})
