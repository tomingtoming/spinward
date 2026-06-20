import { expect, test } from 'bun:test'
import * as THREE from 'three'

import { Ball } from './ball'
import { initRapier, type RapierModule } from '../physics/rapierContext'
import { inertialPositionToRotating } from '../sim/frameTransforms'
import { rpmToOmega } from '../units/units'

// End-to-end Coriolis landing test.
//
// DigiSapo (the Unity O'Neill-cylinder sim author at
// https://plaza14.biz/sitio_digisapo/20190919-unity3d-oneill-space-colony-simulator/)
// published the closed form for how long a ball thrown off the floor takes to
// come back down inside a spinning habitat:
//
//   t = 2 R Vy / ((R*omega + Vx)^2 + Vy^2)
//
// where R is the launch radius, omega the spin rate, Vy the radial ("up", toward
// axis) throw speed and Vx the tangential (spinward) throw speed, all measured in
// the rotating frame. R*omega is the floor's co-rotating surface speed.
//
// It is exact for a zero-gravity inertial cylinder: a released ball flies a
// straight inertial chord and we solve for when its radius returns to R. Spinward
// uses exactly that model (zero-gravity Rapier world + the transport term added in
// the rotating->inertial transform), so the real Ball must land where the formula
// says. This test flies a real Rapier ball BLIND (without feeding it the answer)
// and checks the landing time and spot against DigiSapo's oracle.

const digisapoLandingTime = (R: number, omega: number, Vy: number, Vx: number) =>
  (2 * R * Vy) / ((R * omega + Vx) ** 2 + Vy ** 2)

// Analytic landing point in the ROTATING frame (what a colonist standing on the
// floor sees), derived straight from the inertial straight-chord model.
const predictLanding = (R: number, omega: number, Vy: number, Vx: number) => {
  const t = digisapoLandingTime(R, omega, Vy, Vx)
  // Launch at inertial (R, 0, 0) with frameAngle 0. The inertial release velocity
  // carries the floor transport speed: radial -Vy along x, tangential -(R*omega+Vx)
  // along z (spinward is -z at this point). Straight-line flight for time t:
  const inertialLanding = new THREE.Vector3(R - Vy * t, 0, -(R * omega + Vx) * t)
  // The floor (and the rotating view) has turned by omega*t in the meantime.
  const rotatingLanding = inertialPositionToRotating(inertialLanding, omega * t)
  // Spinward = the floor's travel direction (-z here), i.e. decreasing azimuth.
  const spinwardDrift = -Math.atan2(rotatingLanding.z, rotatingLanding.x) * R
  return { t, rotatingLanding, spinwardDrift }
}

// Run the real sim blind: throw the ball, step Rapier, and detect the instant its
// rotating-frame radius climbs back to R after dipping inward. Never tells the sim
// the predicted time.
const simulateLanding = async (
  rapier: RapierModule,
  R: number,
  omega: number,
  Vy: number,
  Vx: number
): Promise<{ time: number; landing: THREE.Vector3 }> => {
  const world = new rapier.World({ x: 0, y: 0, z: 0 })
  const deltaSeconds = 1 / 120
  // Put the inner wall far away so the ball is in pure free flight the whole arc
  // (no wall bounce) — the "landing" we detect is the return to launch radius R.
  const farWall = R * 100

  const ball = new Ball({
    physics: { rapier, world, restitution: 0.4 },
    initialPosition: new THREE.Vector3(R, 0, 0),
    maxTrailPoints: 8,
    lifetimeSeconds: 120,
    frameAngle: 0,
    omega
  })
  // Rotating-frame throw: Vy radially inward (-x = toward the axis), Vx spinward
  // (the floor moves toward -z at this launch point).
  ball.setVelocity(new THREE.Vector3(-Vy, 0, -Vx))

  let elapsed = 0
  let frameAngle = 0
  let previousRadius = Math.hypot(ball.position.x, ball.position.z)
  let previousPosition = ball.position.clone()
  let dipped = false
  let result: { time: number; landing: THREE.Vector3 } | null = null

  for (let step = 0; step < 1000; step += 1) {
    frameAngle += omega * deltaSeconds
    world.timestep = deltaSeconds
    world.step()
    ball.step({
      deltaSeconds,
      habitatRadius: farWall,
      habitatLength: farWall,
      omega,
      frameAngleEnd: frameAngle,
      trailMode: 'both'
    })
    elapsed += deltaSeconds
    const radius = Math.hypot(ball.position.x, ball.position.z)

    if (dipped && previousRadius < R && radius >= R) {
      const fraction = (R - previousRadius) / (radius - previousRadius)
      result = {
        time: elapsed - deltaSeconds + fraction * deltaSeconds,
        landing: previousPosition.clone().lerp(ball.position, fraction)
      }
      break
    }
    if (radius < R - 1e-4) dipped = true
    previousRadius = radius
    previousPosition.copy(ball.position)
  }

  ball.dispose()
  world.free()
  if (result === null) throw new Error('ball never returned to the floor radius')
  return result
}

test("Thrown ball lands where DigiSapo's Coriolis formula predicts (spinward drift)", async () => {
  const rapier = await initRapier()
  const R = 18 // m — Spinward "playground" habitat radius (DEFAULT_HABITAT_CONFIG)
  const omega = rpmToOmega(5) // 0.5236 rad/s -> floor speed R*omega = 9.42 m/s (~0.5 g)
  const Vy = 7 // m/s radial-up toss

  // Vx is the tangential (spinward) component of the throw. Every case drifts
  // SPINWARD — the ball lands ahead in the spin direction, never back in the hand:
  //   Vx =  0 -> t ~ 1.83 s, ~5.77 m spinward
  //   Vx = +2 -> t ~ 1.40 s, ~6.56 m spinward
  //   Vx = -2 -> t ~ 2.42 s, ~4.41 m spinward
  for (const Vx of [0, 2, -2]) {
    const predicted = predictLanding(R, omega, Vy, Vx)
    const observed = await simulateLanding(rapier, R, omega, Vy, Vx)

    // 1) The real Rapier ball returns to the floor at the time the closed form predicts.
    expect(Math.abs(observed.time - predicted.t)).toBeLessThan(0.02)
    // 2) It comes back to floor radius R.
    expect(Math.hypot(observed.landing.x, observed.landing.z)).toBeCloseTo(R, 1)
    // 3) It lands on the exact spot the formula predicts (within 20 cm).
    expect(observed.landing.distanceTo(predicted.rotatingLanding)).toBeLessThan(0.2)
    // 4) The drift is SPINWARD (positive = ahead in the spin direction) and the right size.
    const observedDrift = -Math.atan2(observed.landing.z, observed.landing.x) * R
    expect(observedDrift).toBeGreaterThan(0)
    expect(Math.abs(observedDrift - predicted.spinwardDrift)).toBeLessThan(0.2)
  }
})
