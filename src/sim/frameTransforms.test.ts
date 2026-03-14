import { expect, test } from 'bun:test'
import * as THREE from 'three'

import {
  inertialOrientationToRotating,
  inertialPositionToRotating,
  inertialVelocityToRotating,
  rotatingOrientationToInertial,
  rotatingPositionToInertial,
  rotatingVelocityToInertial
} from './frameTransforms'

const expectVectorCloseTo = (actual: THREE.Vector3, expected: THREE.Vector3) => {
  expect(actual.x).toBeCloseTo(expected.x, 6)
  expect(actual.y).toBeCloseTo(expected.y, 6)
  expect(actual.z).toBeCloseTo(expected.z, 6)
}

test('rotatingPositionToInertial rotates positions around the cylinder axis', () => {
  const rotatingPosition = new THREE.Vector3(10, 2, 0)

  expectVectorCloseTo(
    rotatingPositionToInertial(rotatingPosition, Math.PI * 0.5),
    new THREE.Vector3(0, 2, -10)
  )
})

test('position transforms round-trip between rotating and inertial frames', () => {
  const rotatingPosition = new THREE.Vector3(8, -4, 3)
  const inertialPosition = rotatingPositionToInertial(rotatingPosition, 1.2)

  expectVectorCloseTo(inertialPositionToRotating(inertialPosition, 1.2), rotatingPosition)
})

test('rotatingVelocityToInertial adds transport velocity from frame rotation', () => {
  const rotatingPosition = new THREE.Vector3(10, 0, 0)
  const rotatingVelocity = new THREE.Vector3(0, 0, -3)

  expectVectorCloseTo(
    rotatingVelocityToInertial(rotatingPosition, rotatingVelocity, 2, 0),
    new THREE.Vector3(0, 0, -23)
  )
})

test('velocity transforms round-trip between rotating and inertial frames', () => {
  const rotatingPosition = new THREE.Vector3(6, 1, -4)
  const rotatingVelocity = new THREE.Vector3(2, -0.5, -7)
  const frameAngle = 0.9
  const omega = 1.4
  const inertialPosition = rotatingPositionToInertial(rotatingPosition, frameAngle)
  const inertialVelocity = rotatingVelocityToInertial(
    rotatingPosition,
    rotatingVelocity,
    omega,
    frameAngle
  )

  expectVectorCloseTo(inertialVelocityToRotating(inertialPosition, inertialVelocity, omega, frameAngle), rotatingVelocity)
})

test('orientation transforms round-trip between rotating and inertial frames', () => {
  const rotatingOrientation = new THREE.Quaternion().setFromEuler(new THREE.Euler(0.2, -0.7, 0.1))
  const inertialOrientation = rotatingOrientationToInertial(rotatingOrientation, 0.9)

  expect(inertialOrientationToRotating(inertialOrientation, 0.9).angleTo(rotatingOrientation)).toBeLessThan(1e-6)
})

test('constant inertial orientation appears to counter-rotate in the rotating frame', () => {
  const inertialOrientation = new THREE.Quaternion()
  const rotatingOrientation = inertialOrientationToRotating(inertialOrientation, Math.PI * 0.5)
  const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(rotatingOrientation)

  expectVectorCloseTo(forward, new THREE.Vector3(1, 0, 0))
})
