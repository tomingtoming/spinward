import { expect, test } from 'bun:test'
import * as THREE from 'three'

import {
  applySurfaceRigState,
  getSurfaceRigRegion,
  moveSurfaceRigState,
  type SurfaceRigState
} from './surfaceRig'

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

test('moveSurfaceRigState can pass through the opening when end caps are disabled', () => {
  const state: SurfaceRigState = { axialPosition: 0, azimuth: 0 }

  moveSurfaceRigState(state, 100, 0, 10, 20, { capEnds: false })

  expect(state.axialPosition).toBeCloseTo(100, 6)
})

test('applySurfaceRigState places the rig on the cylinder wall', () => {
  const rig = new THREE.Group()
  const state: SurfaceRigState = { axialPosition: 4, azimuth: Math.PI / 2 }

  applySurfaceRigState(rig, state, 10)

  expect(rig.position.x).toBeCloseTo(0, 6)
  expect(rig.position.y).toBeCloseTo(4, 6)
  expect(rig.position.z).toBeCloseTo(10, 6)
})

test('getSurfaceRigRegion reports when the traveler is outside the cylinder length', () => {
  expect(getSurfaceRigRegion({ axialPosition: 0, azimuth: 0 }, 20)).toBe('inside')
  expect(getSurfaceRigRegion({ axialPosition: 9, azimuth: 0 }, 20)).toBe('outside')
})
