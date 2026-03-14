import { expect, test } from 'bun:test'
import * as THREE from 'three'

import { computeDockingGuideState } from './dockingGuide'
import { createPlayerTraversalState } from '../app/playerTraversal'
import { rotatingPositionToInertial } from '../sim/frameTransforms'

const expectVectorCloseTo = (actual: THREE.Vector3, expected: THREE.Vector3) => {
  expect(actual.x).toBeCloseTo(expected.x, 6)
  expect(actual.y).toBeCloseTo(expected.y, 6)
  expect(actual.z).toBeCloseTo(expected.z, 6)
}

test('computeDockingGuideState targets the nearest wall point for a free-flying player', () => {
  const state = createPlayerTraversalState({ axialPosition: 0, azimuth: 0 }, 12, 0.4, 1.1)
  const rotatingPosition = new THREE.Vector3(8, 3, 6)

  state.mode = 'free-fly'
  state.inertialPosition.copy(rotatingPositionToInertial(rotatingPosition, 0.4))

  const guide = computeDockingGuideState(state, {
    radius: 12,
    length: 40,
    frameAngle: 0.4,
    ready: false,
    assistActive: true
  })

  expect(guide.visible).toBe(true)
  expect(guide.ready).toBe(false)
  expect(guide.assistActive).toBe(true)
  expectVectorCloseTo(guide.playerPosition, rotatingPosition)
  expectVectorCloseTo(
    guide.targetPosition,
    new THREE.Vector3(9.6, 3, 7.2)
  )
})

test('computeDockingGuideState clamps the target to the cylinder opening when outside', () => {
  const state = createPlayerTraversalState({ axialPosition: 0, azimuth: 0 }, 10, 0.2, 1)
  const rotatingPosition = new THREE.Vector3(7, 14, 0)

  state.mode = 'free-fly'
  state.inertialPosition.copy(rotatingPositionToInertial(rotatingPosition, 0.2))

  const guide = computeDockingGuideState(state, {
    radius: 10,
    length: 20,
    frameAngle: 0.2,
    ready: true,
    assistActive: false
  })

  expect(guide.visible).toBe(true)
  expect(guide.ready).toBe(true)
  expect(guide.targetPosition.y).toBeCloseTo(8.5, 6)
  expectVectorCloseTo(guide.normal, new THREE.Vector3(1, 0, 0))
})
