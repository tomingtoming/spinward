import { expect, test } from 'bun:test'
import * as THREE from 'three'

import {
  computeAngularVelocity,
  computeCentrifugalAcceleration,
  computeCoriolisAcceleration,
  computeRotatingFrameAcceleration
} from './rotatingFrame'

const expectVectorCloseTo = (actual: THREE.Vector3, expected: THREE.Vector3) => {
  expect(actual.x).toBeCloseTo(expected.x, 6)
  expect(actual.y).toBeCloseTo(expected.y, 6)
  expect(actual.z).toBeCloseTo(expected.z, 6)
}

test('computeAngularVelocity points along the Y axis', () => {
  expectVectorCloseTo(computeAngularVelocity(1.5), new THREE.Vector3(0, 1.5, 0))
})

test('computeCentrifugalAcceleration points away from the rotation axis', () => {
  const omega = new THREE.Vector3(0, 2, 0)
  const position = new THREE.Vector3(10, 0, 0)

  expectVectorCloseTo(computeCentrifugalAcceleration(omega, position), new THREE.Vector3(40, 0, 0))
})

test('computeCoriolisAcceleration bends a forward throw sideways', () => {
  const omega = new THREE.Vector3(0, 1, 0)
  const velocity = new THREE.Vector3(0, 0, -2)

  expectVectorCloseTo(computeCoriolisAcceleration(omega, velocity), new THREE.Vector3(4, 0, 0))
})

test('computeRotatingFrameAcceleration combines centrifugal and coriolis terms', () => {
  const omega = new THREE.Vector3(0, 1, 0)
  const position = new THREE.Vector3(10, 0, 0)
  const velocity = new THREE.Vector3(0, 0, -2)

  expectVectorCloseTo(
    computeRotatingFrameAcceleration(omega, position, velocity),
    new THREE.Vector3(14, 0, 0)
  )
})
