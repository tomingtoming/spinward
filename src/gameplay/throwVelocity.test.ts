import { expect, test } from 'bun:test'
import * as THREE from 'three'

import { applyMinForwardBias, computeThrowVelocityReal, MIN_FORWARD_FRACTION } from './throwVelocity'
import { readRapierVectorAsReal, scaleVector3ForRapier } from '../physics/rapierBoundary'

const expectVectorCloseTo = (actual: THREE.Vector3, expected: THREE.Vector3) => {
  expect(actual.x).toBeCloseTo(expected.x, 6)
  expect(actual.y).toBeCloseTo(expected.y, 6)
  expect(actual.z).toBeCloseTo(expected.z, 6)
}

test('throw velocity stays invariant in real space across sim scales', () => {
  const carrierVelocity = new THREE.Vector3(0.4, 0.1, -0.2)
  const controllerVelocity = new THREE.Vector3(1.2, -0.3, 0.8)
  const forward = new THREE.Vector3(0, 0, -1)
  const realThrowVelocity = computeThrowVelocityReal(
    carrierVelocity,
    controllerVelocity,
    forward,
    0.6,
    1.4
  )

  const izmaSimVelocity = scaleVector3ForRapier(realThrowVelocity, 0.02)
  const elysiumSimVelocity = scaleVector3ForRapier(realThrowVelocity, 0.005)

  expect(izmaSimVelocity.z / elysiumSimVelocity.z).toBeCloseTo(4, 6)
  expectVectorCloseTo(
    readRapierVectorAsReal(izmaSimVelocity, 0.02),
    realThrowVelocity
  )
  expectVectorCloseTo(
    readRapierVectorAsReal(elysiumSimVelocity, 0.005),
    realThrowVelocity
  )
})

test('forward bias redirects a pure-sideways swing toward forward', () => {
  const carrierVelocity = new THREE.Vector3(0, 0, 0)
  const controllerVelocity = new THREE.Vector3(5, 0, 0)
  const forward = new THREE.Vector3(0, 0, -1)
  const result = computeThrowVelocityReal(
    carrierVelocity,
    controllerVelocity,
    forward,
    0,
    1
  )

  const forwardDot = -result.z
  expect(forwardDot).toBeGreaterThan(result.length() * 0.3)
  expect(result.length()).toBeCloseTo(5, 4)
})

test('forward bias preserves direction when already forward-dominant', () => {
  const carrierVelocity = new THREE.Vector3(0, 0, 0)
  const controllerVelocity = new THREE.Vector3(0.5, 0, -8)
  const forward = new THREE.Vector3(0, 0, -1)
  const result = computeThrowVelocityReal(
    carrierVelocity,
    controllerVelocity,
    forward,
    0,
    1
  )

  expect(result.z).toBeCloseTo(-8, 0)
  expect(result.x).toBeCloseTo(0.5, 0)
})

test('forward bias corrects a backward throw', () => {
  const velocity = new THREE.Vector3(0, 0, 4)
  const forward = new THREE.Vector3(0, 0, -1)

  applyMinForwardBias(velocity, forward, MIN_FORWARD_FRACTION)

  expect(velocity.dot(forward)).toBeGreaterThan(0)
  expect(velocity.length()).toBeCloseTo(4, 4)
})

test('forward bias is a no-op when disabled', () => {
  const velocity = new THREE.Vector3(3, 0, 2)
  const forward = new THREE.Vector3(0, 0, -1)
  const before = velocity.clone()

  applyMinForwardBias(velocity, forward, 0)

  expectVectorCloseTo(velocity, before)
})
