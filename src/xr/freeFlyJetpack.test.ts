import { expect, test } from 'bun:test'
import * as THREE from 'three'

import {
  createJetpackAttitudeState,
  getJetpackThrustDirection,
  integrateJetpackAttitudeOrientation,
  resetJetpackAttitude,
  seedJetpackAttitudeFromWorldAngularVelocity,
  stepJetpackAttitude
} from './freeFlyJetpack'

test('getJetpackThrustDirection follows the hand forward axis', () => {
  const orientation = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, Math.PI * 0.5, 0))

  const direction = getJetpackThrustDirection(orientation)

  expect(direction.x).toBeCloseTo(-1, 6)
  expect(direction.y).toBeCloseTo(0, 6)
  expect(direction.z).toBeCloseTo(0, 6)
})

test('stepJetpackAttitude adds roll angular velocity from stick X input', () => {
  const state = createJetpackAttitudeState()

  stepJetpackAttitude(state, 1, 0, 0.5)

  expect(state.angularVelocity.z).toBeLessThan(-2.3)
  expect(state.angularVelocity.x).toBeCloseTo(0, 6)
})

test('stepJetpackAttitude adds pitch angular velocity from stick Y input', () => {
  const state = createJetpackAttitudeState()

  stepJetpackAttitude(state, 0, -1, 0.5)

  expect(state.angularVelocity.x).toBeLessThan(-2.3)
  expect(state.angularVelocity.z).toBeCloseTo(0, 6)
})

test('stepJetpackAttitude keeps rotating after the stick returns to center', () => {
  const state = createJetpackAttitudeState()
  const orientation = new THREE.Quaternion()

  stepJetpackAttitude(state, 1, 0, 0.25)
  const previousVelocity = state.angularVelocity.z
  stepJetpackAttitude(state, 0, 0, 0.25)
  integrateJetpackAttitudeOrientation(orientation, state, 0.25)

  expect(state.angularVelocity.z).toBeCloseTo(previousVelocity, 6)
  expect(Math.abs(orientation.z)).toBeGreaterThan(0.1)
})

test('stepJetpackAttitude brake dampens all angular velocity components', () => {
  const state = createJetpackAttitudeState()

  state.angularVelocity.set(1.5, -0.8, 2.2)
  stepJetpackAttitude(state, 0, 0, 0.25, true)

  expect(state.angularVelocity.x).toBeLessThan(1)
  expect(state.angularVelocity.y).toBeGreaterThan(-0.3)
  expect(state.angularVelocity.z).toBeLessThan(1.2)
})

test('resetJetpackAttitude clears accumulated free-fly rotation state', () => {
  const state = createJetpackAttitudeState()

  stepJetpackAttitude(state, 1, -1, 0.25)
  resetJetpackAttitude(state)

  expect(state.angularVelocity.x).toBe(0)
  expect(state.angularVelocity.y).toBe(0)
  expect(state.angularVelocity.z).toBe(0)
})

test('seedJetpackAttitudeFromWorldAngularVelocity matches the attached wall rotation axis', () => {
  const state = createJetpackAttitudeState()
  const attachedOrientation = new THREE.Quaternion().setFromRotationMatrix(
    new THREE.Matrix4().makeBasis(
      new THREE.Vector3(0, 1, 0),
      new THREE.Vector3(-1, 0, 0),
      new THREE.Vector3(0, 0, 1)
    )
  )

  seedJetpackAttitudeFromWorldAngularVelocity(
    state,
    attachedOrientation,
    new THREE.Vector3(0, 0.55, 0)
  )

  expect(state.angularVelocity.x).toBeCloseTo(0.55, 6)
  expect(state.angularVelocity.y).toBeCloseTo(0, 6)
  expect(state.angularVelocity.z).toBeCloseTo(0, 6)
})

test('integrateJetpackAttitudeOrientation rolls around the current view forward axis', () => {
  const state = createJetpackAttitudeState()
  const attitude = new THREE.Quaternion()
  const yaw = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI * 0.5)
  const beforeForward = new THREE.Vector3(0, 0, -1).applyQuaternion(yaw.clone().multiply(attitude))
  const beforeUp = new THREE.Vector3(0, 1, 0).applyQuaternion(yaw.clone().multiply(attitude))

  state.angularVelocity.set(0, 0, Math.PI * 0.5)
  integrateJetpackAttitudeOrientation(attitude, state, 0.5)

  const combined = yaw.clone().multiply(attitude)
  const afterForward = new THREE.Vector3(0, 0, -1).applyQuaternion(combined)
  const afterUp = new THREE.Vector3(0, 1, 0).applyQuaternion(combined)

  expect(afterForward.x).toBeCloseTo(beforeForward.x, 6)
  expect(afterForward.y).toBeCloseTo(beforeForward.y, 6)
  expect(afterForward.z).toBeCloseTo(beforeForward.z, 6)
  expect(afterUp.distanceTo(beforeUp)).toBeGreaterThan(0.2)
})
