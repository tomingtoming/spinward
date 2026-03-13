import { expect, test } from 'bun:test'
import * as THREE from 'three'

import { applySurfaceRigState, moveSurfaceRigState, type SurfaceRigState } from './surfaceRig'

test('moveSurfaceRigState advances along the cylinder axis and tangent', () => {
  const state: SurfaceRigState = { axialPosition: 0, azimuth: 0 }

  moveSurfaceRigState(state, 3, 5, 10, 40)

  expect(state.axialPosition).toBeCloseTo(3, 6)
  expect(state.azimuth).toBeCloseTo(0.5, 6)
})

test('moveSurfaceRigState clamps at the cylinder end caps', () => {
  const state: SurfaceRigState = { axialPosition: 0, azimuth: 0 }

  moveSurfaceRigState(state, 100, 0, 10, 20)

  expect(state.axialPosition).toBeCloseTo(8.5, 6)
})

test('applySurfaceRigState places the rig on the cylinder wall', () => {
  const rig = new THREE.Group()
  const state: SurfaceRigState = { axialPosition: 4, azimuth: Math.PI / 2 }

  applySurfaceRigState(rig, state, 10)

  expect(rig.position.x).toBeCloseTo(0, 6)
  expect(rig.position.y).toBeCloseTo(4, 6)
  expect(rig.position.z).toBeCloseTo(10, 6)
})
