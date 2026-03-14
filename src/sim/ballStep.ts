import * as THREE from 'three'

import { confineSphereToCylinder, confineSphereToRotatingCylinder } from './cylinderCollision'
import { integrateSemiImplicitEuler } from './integrator'
import { computeAngularVelocity, computeRotatingFrameAcceleration } from './rotatingFrame'

export type BallState = {
  position: THREE.Vector3
  velocity: THREE.Vector3
  radius: number
}

export type BallStepConfig = {
  deltaSeconds: number
  radius: number
  length: number
  omega: number
  restitution: number
}

export type InertialBallStepConfig = BallStepConfig & {
  frameAngleStart: number
  frameAngleEnd: number
  capEnds?: boolean
}

const angularVelocity = new THREE.Vector3()
const acceleration = new THREE.Vector3()
const zeroAcceleration = new THREE.Vector3()

export const advanceBallState = (ball: BallState, config: BallStepConfig) => {
  computeAngularVelocity(config.omega, angularVelocity)
  computeRotatingFrameAcceleration(
    angularVelocity,
    ball.position,
    ball.velocity,
    acceleration
  )

  integrateSemiImplicitEuler(ball.position, ball.velocity, acceleration, config.deltaSeconds)

  return confineSphereToCylinder(ball.position, ball.velocity, {
    radius: config.radius,
    length: config.length,
    sphereRadius: ball.radius,
    restitution: config.restitution
  })
}

export const advanceInertialBallState = (ball: BallState, config: InertialBallStepConfig) => {
  // Once the ball is in the inertial frame, free flight is just constant-velocity motion.
  integrateSemiImplicitEuler(ball.position, ball.velocity, zeroAcceleration, config.deltaSeconds)

  return confineSphereToRotatingCylinder(ball.position, ball.velocity, {
    radius: config.radius,
    length: config.length,
    sphereRadius: ball.radius,
    restitution: config.restitution,
    omega: config.omega,
    capEnds: config.capEnds
  })
}
