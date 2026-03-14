import { expect, test } from 'bun:test'
import * as THREE from 'three'

import { Ball } from './ball'
import { initRapier } from '../physics/rapierContext'
import { createRotatingCylinderBody } from '../physics/rotatingCylinder'
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
      habitatRadius: 100,
      habitatLength: 100,
      omega,
      frameAngleEnd: frameAngle,
      trailMode: 'both'
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
    habitatRadius: 100,
    habitatLength: 100,
    omega,
    frameAngleEnd: frameAngle + omega * deltaSeconds,
    trailMode: 'both'
  })

  expectVectorCloseTo(
    ball.position,
    inertialPositionToRotating(expectedInertialPosition, frameAngle + omega * deltaSeconds)
  )
  expectVectorCloseTo(ball.velocity, expectedRotatingVelocity)

  ball.dispose()
  world.free()
})

test('Ball charge color brightens as the held launch speed increases', async () => {
  const rapier = await initRapier()
  const world = new rapier.World({ x: 0, y: 0, z: 0 })
  let now = 0

  const ball = new Ball({
    physics: {
      rapier,
      world,
      restitution: 0.4
    },
    initialPosition: new THREE.Vector3(3, 0.5, 0),
    maxTrailPoints: 16,
    lifetimeSeconds: 30,
    frameAngle: 0,
    omega: 0,
    nowSeconds: () => now
  })

  ball.grabTarget.onGrabStart?.({} as THREE.XRTargetRaySpace)
  const startColor = ball.mesh.material.color.clone()
  const startEmissive = ball.mesh.material.emissive.clone()

  now = 1.2
  ball.step({
    deltaSeconds: 1 / 60,
    habitatRadius: 100,
    habitatLength: 100,
    omega: 0,
    frameAngleEnd: 0,
    trailMode: 'both'
  })

  expect(ball.mesh.material.color.equals(startColor)).toBe(false)
  expect(ball.mesh.material.emissive.equals(startEmissive)).toBe(false)
  expect(ball.mesh.material.color.b).toBeGreaterThan(startColor.b)

  ball.dispose()
  world.free()
})

test('Ball keeps the charged launch color after release', async () => {
  const rapier = await initRapier()
  const world = new rapier.World({ x: 0, y: 0, z: 0 })
  let now = 0

  const ball = new Ball({
    physics: {
      rapier,
      world,
      restitution: 0.4
    },
    initialPosition: new THREE.Vector3(3, 0.5, 0),
    maxTrailPoints: 16,
    lifetimeSeconds: 30,
    frameAngle: 0,
    omega: 0,
    nowSeconds: () => now
  })

  ball.grabTarget.onGrabStart?.({} as THREE.XRTargetRaySpace)
  now = 1.2
  ball.step({
    deltaSeconds: 1 / 60,
    habitatRadius: 100,
    habitatLength: 100,
    omega: 0,
    frameAngleEnd: 0,
    trailMode: 'both'
  })
  const chargedColor = ball.mesh.material.color.clone()

  ball.grabTarget.onGrabEnd?.({} as THREE.XRTargetRaySpace)

  expect(ball.mesh.material.color.equals(chargedColor)).toBe(true)

  ball.dispose()
  world.free()
})

test('Ball collides with the colony inner wall in Rapier', async () => {
  const rapier = await initRapier()
  const world = new rapier.World({ x: 0, y: 0, z: 0 })
  const cylinder = createRotatingCylinderBody(rapier, world, {
    radius: 10,
    length: 20
  })
  const ball = new Ball({
    physics: {
      rapier,
      world,
      restitution: 0.4
    },
    initialPosition: new THREE.Vector3(9.2, 0.5, 0),
    maxTrailPoints: 16,
    lifetimeSeconds: 30,
    frameAngle: 0,
    omega: 0
  })

  ball.setVelocity(new THREE.Vector3(4, 0, 0))

  for (let index = 0; index < 20; index += 1) {
    cylinder.syncToFrame(0)
    world.timestep = 1 / 60
    world.step()
    ball.step({
      deltaSeconds: 1 / 60,
      habitatRadius: 10,
      habitatLength: 20,
      omega: 0,
      frameAngleEnd: 0,
      trailMode: 'both'
    })
  }

  expect(Math.hypot(ball.position.x, ball.position.z)).toBeLessThan(10.3)
  expect(ball.velocity.x).toBeLessThan(0)

  ball.dispose()
  cylinder.dispose()
  world.free()
})

test('Ball can show rotating and inertial trails at the same time', async () => {
  const rapier = await initRapier()
  const world = new rapier.World({ x: 0, y: 0, z: 0 })
  const ball = new Ball({
    physics: {
      rapier,
      world,
      restitution: 0.4
    },
    initialPosition: new THREE.Vector3(8, 0.5, 0),
    initialVelocity: new THREE.Vector3(0, 0, -4),
    maxTrailPoints: 16,
    lifetimeSeconds: 30,
    frameAngle: 0.4,
    omega: 0.8
  })

  world.timestep = 0.1
  world.step()
  ball.step({
    deltaSeconds: 0.1,
    habitatRadius: 100,
    habitatLength: 100,
    omega: 0.8,
    frameAngleEnd: 0.48,
    trailMode: 'both'
  })

  expect(ball.trail.visible).toBe(true)
  expect(ball.inertialTrail.visible).toBe(true)
  expect(ball.trail.geometry.getAttribute('position').count).toBeGreaterThan(1)
  expect(ball.inertialTrail.geometry.getAttribute('position').count).toBeGreaterThan(1)

  ball.dispose()
  world.free()
})

test('Ball trail visibility follows the selected frame mode', async () => {
  const rapier = await initRapier()
  const world = new rapier.World({ x: 0, y: 0, z: 0 })
  const ball = new Ball({
    physics: {
      rapier,
      world,
      restitution: 0.4
    },
    initialPosition: new THREE.Vector3(8, 0.5, 0),
    initialVelocity: new THREE.Vector3(0, 0, -4),
    maxTrailPoints: 16,
    lifetimeSeconds: 30,
    frameAngle: 0.4,
    omega: 0.8
  })

  world.timestep = 0.1
  world.step()
  ball.step({
    deltaSeconds: 0.1,
    habitatRadius: 100,
    habitatLength: 100,
    omega: 0.8,
    frameAngleEnd: 0.48,
    trailMode: 'rotating'
  })
  expect(ball.trail.visible).toBe(true)
  expect(ball.inertialTrail.visible).toBe(false)

  world.step()
  ball.step({
    deltaSeconds: 0.1,
    habitatRadius: 100,
    habitatLength: 100,
    omega: 0.8,
    frameAngleEnd: 0.56,
    trailMode: 'inertial'
  })
  expect(ball.trail.visible).toBe(false)
  expect(ball.inertialTrail.visible).toBe(true)

  ball.dispose()
  world.free()
})

test('Ball keeps the same real collision result across sim scales', async () => {
  const rapier = await initRapier()
  const izmaWorld = new rapier.World({ x: 0, y: 0, z: 0 })
  const elysiumWorld = new rapier.World({ x: 0, y: 0, z: 0 })
  const izmaCylinder = createRotatingCylinderBody(rapier, izmaWorld, {
    radius: 3200,
    length: 40000,
    simScale: 0.02
  })
  const elysiumCylinder = createRotatingCylinderBody(rapier, elysiumWorld, {
    radius: 3200,
    length: 40000,
    simScale: 0.005
  })
  const initialPosition = new THREE.Vector3(3199.2, 0.5, 0)
  const initialVelocity = new THREE.Vector3(12, 0, 0)

  const izmaBall = new Ball({
    physics: {
      rapier,
      world: izmaWorld,
      restitution: 0.4,
      simScale: 0.02
    },
    initialPosition,
    maxTrailPoints: 16,
    lifetimeSeconds: 30,
    frameAngle: 0,
    omega: 0
  })
  const elysiumBall = new Ball({
    physics: {
      rapier,
      world: elysiumWorld,
      restitution: 0.4,
      simScale: 0.005
    },
    initialPosition,
    maxTrailPoints: 16,
    lifetimeSeconds: 30,
    frameAngle: 0,
    omega: 0
  })

  izmaBall.setVelocity(initialVelocity)
  elysiumBall.setVelocity(initialVelocity)

  for (let index = 0; index < 24; index += 1) {
    izmaCylinder.syncToFrame(0)
    elysiumCylinder.syncToFrame(0)
    izmaWorld.timestep = 1 / 60
    elysiumWorld.timestep = 1 / 60
    izmaWorld.step()
    elysiumWorld.step()
    izmaBall.step({
      deltaSeconds: 1 / 60,
      habitatRadius: 3200,
      habitatLength: 40000,
      omega: 0,
      frameAngleEnd: 0,
      trailMode: 'both'
    })
    elysiumBall.step({
      deltaSeconds: 1 / 60,
      habitatRadius: 3200,
      habitatLength: 40000,
      omega: 0,
      frameAngleEnd: 0,
      trailMode: 'both'
    })
  }

  expect(izmaBall.position.distanceTo(elysiumBall.position)).toBeLessThan(0.05)
  expect(izmaBall.velocity.distanceTo(elysiumBall.velocity)).toBeLessThan(0.05)

  izmaBall.dispose()
  elysiumBall.dispose()
  izmaCylinder.dispose()
  elysiumCylinder.dispose()
  izmaWorld.free()
  elysiumWorld.free()
})
