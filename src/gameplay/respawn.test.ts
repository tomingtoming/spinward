import { expect, test } from 'bun:test'
import * as THREE from 'three'

import { createPlayerTraversalState } from '../app/playerTraversal'
import { respawnAxisEnd, respawnInnerWall } from './respawn'
import { inertialPositionToRotating } from '../sim/frameTransforms'

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

test('respawnAxisEnd is disabled for ring habitats', () => {
  const state = createPlayerTraversalState({ axialPosition: 0, azimuth: 0 }, 10, 0, 1)

  expect(
    respawnAxisEnd(state, {
      type: 'ring',
      length: 2000,
      frameAngle: 0,
      omega: 1
    })
  ).toBe(false)
  expect(state.mode).toBe('attached')
})
