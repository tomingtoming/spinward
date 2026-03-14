import { expect, test } from 'bun:test'
import * as THREE from 'three'

import { computeThrowVelocityReal } from './throwVelocity'
import { readRapierVectorAsReal, scaleVector3ForRapier } from '../physics/rapierBoundary'

const expectVectorCloseTo = (actual: THREE.Vector3, expected: THREE.Vector3) => {
  expect(actual.x).toBeCloseTo(expected.x, 6)
  expect(actual.y).toBeCloseTo(expected.y, 6)
  expect(actual.z).toBeCloseTo(expected.z, 6)
}

test('throw velocity stays invariant in real space across sim scales', () => {
  const controllerVelocity = new THREE.Vector3(1.2, -0.3, 0.8)
  const forward = new THREE.Vector3(0, 0, -1)
  const realThrowVelocity = computeThrowVelocityReal(controllerVelocity, forward, 0.6, 1.4)

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
