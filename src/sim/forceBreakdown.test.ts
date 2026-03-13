import { expect, test } from 'bun:test'
import * as THREE from 'three'

import { computeForceBreakdown } from './forceBreakdown'

const expectVectorCloseTo = (actual: THREE.Vector3, expected: THREE.Vector3) => {
  expect(actual.x).toBeCloseTo(expected.x, 6)
  expect(actual.y).toBeCloseTo(expected.y, 6)
  expect(actual.z).toBeCloseTo(expected.z, 6)
}

test('computeForceBreakdown separates centrifugal and coriolis terms', () => {
  const breakdown = computeForceBreakdown(1, new THREE.Vector3(10, 0, 0), new THREE.Vector3(0, 0, -2))

  expectVectorCloseTo(breakdown.angularVelocity, new THREE.Vector3(0, 1, 0))
  expectVectorCloseTo(breakdown.centrifugal, new THREE.Vector3(10, 0, 0))
  expectVectorCloseTo(breakdown.coriolis, new THREE.Vector3(4, 0, 0))
  expectVectorCloseTo(breakdown.total, new THREE.Vector3(14, 0, 0))
})

test('computeForceBreakdown reuses the provided target vectors when supplied', () => {
  const breakdown = computeForceBreakdown(
    2,
    new THREE.Vector3(3, 0, 4),
    new THREE.Vector3(1, 0, 0),
    {
      angularVelocity: new THREE.Vector3(),
      centrifugal: new THREE.Vector3(),
      coriolis: new THREE.Vector3(),
      total: new THREE.Vector3()
    }
  )

  expect(breakdown.angularVelocity.y).toBe(2)
  expect(breakdown.total.length()).toBeGreaterThan(0)
})
