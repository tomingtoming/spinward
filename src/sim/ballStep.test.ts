import { expect, test } from 'bun:test'
import * as THREE from 'three'

import { advanceBallState, advanceInertialBallState } from './ballStep'
import { inertialPositionToRotating, inertialVelocityToRotating, rotatingPositionToInertial, rotatingVelocityToInertial } from './frameTransforms'

test('advanceBallState curves a forward throw inside the rotating frame', () => {
  const position = new THREE.Vector3(8, 0, 0)
  const velocity = new THREE.Vector3(0, 0, -6)

  for (let index = 0; index < 10; index += 1) {
    advanceBallState(
      {
        position,
        velocity,
        radius: 0.2
      },
      {
        deltaSeconds: 0.1,
        radius: 10,
        length: 40,
        omega: 1,
        restitution: 0.4
      }
    )
  }

  expect(position.x).toBeGreaterThan(8)
  expect(position.z).toBeLessThan(-3.5)
})

test('advanceBallState keeps the ball center inside the cylinder after collision', () => {
  const position = new THREE.Vector3(9.7, 0, 0)
  const velocity = new THREE.Vector3(5, 0, 0)

  advanceBallState(
    {
      position,
      velocity,
      radius: 0.5
    },
    {
      deltaSeconds: 0.1,
      radius: 10,
      length: 40,
      omega: 0,
      restitution: 0.5
    }
  )

  expect(position.length()).toBeLessThanOrEqual(9.5)
  expect(velocity.x).toBeLessThan(0)
})

test('advanceInertialBallState still bends the visible path in the rotating frame', () => {
  let frameAngle = 1.1
  const deltaSeconds = 0.1
  const omega = 0.8
  const rotatingPosition = new THREE.Vector3(8, 0.5, 0)
  const rotatingVelocity = new THREE.Vector3(0.2, 0.1, -6)
  const inertialPosition = rotatingPositionToInertial(rotatingPosition, frameAngle)
  const inertialVelocity = rotatingVelocityToInertial(
    rotatingPosition,
    rotatingVelocity,
    omega,
    frameAngle
  )

  for (let index = 0; index < 10; index += 1) {
    const frameAngleStart = frameAngle
    frameAngle += omega * deltaSeconds

    advanceInertialBallState(
      {
        position: inertialPosition,
        velocity: inertialVelocity,
        radius: 0.2
      },
      {
        deltaSeconds,
        radius: 10,
        length: 40,
        omega,
        restitution: 0.4,
        frameAngleStart,
        frameAngleEnd: frameAngle
      }
    )
  }

  const actualPosition = inertialPositionToRotating(inertialPosition, frameAngle)

  expect(actualPosition.x).toBeGreaterThan(8.3)
  expect(actualPosition.z).toBeLessThan(-3.5)
})

test('advanceInertialBallState keeps inertial velocity constant away from the wall', () => {
  const frameAngleStart = 0.7
  const deltaSeconds = 0.1
  const omega = 1.2
  const frameAngleEnd = frameAngleStart + omega * deltaSeconds
  const rotatingPosition = new THREE.Vector3(3, 0.5, 0)
  const rotatingVelocity = new THREE.Vector3(1, 0.2, -2)
  const inertialPosition = rotatingPositionToInertial(rotatingPosition, frameAngleStart)
  const inertialVelocity = rotatingVelocityToInertial(
    rotatingPosition,
    rotatingVelocity,
    omega,
    frameAngleStart
  )
  const expectedPosition = inertialPosition.clone().addScaledVector(inertialVelocity, deltaSeconds)
  const expectedVelocity = inertialVelocity.clone()

  advanceInertialBallState(
    {
      position: inertialPosition,
      velocity: inertialVelocity,
      radius: 0.2
    },
    {
      deltaSeconds,
      radius: 10,
      length: 40,
      omega,
      restitution: 0.4,
      frameAngleStart,
      frameAngleEnd
    }
  )

  expect(inertialPosition.x).toBeCloseTo(expectedPosition.x, 6)
  expect(inertialPosition.y).toBeCloseTo(expectedPosition.y, 6)
  expect(inertialPosition.z).toBeCloseTo(expectedPosition.z, 6)
  expect(inertialVelocity.x).toBeCloseTo(expectedVelocity.x, 6)
  expect(inertialVelocity.y).toBeCloseTo(expectedVelocity.y, 6)
  expect(inertialVelocity.z).toBeCloseTo(expectedVelocity.z, 6)
})

test('advanceInertialBallState can carry a ball out through the cylinder opening', () => {
  const frameAngleStart = 0.2
  const deltaSeconds = 0.1
  const omega = 1.2
  const frameAngleEnd = frameAngleStart + omega * deltaSeconds
  const rotatingPosition = new THREE.Vector3(0, 9.6, 0)
  const rotatingVelocity = new THREE.Vector3(0, 4, 0)
  const inertialPosition = rotatingPositionToInertial(rotatingPosition, frameAngleStart)
  const inertialVelocity = rotatingVelocityToInertial(
    rotatingPosition,
    rotatingVelocity,
    omega,
    frameAngleStart
  )

  advanceInertialBallState(
    {
      position: inertialPosition,
      velocity: inertialVelocity,
      radius: 0.2
    },
    {
      deltaSeconds,
      radius: 10,
      length: 20,
      omega,
      restitution: 0.4,
      frameAngleStart,
      frameAngleEnd,
      capEnds: false
    }
  )

  const visiblePosition = inertialPositionToRotating(inertialPosition, frameAngleEnd)

  expect(visiblePosition.y).toBeGreaterThan(9.8)
})
