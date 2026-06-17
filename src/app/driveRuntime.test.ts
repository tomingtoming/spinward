import { expect, test } from 'bun:test'
import * as THREE from 'three'

import { DriveRuntime } from './driveRuntime'
import { applyWorldLengthUnit } from '../physics/rapierBoundary'
import { initRapier } from '../physics/rapierContext'
import { createRotatingCylinderBody } from '../physics/rotatingCylinder'
import { createRotatingCityColliders } from '../physics/rotatingCityColliders'
import { Accelerometer } from '../sim/accelerometer'
import { buildCityCollisionIndex, type CityBuilding } from '../objects/cityLayout'
import { inertialPositionToRotating } from '../sim/frameTransforms'
import { createUnitsContext, periodToOmega } from '../units/units'

// P3: the car's radial axis is Rapier's contact with the spinning wall, not an
// analytic suspension. These drive the REAL DriveRuntime.preStep/postStep loop
// against the Izma panel ring and read the felt-G off the body's measured
// inertial velocity — the same path the app uses.
const IZMA_RADIUS = 3200
const IZMA_LENGTH = 40000
const IZMA_OMEGA = periodToOmega(113.5)
const IZMA_SIM_SCALE = 0.02
const EXPECTED_G = IZMA_OMEGA * IZMA_OMEGA * IZMA_RADIUS // ~9.81 m/s^2

const buildDriveWorld = (rapier: Awaited<ReturnType<typeof initRapier>>) => {
  const world = new rapier.World({ x: 0, y: 0, z: 0 })
  const units = createUnitsContext(IZMA_SIM_SCALE)
  applyWorldLengthUnit(world, units)
  world.maxCcdSubsteps = 4
  const wall = createRotatingCylinderBody(rapier, world, {
    radius: IZMA_RADIUS,
    length: IZMA_LENGTH,
    units
  })
  wall.setAngularVelocity(IZMA_OMEGA)
  const drive = new DriveRuntime()
  drive.rebuild({ rapier, world, units })
  return { world, units, wall, drive }
}

test('a parked car rests on the spinning wall and feels a measured ~1g', async () => {
  const rapier = await initRapier()
  const { world, units, wall, drive } = buildDriveWorld(rapier)

  let frameAngle = 0
  drive.parkAt(0, 0, Math.PI / 2)
  drive.enter(frameAngle, IZMA_OMEGA, IZMA_RADIUS, { rapier, world, units })

  const accelerometer = new Accelerometer()
  const dt = 1 / 60
  let feltGravity = 0

  for (let i = 0; i < Math.round(8 / dt); i += 1) {
    frameAngle = THREE.MathUtils.euclideanModulo(frameAngle + IZMA_OMEGA * dt, Math.PI * 2)
    drive.preStep(
      { throttle: 0, steer: 0, brake: 0 },
      { deltaSeconds: dt, frameAngle, omega: IZMA_OMEGA, radius: IZMA_RADIUS, units }
    )
    world.timestep = dt
    world.step()
    drive.postStep({ frameAngle, units })
    feltGravity = accelerometer.sample(drive.lastInertialVelocity, drive.lastInertialPosition, dt)
  }

  expect(drive.lastGrounded).toBe(true)
  // Held on the wall by contact, not pinned: the body sits one collider radius
  // (~0.5 m) inside the inner face and the felt weight is the real ~1g normal
  // force. A tight band catches a contact-stiffness regression.
  expect(drive.lastRadialGap).toBeGreaterThan(0.3)
  expect(drive.lastRadialGap).toBeLessThan(0.9)
  expect(feltGravity).toBeGreaterThan(0.8 * EXPECTED_G)
  expect(feltGravity).toBeLessThan(1.2 * EXPECTED_G)

  wall.dispose()
  drive.dispose()
  world.free()
})

test('entering the car settles to 1g without a freefall slam', async () => {
  // Regression guard: enter() seats the body at the real contact rest
  // (radius - collider radius). Seating it deeper (the old radius - 0.91) made
  // it free-fall onto the wall on every entry — 0.3 s of 0 g, then a ~1.5 g
  // impact slam and a phantom ~3 m/s standstill speed, all fed to the HUD.
  const rapier = await initRapier()
  const { world, units, wall, drive } = buildDriveWorld(rapier)

  let frameAngle = 0
  drive.parkAt(0, 0, Math.PI / 2)
  drive.enter(frameAngle, IZMA_OMEGA, IZMA_RADIUS, { rapier, world, units })

  const accelerometer = new Accelerometer()
  const dt = 1 / 60
  let peakFeltGravity = 0
  let maxEntrySpeed = 0
  let maxGap = -Infinity
  let feltGravity = 0

  for (let i = 0; i < Math.round(2 / dt); i += 1) {
    frameAngle = THREE.MathUtils.euclideanModulo(frameAngle + IZMA_OMEGA * dt, Math.PI * 2)
    drive.preStep(
      { throttle: 0, steer: 0, brake: 0 },
      { deltaSeconds: dt, frameAngle, omega: IZMA_OMEGA, radius: IZMA_RADIUS, units }
    )
    world.timestep = dt
    world.step()
    drive.postStep({ frameAngle, units })
    feltGravity = accelerometer.sample(drive.lastInertialVelocity, drive.lastInertialPosition, dt)
    peakFeltGravity = Math.max(peakFeltGravity, feltGravity)
    maxEntrySpeed = Math.max(maxEntrySpeed, drive.lastSpeed)
    maxGap = Math.max(maxGap, drive.lastRadialGap)
  }

  // No impact slam (the deep seating spiked to ~1.49 g), no freefall (the gap
  // never starts a metre out and collapses), no phantom standstill speed.
  expect(peakFeltGravity).toBeLessThan(1.2 * EXPECTED_G)
  expect(maxGap).toBeLessThan(0.7)
  expect(maxEntrySpeed).toBeLessThan(1)
  // Settled at a real ~1g.
  expect(feltGravity).toBeGreaterThan(0.85 * EXPECTED_G)
  expect(feltGravity).toBeLessThan(1.15 * EXPECTED_G)

  wall.dispose()
  drive.dispose()
  world.free()
})

test('flooring the car against the spin drains the felt-G toward a real float', async () => {
  const rapier = await initRapier()
  const { world, units, wall, drive } = buildDriveWorld(rapier)

  let frameAngle = 0
  drive.parkAt(0, 0, Math.PI / 2) // heading along +tangent: against the spin
  drive.enter(frameAngle, IZMA_OMEGA, IZMA_RADIUS, { rapier, world, units })

  const accelerometer = new Accelerometer()
  const dt = 1 / 60
  let feltGravity = 0
  let minFeltGravity = Infinity
  let maxSpeed = 0
  let maxGap = -Infinity

  for (let i = 0; i < Math.round(25 / dt); i += 1) {
    frameAngle = THREE.MathUtils.euclideanModulo(frameAngle + IZMA_OMEGA * dt, Math.PI * 2)
    drive.preStep(
      { throttle: 1, steer: 0, brake: 0 },
      { deltaSeconds: dt, frameAngle, omega: IZMA_OMEGA, radius: IZMA_RADIUS, units }
    )
    world.timestep = dt
    world.step()
    drive.postStep({ frameAngle, units })
    feltGravity = accelerometer.sample(drive.lastInertialVelocity, drive.lastInertialPosition, dt)
    maxSpeed = Math.max(maxSpeed, drive.lastSpeed)
    maxGap = Math.max(maxGap, drive.lastRadialGap)
    if (i * dt > 2) {
      minFeltGravity = Math.min(minFeltGravity, feltGravity)
    }
  }

  // The car spins up toward the wall's circumferential speed...
  expect(maxSpeed).toBeGreaterThan(100)
  // ...and as its co-rotation is cancelled the measured felt gravity collapses
  // to a near-float — emergent from the real contact unloading, not a formula.
  expect(minFeltGravity).toBeLessThan(0.15 * EXPECTED_G)
  // It never tunnels out through the wall (gap = radius - radial stays positive
  // and bounded — the body rides the wall, it doesn't lift metres off it).
  expect(maxGap).toBeLessThan(1.2)

  wall.dispose()
  drive.dispose()
  world.free()
})

test('the car stops at a streamed building via real contact (P1), not an analytic clamp', async () => {
  // Drive the real preStep -> cityColliders.update -> step -> postStep loop at
  // a building and compare with an empty city: the building must stream in and
  // stop the car at its near face, and the crash haptic must fire on the hit
  // (and never without a building).
  const driveTowardBuilding = async (withBuilding: boolean) => {
    const rapier = await initRapier()
    const world = new rapier.World({ x: 0, y: 0, z: 0 })
    const units = createUnitsContext(IZMA_SIM_SCALE)
    applyWorldLengthUnit(world, units)
    world.maxCcdSubsteps = 4
    const wall = createRotatingCylinderBody(rapier, world, {
      radius: IZMA_RADIUS,
      length: IZMA_LENGTH,
      units
    })
    wall.setAngularVelocity(IZMA_OMEGA)

    const buildings: CityBuilding[] = withBuilding
      ? [{ azimuth: 0.025, axial: 0, width: 30, depth: 200, height: 60, tone: 0.5, kind: 'block' }]
      : []
    const index = buildCityCollisionIndex(buildings, IZMA_RADIUS, IZMA_LENGTH)
    const city = createRotatingCityColliders(rapier, world, {
      radius: IZMA_RADIUS,
      index,
      units,
      omega: IZMA_OMEGA,
      margin: 0.8
    })

    const drive = new DriveRuntime()
    drive.rebuild({ rapier, world, units })
    let frameAngle = 0
    drive.parkAt(0, 0, Math.PI / 2) // heading +tangent, toward the building
    drive.enter(frameAngle, IZMA_OMEGA, IZMA_RADIUS, { rapier, world, units })

    const dt = 1 / 60
    const steps = Math.round(10 / dt)
    let maxActive = 0
    let crashedFrames = 0
    let maxTangential = -Infinity

    for (let i = 0; i < steps; i += 1) {
      frameAngle = THREE.MathUtils.euclideanModulo(frameAngle + IZMA_OMEGA * dt, Math.PI * 2)
      drive.preStep(
        { throttle: 1, steer: 0, brake: 0 },
        { deltaSeconds: dt, frameAngle, omega: IZMA_OMEGA, radius: IZMA_RADIUS, units }
      )
      maxActive = Math.max(maxActive, city.update(drive.surface.azimuth, drive.surface.axialPosition))
      world.timestep = dt
      world.step()
      drive.postStep({ frameAngle, units })
      if (drive.lastCrashed) crashedFrames += 1
      const rotating = inertialPositionToRotating(drive.lastInertialPosition, frameAngle)
      maxTangential = Math.max(maxTangential, Math.atan2(rotating.z, rotating.x) * IZMA_RADIUS)
    }

    city.dispose()
    wall.dispose()
    drive.dispose()
    world.free()
    return { maxActive, crashedFrames, maxTangential }
  }

  const hit = await driveTowardBuilding(true)
  const clear = await driveTowardBuilding(false)

  // The building streams in, stops the car at its near face (~64 m), and trips
  // the crash haptic.
  expect(hit.maxActive).toBeGreaterThan(0)
  expect(hit.crashedFrames).toBeGreaterThan(0)
  expect(hit.maxTangential).toBeLessThan(80)
  // With an empty city nothing streams, the car coasts far past, and no crash.
  expect(clear.maxActive).toBe(0)
  expect(clear.crashedFrames).toBe(0)
  expect(clear.maxTangential).toBeGreaterThan(200)
})
