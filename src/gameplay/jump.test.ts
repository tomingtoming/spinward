import { describe, expect, test } from 'bun:test'
import * as THREE from 'three'

import {
  JUMP_ARM_CLEARANCE,
  JUMP_LAND_TOLERANCE,
  beginJump,
  computeJumpLaunchVelocity,
  createJumpState,
  resetJumpState,
  stepJumpState
} from './jump'

describe('computeJumpLaunchVelocity', () => {
  test('points inward (toward the axis) at azimuth 0', () => {
    const velocity = computeJumpLaunchVelocity(0, 3)
    expect(velocity.x).toBeCloseTo(-3)
    expect(velocity.y).toBeCloseTo(0)
    expect(velocity.z).toBeCloseTo(0)
  })

  test('points inward at an arbitrary azimuth', () => {
    const azimuth = Math.PI / 3
    const velocity = computeJumpLaunchVelocity(azimuth, 2)
    const outward = new THREE.Vector3(Math.cos(azimuth), 0, Math.sin(azimuth))
    expect(velocity.dot(outward)).toBeCloseTo(-2)
    expect(velocity.length()).toBeCloseTo(2)
  })
})

describe('stepJumpState', () => {
  test('full jump cycle: launch, rise, land', () => {
    const state = createJumpState()
    beginJump(state)
    expect(state.phase).toBe('launching')

    // Still near the surface right after takeoff: must not land yet.
    expect(
      stepJumpState(state, { mode: 'free-fly', radialError: 0.05 })
    ).toBe(false)
    expect(state.phase).toBe('launching')

    // Rises clear of the arm threshold.
    expect(
      stepJumpState(state, { mode: 'free-fly', radialError: JUMP_ARM_CLEARANCE + 0.1 })
    ).toBe(false)
    expect(state.phase).toBe('airborne')

    // Falls back within landing tolerance.
    expect(
      stepJumpState(state, { mode: 'free-fly', radialError: JUMP_LAND_TOLERANCE - 0.05 })
    ).toBe(true)
    expect(state.phase).toBe('grounded')
  })

  test('landing fires only once', () => {
    const state = createJumpState()
    beginJump(state)
    stepJumpState(state, { mode: 'free-fly', radialError: 1 })
    expect(stepJumpState(state, { mode: 'free-fly', radialError: 0.1 })).toBe(true)
    expect(stepJumpState(state, { mode: 'free-fly', radialError: 0.1 })).toBe(false)
  })

  test('attached mode resets the cycle', () => {
    const state = createJumpState()
    beginJump(state)
    stepJumpState(state, { mode: 'free-fly', radialError: 1 })
    expect(state.phase).toBe('airborne')
    expect(stepJumpState(state, { mode: 'attached', radialError: 0 })).toBe(false)
    expect(state.phase).toBe('grounded')
  })

  test('grounded free-fly (manual detach) never triggers a landing snap', () => {
    const state = createJumpState()
    expect(stepJumpState(state, { mode: 'free-fly', radialError: 0.1 })).toBe(false)
    expect(state.phase).toBe('grounded')
  })

  test('resetJumpState aborts an in-flight jump', () => {
    const state = createJumpState()
    beginJump(state)
    resetJumpState(state)
    expect(stepJumpState(state, { mode: 'free-fly', radialError: 0.1 })).toBe(false)
  })
})
