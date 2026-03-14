import { expect, test } from 'bun:test'
import * as THREE from 'three'

import { Ball } from './ball'
import { initRapier } from '../physics/rapierContext'
import {
  inertialPositionToRotating,
  inertialVelocityToRotating,
  rotatingPositionToInertial,
  rotatingVelocityToInertial
} from '../sim/frameTransforms'

const expectVectorCloseTo = (actual: THREE.Vector3, expected: THREE.Vector3) => {
  expect(actual.x).toBeCloseTo(expected.x, 4)
  expect(actual.y).toBeCloseTo(expected.y, 4)
  expect(actual.z).toBeCloseTo(expected.z, 4)
}

test('Ball keeps inertial motion in Rapier while curving in the rotating frame', async () => {
  const rapier = await initRapier()
  const world = new rapier.World({ x: 0, y: 0, z: 0 })
  const deltaSeconds = 0.1
  const omega = 0.8
  let frameAngle = 1.1

  const ball = new Ball({
    physics: {
      rapier,
      world,
      restitution: 0.4
    },
    initialPosition: new THREE.Vector3(8, 0.5, 0),
    initialVelocity: new THREE.Vector3(0.2, 0.1, -6),
    maxTrailPoints: 16,
    lifetimeSeconds: 30,
    frameAngle,
    omega
  })
  const expectedInertialPosition = rotatingPositionToInertial(
    new THREE.Vector3(8, 0.5, 0),
    frameAngle
  )
  const expectedInertialVelocity = rotatingVelocityToInertial(
    new THREE.Vector3(8, 0.5, 0),
    new THREE.Vector3(0.2, 0.1, -6),
    omega,
    frameAngle
  )

  for (let index = 0; index < 10; index += 1) {
    frameAngle += omega * deltaSeconds
    expectedInertialPosition.addScaledVector(expectedInertialVelocity, deltaSeconds)
    world.timestep = deltaSeconds
    world.step()
    ball.step({
      deltaSeconds,
      omega,
      frameAngleEnd: frameAngle
    })
  }

  expectVectorCloseTo(ball.position, inertialPositionToRotating(expectedInertialPosition, frameAngle))
  expectVectorCloseTo(
    ball.velocity,
    inertialVelocityToRotating(expectedInertialPosition, expectedInertialVelocity, omega, frameAngle)
  )

  ball.dispose()
  world.free()
})

test('Ball.setVelocity updates the Rapier body using inertial velocity', async () => {
  const rapier = await initRapier()
  const world = new rapier.World({ x: 0, y: 0, z: 0 })
  const deltaSeconds = 0.1
  const omega = 1.2
  const frameAngle = 0.7
  const initialPosition = new THREE.Vector3(3, 0.5, 0)
  const releaseVelocity = new THREE.Vector3(1, 0.2, -2)
  const expectedInertialVelocity = rotatingVelocityToInertial(
    initialPosition,
    releaseVelocity,
    omega,
    frameAngle
  )
  const expectedInertialPosition = rotatingPositionToInertial(initialPosition, frameAngle).addScaledVector(
    expectedInertialVelocity,
    deltaSeconds
  )
  const expectedRotatingVelocity = inertialVelocityToRotating(
    expectedInertialPosition,
    expectedInertialVelocity,
    omega,
    frameAngle + omega * deltaSeconds
  )

  const ball = new Ball({
    physics: {
      rapier,
      world,
      restitution: 0.4
    },
    initialPosition,
    maxTrailPoints: 16,
    lifetimeSeconds: 30,
    frameAngle,
    omega
  })

  ball.setVelocity(releaseVelocity)
  world.timestep = deltaSeconds
  world.step()
  ball.step({
    deltaSeconds,
    omega,
    frameAngleEnd: frameAngle + omega * deltaSeconds
  })

  expectVectorCloseTo(
    ball.position,
    inertialPositionToRotating(expectedInertialPosition, frameAngle + omega * deltaSeconds)
  )
  expectVectorCloseTo(ball.velocity, expectedRotatingVelocity)

  ball.dispose()
  world.free()
})
