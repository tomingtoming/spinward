import { describe, expect, test } from 'bun:test'
import * as THREE from 'three'

import {
  EARTH_GRAVITY,
  VEHICLE_TUNING,
  getVehicleGrip,
  stepVehicleDynamics
} from './vehicle'

const basisAtAzimuthZero = () => ({
  axial: new THREE.Vector3(0, 1, 0),
  tangent: new THREE.Vector3(0, 0, 1),
  outward: new THREE.Vector3(1, 0, 0)
})

const idleInput = { throttle: 0, steer: 0, brake: 0 }

describe('getVehicleGrip', () => {
  test('full grip at 1g, none in zero gravity, clamped above', () => {
    expect(getVehicleGrip(EARTH_GRAVITY)).toBeCloseTo(1, 6)
    expect(getVehicleGrip(0)).toBe(0)
    expect(getVehicleGrip(EARTH_GRAVITY * 3)).toBeCloseTo(1.4, 6)
  })
})

describe('stepVehicleDynamics', () => {
  test('throttle accelerates along the heading at 1g', () => {
    const state = { heading: 0 }
    const velocity = new THREE.Vector3()
    stepVehicleDynamics(state, velocity, basisAtAzimuthZero(), {
      throttle: 1,
      steer: 0,
      brake: 0
    }, {
      deltaSeconds: 1,
      surfaceGravity: EARTH_GRAVITY,
      grounded: true
    })

    // heading 0 = +axial
    expect(velocity.y).toBeGreaterThan(VEHICLE_TUNING.maxAcceleration * 0.7)
    expect(Math.abs(velocity.z)).toBeLessThan(1e-6)
  })

  test('zero gravity means zero traction: no thrust, no steering, no grip', () => {
    const state = { heading: 0 }
    const velocity = new THREE.Vector3(0, 4, 3)
    stepVehicleDynamics(state, velocity, basisAtAzimuthZero(), {
      throttle: 1,
      steer: 1,
      brake: 0
    }, {
      deltaSeconds: 0.5,
      surfaceGravity: 0,
      grounded: true
    })

    expect(state.heading).toBeCloseTo(0, 9)
    // Only rolling drag may touch the along component; lateral slip survives.
    expect(velocity.z).toBeCloseTo(3, 6)
  })

  test('lateral slip decays fast at 1g (the car corners instead of sliding)', () => {
    const state = { heading: 0 }
    const velocity = new THREE.Vector3(0, 6, 5)
    stepVehicleDynamics(state, velocity, basisAtAzimuthZero(), idleInput, {
      deltaSeconds: 0.5,
      surfaceGravity: EARTH_GRAVITY,
      grounded: true
    })

    expect(Math.abs(velocity.z)).toBeLessThan(0.2)
    expect(velocity.y).toBeGreaterThan(5)
  })

  test('airborne wheels do nothing', () => {
    const state = { heading: 0.4 }
    const velocity = new THREE.Vector3(2, 5, -3)
    const before = velocity.clone()
    const grip = stepVehicleDynamics(state, velocity, basisAtAzimuthZero(), {
      throttle: 1,
      steer: -1,
      brake: 1
    }, {
      deltaSeconds: 0.5,
      surfaceGravity: EARTH_GRAVITY,
      grounded: false
    })

    expect(grip).toBe(0)
    expect(state.heading).toBeCloseTo(0.4, 9)
    expect(velocity.equals(before)).toBe(true)
  })

  test('braking stops at zero without reversing', () => {
    const state = { heading: 0 }
    const velocity = new THREE.Vector3(0, 1.5, 0)
    stepVehicleDynamics(state, velocity, basisAtAzimuthZero(), {
      throttle: 0,
      steer: 0,
      brake: 1
    }, {
      deltaSeconds: 1,
      surfaceGravity: EARTH_GRAVITY,
      grounded: true
    })

    expect(velocity.y).toBeCloseTo(0, 6)
  })

  test('steering turns the heading only while moving', () => {
    const state = { heading: 0 }
    const still = new THREE.Vector3()
    stepVehicleDynamics(state, still, basisAtAzimuthZero(), {
      throttle: 0,
      steer: 1,
      brake: 0
    }, {
      deltaSeconds: 1,
      surfaceGravity: EARTH_GRAVITY,
      grounded: true
    })
    expect(state.heading).toBeCloseTo(0, 9)

    const moving = new THREE.Vector3(0, 10, 0)
    stepVehicleDynamics(state, moving, basisAtAzimuthZero(), {
      throttle: 0,
      steer: 1,
      brake: 0
    }, {
      deltaSeconds: 0.5,
      surfaceGravity: EARTH_GRAVITY,
      grounded: true
    })
    expect(state.heading).toBeGreaterThan(0.5)
  })

  test('the radial component is left to the physics engine', () => {
    const state = { heading: 0 }
    const velocity = new THREE.Vector3(2.5, 4, 0)
    stepVehicleDynamics(state, velocity, basisAtAzimuthZero(), idleInput, {
      deltaSeconds: 0.25,
      surfaceGravity: EARTH_GRAVITY,
      grounded: true
    })

    expect(velocity.x).toBeCloseTo(2.5, 6)
  })
})
