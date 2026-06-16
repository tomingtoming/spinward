import { expect, test } from 'bun:test'

import { createHoldToggleState, mapVrDriveInput, stepHoldToggleState } from './xrInputMap'

test('stepHoldToggleState fires once after the hold threshold and re-arms after release', () => {
  const state = createHoldToggleState()

  expect(stepHoldToggleState(state, true, 0.2, 0.4)).toBe(false)
  expect(stepHoldToggleState(state, true, 0.2, 0.4)).toBe(true)
  expect(stepHoldToggleState(state, true, 0.2, 0.4)).toBe(false)
  expect(stepHoldToggleState(state, false, 0.1, 0.4)).toBe(false)
  expect(stepHoldToggleState(state, true, 0.4, 0.4)).toBe(true)
})

test('mapVrDriveInput: stick up = forward, right = steer right, grip = brake', () => {
  // xr-standard thumbstick Y is negative when pushed up.
  expect(mapVrDriveInput(0, -1, 0).throttle).toBeCloseTo(1, 6) // up = gas
  expect(mapVrDriveInput(0, 1, 0).throttle).toBeCloseTo(-1, 6) // down = reverse
  expect(mapVrDriveInput(1, 0, 0).steer).toBeCloseTo(1, 6) // right
  expect(mapVrDriveInput(-1, 0, 0).steer).toBeCloseTo(-1, 6) // left
  expect(mapVrDriveInput(0, 0, 0.8).brake).toBeCloseTo(0.8, 6)
  expect(mapVrDriveInput(0, 0, 5).brake).toBe(1) // clamped
})

test('mapVrDriveInput: small stick jitter inside the deadzone is ignored', () => {
  expect(mapVrDriveInput(0.1, -0.1, 0).throttle).toBe(0)
  expect(mapVrDriveInput(0.1, -0.1, 0).steer).toBe(0)
})
