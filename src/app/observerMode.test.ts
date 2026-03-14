import { expect, test } from 'bun:test'
import * as THREE from 'three'

import {
  computeInertialObserverPose,
  getDisplayRootRotation,
  getEffectiveObserverMode
} from './observerMode'

test('getDisplayRootRotation keeps colony-fixed static and rotates inertial-fixed view', () => {
  expect(getDisplayRootRotation('colony-fixed', 1.2)).toBe(0)
  expect(getDisplayRootRotation('inertial-fixed', 1.2)).toBeCloseTo(1.2, 6)
})

test('getEffectiveObserverMode falls back to colony-fixed during XR', () => {
  expect(getEffectiveObserverMode('inertial-fixed', true)).toBe('colony-fixed')
  expect(getEffectiveObserverMode('inertial-fixed', false)).toBe('inertial-fixed')
})

test('computeInertialObserverPose transforms a rotating-frame camera pose into inertial space', () => {
  const rotatingPosition = new THREE.Vector3(10, 1.6, 0)
  const rotatingOrientation = new THREE.Quaternion().setFromAxisAngle(
    new THREE.Vector3(0, 1, 0),
    Math.PI * 0.25
  )

  const pose = computeInertialObserverPose(rotatingPosition, rotatingOrientation, Math.PI * 0.5)

  expect(pose.position.x).toBeCloseTo(0, 6)
  expect(pose.position.y).toBeCloseTo(1.6, 6)
  expect(pose.position.z).toBeCloseTo(-10, 6)

  const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(pose.orientation)
  expect(forward.x).toBeCloseTo(-Math.sqrt(0.5), 6)
  expect(Math.abs(forward.y)).toBeLessThan(1e-6)
  expect(forward.z).toBeCloseTo(Math.sqrt(0.5), 6)
})
