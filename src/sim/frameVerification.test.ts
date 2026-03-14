import { expect, test } from 'bun:test'
import * as THREE from 'three'

import { computeFrameVerification } from './frameVerification'

test('computeFrameVerification matches fictitious acceleration when rotating velocity delta agrees', () => {
  const verification = computeFrameVerification({
    omega: 1,
    rotatingPosition: new THREE.Vector3(10, 0, 0),
    rotatingVelocity: new THREE.Vector3(0, 0, -2),
    previousRotatingVelocity: new THREE.Vector3(-1.4, 0, -2),
    deltaSeconds: 0.1,
    errorThreshold: 0.2
  })

  expect(verification.breakdown.total.x).toBeCloseTo(14, 6)
  expect(verification.estimatedAcceleration.x).toBeCloseTo(14, 6)
  expect(verification.errorMagnitude).toBeLessThan(1e-6)
  expect(verification.warning).toBe(false)
})

test('computeFrameVerification warns when estimated and fictitious acceleration diverge', () => {
  const verification = computeFrameVerification({
    omega: 1,
    rotatingPosition: new THREE.Vector3(10, 0, 0),
    rotatingVelocity: new THREE.Vector3(0, 0, -2),
    previousRotatingVelocity: new THREE.Vector3(0, 0, -2),
    deltaSeconds: 0.1,
    errorThreshold: 0.2
  })

  expect(verification.errorMagnitude).toBeGreaterThan(1)
  expect(verification.warning).toBe(true)
})
