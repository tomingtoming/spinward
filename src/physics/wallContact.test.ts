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
import { createUnitsContext, periodToOmega } from '../units/units'

// P0 de-risk gate for the Rapier physicalization plan: prove the EXISTING
// kinematic spinning panel ring can carry a body on real solver contact —
// no analytic ground-follow, no linvel overwrite. If this holds, grounding,
// spin-gravity and felt-G can all become emergent (Option A). If it fails,
// fall back to a local tracking-floor patch (Option C).
//
// Everything runs at Izma scale, the demo's opening preset and the hardest
// case: a 0.02 sim scale and a wall whose inner surface sweeps past at ~177
// m/s. The numbers are the real ones from presets.ts.
const IZMA_RADIUS = 3200
const IZMA_LENGTH = 40000
const IZMA_OMEGA = periodToOmega(113.5)
const IZMA_SIM_SCALE = 0.02
// The felt gravity that SHOULD emerge from contact, never fed into the sim.
const EXPECTED_G = IZMA_OMEGA * IZMA_OMEGA * IZMA_RADIUS // ~9.81 m/s^2
const WALL_TRANSPORT_SPEED = IZMA_OMEGA * IZMA_RADIUS // ~177 m/s

type ContactProbe = {
  expectedRestRadial: number
  minRadial: number
  maxRadial: number
  feltGravity: number
  finalSpeed: number
  coRotationSpeed: number
  angularTravel: number
  escaped: boolean
}

// Drop a dynamic sphere onto the inner wall, co-rotating with it (a body at
// rest on the floor orbits with the spin), and let Rapier's solver — not any
// analytic clamp — decide whether the wall holds it. Report what emerged.
const settleSphereOnWall = async (options: {
  sphereRadius: number
  ccd: boolean
  friction: number
  frictionMin?: boolean
  density?: number
  restitution?: number
  // 1 = perfectly co-rotating (standing still). >1 drifts forward across the
  // panel seams, exercising seam crossing under real contact.
  tangentialFactor?: number
  seconds?: number
}): Promise<ContactProbe> => {
  const rapier = await initRapier()
  const world = new rapier.World({ x: 0, y: 0, z: 0 })
  const units = createUnitsContext(IZMA_SIM_SCALE)
  applyWorldLengthUnit(world, IZMA_SIM_SCALE)
  world.maxCcdSubsteps = 4

  const wall = createRotatingCylinderBody(rapier, world, {
    radius: IZMA_RADIUS,
    length: IZMA_LENGTH,
    units
  })
  // Velocity-driven (not syncToFrame): the kinematic body genuinely spins, so
  // its contact surface carries the 177 m/s transport. This is exactly how
  // habitatRuntime drives it in production.
  wall.setAngularVelocity(IZMA_OMEGA)

  const expectedRestRadial = IZMA_RADIUS - options.sphereRadius
  const tangentialFactor = options.tangentialFactor ?? 1
  // Start a touch inside the wall so the first contact forms from a gentle
  // outward drift instead of an initial overlap depenetration kick.
  const startRadial = expectedRestRadial - 0.3
  const coRotationSpeed = IZMA_OMEGA * startRadial
  // At (r, 0, 0) the co-rotation transport velocity is omega x r = (0,0,-wr).
  const initialPosition = new THREE.Vector3(startRadial, 0, 0)
  const initialVelocity = new THREE.Vector3(0, 0, -coRotationSpeed * tangentialFactor)

  const body = createRigidBodyAtRealPose(
    world,
    rapier.RigidBodyDesc.dynamic()
      .setGravityScale(0)
      .setLinearDamping(0)
      .lockRotations()
      .setCanSleep(false)
      .setCcdEnabled(options.ccd),
    { position: initialPosition, linearVelocity: initialVelocity },
    units
  )

  let colliderDesc = rapier.ColliderDesc.ball(
    scaleLengthForRapier(options.sphereRadius, units)
  )
    .setFriction(options.friction)
    .setRestitution(options.restitution ?? 0.05)
    .setDensity(options.density ?? 0.6)
  if (options.frictionMin) {
    colliderDesc = colliderDesc.setFrictionCombineRule(rapier.CoefficientCombineRule.Min)
  }
  world.createCollider(colliderDesc, body)

  const accelerometer = new Accelerometer()
  const dt = 1 / 60
  const steps = Math.round((options.seconds ?? 8) / dt)
  const pose = { position: new THREE.Vector3(), linearVelocity: new THREE.Vector3() }

  let minRadial = Infinity
  let maxRadial = -Infinity
  let feltGravity = 0
  let finalSpeed = 0
  let escaped = false
  let prevAzimuth = Math.atan2(initialPosition.z, initialPosition.x)
  let angularTravel = 0

  for (let i = 0; i < steps; i += 1) {
    world.timestep = dt
    world.step()
    readRigidBodyPoseAsReal(body, units, pose)

    const radial = Math.hypot(pose.position.x, pose.position.z)
    feltGravity = accelerometer.sample(pose.linearVelocity, pose.position, dt)
    finalSpeed = pose.linearVelocity.length()

    // The body center can never pass the wall's outer face; if it does, the
    // contact tunnelled and the body is free-flying outward.
    if (radial > IZMA_RADIUS + 5) {
      escaped = true
    }

    // Skip the first second so the settling transient doesn't pollute the
    // steady-state envelope or the felt-G reading.
    if (i * dt > 1) {
      minRadial = Math.min(minRadial, radial)
      maxRadial = Math.max(maxRadial, radial)
    }

    const azimuth = Math.atan2(pose.position.z, pose.position.x)
    let delta = azimuth - prevAzimuth
    while (delta > Math.PI) delta -= Math.PI * 2
    while (delta < -Math.PI) delta += Math.PI * 2
    angularTravel += delta
    prevAzimuth = azimuth
  }

  world.removeRigidBody(body)
  wall.dispose()
  world.free()

  return {
    expectedRestRadial,
    minRadial,
    maxRadial,
    feltGravity,
    finalSpeed,
    coRotationSpeed,
    angularTravel: Math.abs(angularTravel),
    escaped
  }
}

test(
  'the spinning panel ring carries a co-rotating car and ~1g emerges from contact (CCD off)',
  async () => {
    // Faithful to the production car collider: sphere r=0.5, friction 0.3 with
    // the Min combine rule, density 0.6, CCD off.
    const probe = await settleSphereOnWall({
      sphereRadius: 0.5,
      ccd: false,
      friction: 0.3,
      frictionMin: true,
      density: 0.6,
      restitution: 0.05,
      seconds: 8
    })

    // Held on the wall: never tunnels out, never falls inward off the floor.
    expect(probe.escaped).toBe(false)
    expect(probe.maxRadial).toBeLessThan(IZMA_RADIUS + 0.3)
    expect(probe.minRadial).toBeGreaterThan(probe.expectedRestRadial - 1.5)

    // Co-rotation is NOT friction-braked: the panel ring's COM stays on the
    // axis, so the contact surface reads the true 177 m/s transport and the
    // relative slip is ~0. (The COM-on-axis trap would bleed this toward 0.)
    expect(probe.finalSpeed).toBeGreaterThan(0.9 * probe.coRotationSpeed)

    // The headline: felt gravity emerges, measured by differencing the
    // Rapier-integrated inertial velocity — never computed as omega^2 R.
    expect(probe.feltGravity).toBeGreaterThan(0.8 * EXPECTED_G)
    expect(probe.feltGravity).toBeLessThan(1.2 * EXPECTED_G)
  },
  20000
)

test(
  'CCD on still holds the body — the 177 m/s transport is not misread as an impact',
  async () => {
    // Balls run CCD on; confirm a CCD body resting on the moving wall is not
    // spuriously kicked by the swept transport surface.
    const probe = await settleSphereOnWall({
      sphereRadius: 0.5,
      ccd: true,
      friction: 0.3,
      frictionMin: true,
      density: 0.6,
      restitution: 0.05,
      seconds: 8
    })

    expect(probe.escaped).toBe(false)
    expect(probe.maxRadial).toBeLessThan(IZMA_RADIUS + 0.3)
    expect(probe.minRadial).toBeGreaterThan(probe.expectedRestRadial - 1.5)
    expect(probe.finalSpeed).toBeGreaterThan(0.9 * probe.coRotationSpeed)
    expect(probe.feltGravity).toBeGreaterThan(0.8 * EXPECTED_G)
    expect(probe.feltGravity).toBeLessThan(1.2 * EXPECTED_G)
  },
  20000
)

test(
  'a body drifting across panel seams stays grounded — no seam launch, no parking',
  async () => {
    // 4% faster than co-rotation: the body advances across the panel seams
    // (relative to the spinning wall) while friction slowly pulls it back to
    // co-rotation. The seam fixes in rotatingCylinder.ts must keep it from
    // being launched off the floor or snagged to a halt.
    const probe = await settleSphereOnWall({
      sphereRadius: 0.5,
      ccd: false,
      friction: 0.3,
      frictionMin: true,
      density: 0.6,
      restitution: 0.05,
      tangentialFactor: 1.04,
      seconds: 8
    })

    // Not launched into the air at a seam.
    expect(probe.escaped).toBe(false)
    expect(probe.maxRadial).toBeLessThan(IZMA_RADIUS + 0.4)
    // Stays on the floor while crossing seams.
    expect(probe.minRadial).toBeGreaterThan(probe.expectedRestRadial - 1.5)
    // Kept orbiting (did not park at a seam): it traveled a real arc.
    expect(probe.angularTravel).toBeGreaterThan(0.3)
  },
  20000
)

test('sanity: the Izma constants are the real spin-gravity numbers', () => {
  // Guards the test's own premises so a preset edit can't silently soften it.
  expect(EXPECTED_G).toBeGreaterThan(9.6)
  expect(EXPECTED_G).toBeLessThan(10.0)
  expect(WALL_TRANSPORT_SPEED).toBeGreaterThan(170)
  expect(WALL_TRANSPORT_SPEED).toBeLessThan(185)
})
