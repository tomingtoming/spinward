import { expect, test } from 'bun:test'
import * as THREE from 'three'

import { createPlayerTraversalState, getPlayerBodyRadius } from '../app/playerTraversal'
import { initRapier } from '../physics/rapierContext'
import { respawnAxisEnd, respawnInnerWall } from './respawn'
import { inertialPositionToRotating } from '../sim/frameTransforms'
import { createUnitsContext } from '../units/units'

test('respawnInnerWall places the player back on the inner wall center', () => {
  const state = createPlayerTraversalState({ axialPosition: 5, azimuth: 1 }, 10, 0.4, 1.1)

  respawnInnerWall(state, {
    radius: 10,
    frameAngle: 0.4,
    omega: 1.1
  })

  expect(state.mode).toBe('attached')
  expect(state.surface.axialPosition).toBeCloseTo(0, 6)
  expect(state.surface.azimuth).toBeCloseTo(0, 6)
})

test('respawnAxisEnd places the player on the axis near the cylinder end', () => {
  const state = createPlayerTraversalState({ axialPosition: 0, azimuth: 0 }, 10, 0.3, 1)

  const didRespawn = respawnAxisEnd(state, {
    type: 'cylinder',
    length: 120,
    frameAngle: 0.3,
    omega: 1,
    endMargin: 12
  })

  const rotatingPosition = inertialPositionToRotating(
    state.inertialPosition,
    0.3,
    new THREE.Vector3()
  )

  expect(didRespawn).toBe(true)
  expect(state.mode).toBe('free-fly')
  expect(rotatingPosition.x).toBeCloseTo(0, 6)
  expect(rotatingPosition.z).toBeCloseTo(0, 6)
  expect(rotatingPosition.y).toBeCloseTo(48, 6)
})

test('respawnAxisEnd uses an adaptive end margin for short cylinders', () => {
  const state = createPlayerTraversalState({ axialPosition: 0, azimuth: 0 }, 18, 0, 1)

  const didRespawn = respawnAxisEnd(state, {
    type: 'cylinder',
    length: 120,
    frameAngle: 0,
    omega: 1
  })

  expect(didRespawn).toBe(true)
  expect(state.inertialPosition.y).toBeCloseTo(48, 6)
})

test('respawnAxisEnd uses the ring center for ring habitats', () => {
  const state = createPlayerTraversalState({ axialPosition: 0, azimuth: 0 }, 10, 0, 1)

  const didRespawn = respawnAxisEnd(state, {
    type: 'ring',
    length: 2000,
    frameAngle: 0,
    omega: 1
  })

  expect(didRespawn).toBe(true)
  expect(state.mode).toBe('free-fly')
  expect(state.inertialPosition.x).toBeCloseTo(0, 6)
  expect(state.inertialPosition.y).toBeCloseTo(0, 6)
  expect(state.inertialPosition.z).toBeCloseTo(0, 6)
})

test('respawnInnerWall is defined in real meters while Rapier pose follows sim scale', async () => {
  const rapier = await initRapier()
  const izmaWorld = new rapier.World({ x: 0, y: 0, z: 0 })
  const elysiumWorld = new rapier.World({ x: 0, y: 0, z: 0 })
  const radius = 3200

  const izmaState = createPlayerTraversalState(
    { axialPosition: 0, azimuth: 0 },
    radius,
    0,
    0,
    { rapier, world: izmaWorld, units: createUnitsContext(0.02) }
  )
  const elysiumState = createPlayerTraversalState(
    { axialPosition: 0, azimuth: 0 },
    radius,
    0,
    0,
    { rapier, world: elysiumWorld, units: createUnitsContext(0.005) }
  )

  respawnInnerWall(izmaState, { radius, frameAngle: 0, omega: 0 })
  respawnInnerWall(elysiumState, { radius, frameAngle: 0, omega: 0 })

  expect(izmaState.inertialPosition.x).toBeCloseTo(getPlayerBodyRadius(radius), 6)
  expect(elysiumState.inertialPosition.x).toBeCloseTo(getPlayerBodyRadius(radius), 6)
  expect(izmaState.physics?.freeFlyBody.translation().x).toBeCloseTo(
    getPlayerBodyRadius(radius) * 0.02,
    5
  )
  expect(elysiumState.physics?.freeFlyBody.translation().x).toBeCloseTo(
    getPlayerBodyRadius(radius) * 0.005,
    5
  )

  izmaWorld.free()
  elysiumWorld.free()
})

test('respawnAxisEnd is defined in real meters while Rapier pose follows sim scale', async () => {
  const rapier = await initRapier()
  const izmaWorld = new rapier.World({ x: 0, y: 0, z: 0 })
  const elysiumWorld = new rapier.World({ x: 0, y: 0, z: 0 })
  const length = 40000
  const expectedAxisEndY = length * 0.5 - 50

  const izmaState = createPlayerTraversalState(
    { axialPosition: 0, azimuth: 0 },
    3200,
    0,
    0,
    { rapier, world: izmaWorld, units: createUnitsContext(0.02) }
  )
  const elysiumState = createPlayerTraversalState(
    { axialPosition: 0, azimuth: 0 },
    3200,
    0,
    0,
    { rapier, world: elysiumWorld, units: createUnitsContext(0.005) }
  )

  expect(
    respawnAxisEnd(izmaState, {
      type: 'cylinder',
      length,
      frameAngle: 0,
      omega: 0
    })
  ).toBe(true)
  expect(
    respawnAxisEnd(elysiumState, {
      type: 'cylinder',
      length,
      frameAngle: 0,
      omega: 0
    })
  ).toBe(true)

  expect(izmaState.inertialPosition.y).toBeCloseTo(expectedAxisEndY, 6)
  expect(elysiumState.inertialPosition.y).toBeCloseTo(expectedAxisEndY, 6)
  expect(izmaState.physics?.freeFlyBody.translation().y).toBeCloseTo(expectedAxisEndY * 0.02, 6)
  expect(elysiumState.physics?.freeFlyBody.translation().y).toBeCloseTo(expectedAxisEndY * 0.005, 6)

  izmaWorld.free()
  elysiumWorld.free()
})
