import { expect, test } from 'bun:test'
import * as THREE from 'three'

import { Accelerometer } from './accelerometer'

const DT = 1 / 60

test('a body at rest in inertial space reads zero felt gravity', () => {
  const accel = new Accelerometer(0.05)
  const pos = new THREE.Vector3(3200, 0, 0)
  const v = new THREE.Vector3(0, 0, 0)
  let reading = 0
  for (let i = 0; i < 200; i += 1) {
    reading = accel.sample(v, pos, DT)
  }
  // No acceleration -> no normal force -> weightless (the spin-cancelled case).
  expect(reading).toBeCloseTo(0, 3)
})

test('circular motion reads the centripetal pseudo-gravity v^2 / r', () => {
  const accel = new Accelerometer(0.05)
  const r = 3200
  const omega = 0.0554 // ~Izma
  const v = new THREE.Vector3()
  const pos = new THREE.Vector3()
  let reading = 0
  for (let i = 0; i < 600; i += 1) {
    const angle = omega * i * DT
    pos.set(Math.cos(angle) * r, 0, Math.sin(angle) * r)
    v.set(-Math.sin(angle) * r * omega, 0, Math.cos(angle) * r * omega)
    reading = accel.sample(v, pos, DT)
  }
  // Felt gravity = omega^2 r ~= 9.82 m/s^2 (~1g), purely from the rotating
  // velocity vector — the standing-on-the-wall case, measured not asserted.
  expect(reading).toBeCloseTo(omega * omega * r, 0)
})

test('a purely tangential acceleration does not register as gravity', () => {
  // Position pinned on +x (outward = +x); velocity ramps along +z (tangential).
  // The throttle push is orthogonal to "down", so felt gravity stays ~0.
  const accel = new Accelerometer(0.05)
  const pos = new THREE.Vector3(3200, 0, 0)
  const v = new THREE.Vector3()
  let reading = 0
  for (let i = 0; i < 300; i += 1) {
    v.z += 36 * DT
    reading = accel.sample(v, pos, DT)
  }
  expect(reading).toBeCloseTo(0, 2)
})

test('resync re-seeds without differencing the discontinuity into a spike', () => {
  const accel = new Accelerometer(0.05)
  const pos = new THREE.Vector3(3200, 0, 0)
  const onWall = new THREE.Vector3(0, 0, 177)
  for (let i = 0; i < 100; i += 1) {
    accel.sample(onWall, pos, DT)
  }
  // The body the meter follows swaps to one with a wildly different velocity.
  accel.resync()
  const afterResync = accel.sample(new THREE.Vector3(-150, 30, 0), pos, DT)
  expect(afterResync).toBeLessThan(1)
})
