import { expect, test } from 'bun:test'
import * as THREE from 'three'

import { initRapier } from './rapierContext'
import { createRotatingCylinderBody } from './rotatingCylinder'
import {
  applyWorldLengthUnit,
  createRigidBodyAtRealPose,
  readRigidBodyPoseAsReal,
  scaleLengthForRapier
} from './rapierBoundary'
import { Accelerometer } from '../sim/accelerometer'
import { inertialPositionToRotating } from '../sim/frameTransforms'
import { createUnitsContext, periodToOmega } from '../units/units'

// P1 de-risk gate: prove the city can become REAL co-rotating Rapier colliders.
// The make-or-break is the centre of mass. Buildings are not rotationally
// symmetric, so putting their colliders on a spinning kinematic body lets
// Rapier's collider-derived COM drift off the axis — and then the contact
// surface velocity reads wrong and friction-brakes anything resting on them
// (the very trap the wall panel ring dodges by staying symmetric). Pinning the
// body's COM to the axis fixes it. Everything runs at Izma scale.
const IZMA_RADIUS = 3200
const IZMA_OMEGA = periodToOmega(113.5)
const IZMA_SIM_SCALE = 0.02
const Y_AXIS = new THREE.Vector3(0, 1, 0)

type TestBuilding = {
  azimuth: number
  axial: number
  width: number // tangential
  depth: number // axial
  height: number // radial, inward from the floor
}

// A co-rotating kinematic body carrying building cuboids. Local axes per box:
// X = radial (height), Y = axial (depth), Z = tangential (width) — the same
// frame the wall panels use. Density 0 so the boxes add no mass; the COM pin
// keeps the body's centre of mass on the spin axis.
const createCoRotatingBuildings = (
  rapier: Awaited<ReturnType<typeof initRapier>>,
  world: InstanceType<Awaited<ReturnType<typeof initRapier>>['World']>,
  units: ReturnType<typeof createUnitsContext>,
  buildings: TestBuilding[],
  omega: number,
  options: { pinCenterOfMass: boolean }
) => {
  const s = (meters: number) => scaleLengthForRapier(meters, units)
  let desc = rapier.RigidBodyDesc.kinematicVelocityBased()
  if (options.pinCenterOfMass) {
    desc = desc.setAdditionalMassProperties(
      1,
      { x: 0, y: 0, z: 0 },
      { x: 1, y: 1, z: 1 },
      { x: 0, y: 0, z: 0, w: 1 }
    )
  }
  const body = world.createRigidBody(desc)

  for (const b of buildings) {
    const centerRadial = IZMA_RADIUS - b.height / 2
    const rotation = new THREE.Quaternion().setFromAxisAngle(Y_AXIS, -b.azimuth)
    world.createCollider(
      rapier.ColliderDesc.cuboid(s(b.height / 2), s(b.depth / 2), s(b.width / 2))
        .setTranslation(
          s(Math.cos(b.azimuth) * centerRadial),
          s(b.axial),
          s(Math.sin(b.azimuth) * centerRadial)
        )
        .setRotation({ x: rotation.x, y: rotation.y, z: rotation.z, w: rotation.w })
        .setFriction(1.0)
        .setRestitution(0.05)
        .setDensity(0),
      body
    )
  }

  body.setAngvel({ x: 0, y: omega, z: 0 }, true)
  return body
}

// An asymmetric skyline: a broad flat roof at azimuth 0 plus a lopsided cluster
// of towers off to one side, so a collider-derived COM would clearly drift.
const skyline = (): TestBuilding[] => {
  const buildings: TestBuilding[] = [{ azimuth: 0, axial: 0, width: 200, depth: 200, height: 30 }]
  for (let i = 0; i < 30; i += 1) {
    buildings.push({ azimuth: 0.3 + i * 0.003, axial: 0, width: 16, depth: 16, height: 60 })
  }
  return buildings
}

// Settle a co-rotating sphere just inside the flat roof (radius - 30) and report
// whether the roof held it.
const restOnRoof = async (pinCenterOfMass: boolean) => {
  const rapier = await initRapier()
  const world = new rapier.World({ x: 0, y: 0, z: 0 })
  const units = createUnitsContext(IZMA_SIM_SCALE)
  applyWorldLengthUnit(world, units)
  world.maxCcdSubsteps = 4

  createCoRotatingBuildings(rapier, world, units, skyline(), IZMA_OMEGA, { pinCenterOfMass })

  const roofRadius = IZMA_RADIUS - 30
  const sphereRadius = 0.5
  const restRadial = roofRadius - sphereRadius
  const startRadial = restRadial - 0.3
  const body = createRigidBodyAtRealPose(
    world,
    rapier.RigidBodyDesc.dynamic()
      .setGravityScale(0)
      .setLinearDamping(0)
      .lockRotations()
      .setCanSleep(false)
      .setCcdEnabled(false),
    {
      position: new THREE.Vector3(startRadial, 0, 0),
      linearVelocity: new THREE.Vector3(0, 0, -IZMA_OMEGA * startRadial)
    },
    units
  )
  world.createCollider(
    rapier.ColliderDesc.ball(scaleLengthForRapier(sphereRadius, units))
      .setFriction(0.3)
      .setFrictionCombineRule(rapier.CoefficientCombineRule.Min)
      .setDensity(0.6)
      .setRestitution(0.05),
    body
  )

  const accelerometer = new Accelerometer()
  const dt = 1 / 60
  const pose = { position: new THREE.Vector3(), linearVelocity: new THREE.Vector3() }
  let feltGravity = 0
  let minRadial = Infinity
  let maxRadial = -Infinity
  let finalSpeed = 0

  for (let i = 0; i < Math.round(8 / dt); i += 1) {
    world.timestep = dt
    world.step()
    readRigidBodyPoseAsReal(body, units, pose)
    feltGravity = accelerometer.sample(pose.linearVelocity, pose.position, dt)
    finalSpeed = pose.linearVelocity.length()
    const radial = Math.hypot(pose.position.x, pose.position.z)
    if (i * dt > 1) {
      minRadial = Math.min(minRadial, radial)
      maxRadial = Math.max(maxRadial, radial)
    }
  }

  world.free()
  return { restRadial, roofRadius, minRadial, maxRadial, feltGravity, finalSpeed, coRotationSpeed: IZMA_OMEGA * startRadial }
}

test('a co-rotating body rests on a real building roof at the measured spin gravity', async () => {
  const probe = await restOnRoof(true)
  const expectedG = IZMA_OMEGA * IZMA_OMEGA * probe.restRadial

  // Held on the roof (just inside the inner face), co-rotation kept, felt weight
  // is the real ~1g normal force the roof provides — emergent, not omega^2 R.
  expect(probe.maxRadial).toBeLessThan(probe.roofRadius + 0.2)
  expect(probe.minRadial).toBeGreaterThan(probe.restRadial - 1)
  expect(probe.finalSpeed).toBeGreaterThan(0.9 * probe.coRotationSpeed)
  expect(probe.feltGravity).toBeGreaterThan(0.85 * expectedG)
  expect(probe.feltGravity).toBeLessThan(1.15 * expectedG)
})

test('without the COM pin the asymmetric skyline breaks the roof contact', async () => {
  // The load-bearing control: collider-derived COM drifts off-axis, the roof
  // surface velocity reads wrong, and the body is dragged off into a decaying
  // orbit feeling ~no gravity. This is why the pin is mandatory.
  const probe = await restOnRoof(false)
  expect(probe.minRadial).toBeLessThan(probe.restRadial - 50)
  expect(probe.feltGravity).toBeLessThan(0.2 * IZMA_OMEGA * IZMA_OMEGA * probe.restRadial)
})

test('a real building blocks a body driving into its side', async () => {
  // Compare tangential progress with and without the building: the wall must
  // stop the body well short of where it would coast unobstructed.
  const driveAtBuilding = async (withBuilding: boolean) => {
    const rapier = await initRapier()
    const world = new rapier.World({ x: 0, y: 0, z: 0 })
    const units = createUnitsContext(IZMA_SIM_SCALE)
    applyWorldLengthUnit(world, units)
    world.maxCcdSubsteps = 4

    // The wall holds the body on the floor; without it a faster-than-co-rotation
    // body just flies outward past the building's roof and never touches it.
    const wall = createRotatingCylinderBody(rapier, world, {
      radius: IZMA_RADIUS,
      length: 40000,
      units
    })
    wall.setAngularVelocity(IZMA_OMEGA)

    if (withBuilding) {
      createCoRotatingBuildings(
        rapier,
        world,
        units,
        [{ azimuth: 0.04, axial: 0, width: 200, depth: 200, height: 60 }],
        IZMA_OMEGA,
        { pinCenterOfMass: true }
      )
    }

    const sphereRadius = 0.5
    const restRadial = IZMA_RADIUS - sphereRadius
    const extraTangential = 25
    const body = createRigidBodyAtRealPose(
      world,
      rapier.RigidBodyDesc.dynamic()
        .setGravityScale(0)
        .setLinearDamping(0)
        .lockRotations()
        .setCanSleep(false)
        .setCcdEnabled(false),
      {
        // At (r,0,0) co-rotation is (0,0,-w r); +tangent is +z, so add +extra.
        position: new THREE.Vector3(restRadial, 0, 0),
        linearVelocity: new THREE.Vector3(0, 0, -IZMA_OMEGA * restRadial + extraTangential)
      },
      units
    )
    world.createCollider(
      rapier.ColliderDesc.ball(scaleLengthForRapier(sphereRadius, units))
        .setFriction(0.3)
        .setFrictionCombineRule(rapier.CoefficientCombineRule.Min)
        .setDensity(0.6)
        .setRestitution(0.05),
      body
    )

    const dt = 1 / 60
    const steps = Math.round(4 / dt)
    const pose = { position: new THREE.Vector3(), linearVelocity: new THREE.Vector3() }
    for (let i = 0; i < steps; i += 1) {
      world.timestep = dt
      world.step()
    }
    readRigidBodyPoseAsReal(body, units, pose)
    world.free()
    // Measure in the ROTATING frame (where the building is fixed), else the
    // co-rotation transport sweeps the inertial azimuth and hides the relative
    // approach. The body spun the world by omega*steps*dt.
    const rotating = inertialPositionToRotating(pose.position, IZMA_OMEGA * steps * dt)
    return Math.atan2(rotating.z, rotating.x) * IZMA_RADIUS
  }

  const blocked = await driveAtBuilding(true)
  const free = await driveAtBuilding(false)

  // The building's near side sits at 0.04*3200 - 100 = 28 m; the body is stopped
  // there, while unobstructed it coasts well past it.
  expect(blocked).toBeLessThan(35)
  expect(free).toBeGreaterThan(60)
  expect(free).toBeGreaterThan(blocked + 25)
})
