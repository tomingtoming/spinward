import { expect, test } from 'bun:test'
import { landscapeColliders } from '../worlds/authoredLandscape'
import { buildCityCollisionIndex, getCityGroundHeight } from '../objects/cityLayout'
import { createPlayerTraversalState, disposePlayerTraversalState, refreshPlayerCollider, resetPlayerToGrounded, stepGroundedPlayer, syncGroundedSurfaceFromPhysics } from '../app/playerTraversal'
import { createUnitsContext, periodToOmega } from '../units/units'
import { initRapier } from './rapierContext'
import { createRotatingCityColliders } from './rotatingCityColliders'
import { applyWorldLengthUnit } from './rapierBoundary'

// A tram rider or seated body is a sensor while carried. At the Mukohara stop
// the carried position and the alighting point lie over the same 20 m ground
// part, so the sensor's pair never ends; switching the sensor off then left no
// contact and the walker fell through the street (2026-09-30).
for (const release of ['sensor-off', 'refresh'] as const) test(`releasing a carried body over the same ground part: ${release}`, async () => {
  const radius = 3200, omega = periodToOmega(113.5), units = createUnitsContext(.02), h = 30
  const vertices = [-10, -10, h, 10, -10, h, 10, 10, h, -10, -10, h, 10, 10, h, -10, 10, h]
  const index = buildCityCollisionIndex(landscapeColliders({ solids: [], surfaces: [{ vertices, bounds: [-10, -10, 10, 10] }] }, radius), radius, 40000)
  const rapier = await initRapier(), world = new rapier.World({ x: 0, y: 0, z: 0 })
  applyWorldLengthUnit(world, units)
  const city = createRotatingCityColliders(rapier, world, { radius, index, units, omega })
  const state = createPlayerTraversalState({ azimuth: 0, axialPosition: 0 }, radius, 0, omega, { rapier, world, units })
  const body = state.physics!.freeFlyBody
  let time = 0
  const frame = (carriedHeight?: number) => {
    const dt = 1 / 60
    world.timestep = dt
    city.update(state.surface.azimuth, state.surface.axialPosition)
    if (carriedHeight !== undefined) resetPlayerToGrounded(state, { azimuth: 3 / radius, axialPosition: 2, radius, frameAngle: time * omega, omega, groundHeight: carriedHeight })
    else stepGroundedPlayer(state, { radius, length: 40000, omega, frameAngleEnd: (time + dt) * omega, deltaSeconds: dt, tangentDistanceDelta: 0, axisDistanceDelta: 0,
      sampleGroundHeight: (a, y, altitude, tolerance) => getCityGroundHeight(index, radius, a, y, altitude, tolerance) })
    world.step(); if (carriedHeight === undefined) syncGroundedSurfaceFromPhysics(state, (time + dt) * omega)
    time += dt
  }
  try {
    // Carried as a sensor 0.6 m above the street, over the same part.
    for (let i = 0; i < body.numColliders(); i++) body.collider(i).setSensor(true)
    for (let i = 0; i < 60; i++) frame(h + .6)
    if (release === 'refresh') refreshPlayerCollider(state)
    else for (let i = 0; i < body.numColliders(); i++) body.collider(i).setSensor(false)
    resetPlayerToGrounded(state, { azimuth: 0, axialPosition: 0, radius, frameAngle: time * omega, omega, groundHeight: h })
    for (let i = 0; i < 120 && state.mode === 'grounded'; i++) frame()
    if (release === 'refresh') {
      expect(state.mode).toBe('grounded')
      expect(Math.abs(state.groundHeight - h)).toBeLessThan(.02)
      expect(body.numColliders()).toBe(1); expect(body.collider(0).isSensor()).toBe(false)
    } else expect(state.mode).toBe('free-fly') // documents the Rapier behaviour the fix avoids
  } finally { city.dispose(); disposePlayerTraversalState(state); world.free() }
})
