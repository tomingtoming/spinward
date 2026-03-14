import { expect, test } from 'bun:test'

import { createHoldToggleState, stepHoldToggleState } from './xrInputMap'

test('stepHoldToggleState fires once after the hold threshold and re-arms after release', () => {
  const state = createHoldToggleState()

  expect(stepHoldToggleState(state, true, 0.2, 0.4)).toBe(false)
  expect(stepHoldToggleState(state, true, 0.2, 0.4)).toBe(true)
  expect(stepHoldToggleState(state, true, 0.2, 0.4)).toBe(false)
  expect(stepHoldToggleState(state, false, 0.1, 0.4)).toBe(false)
  expect(stepHoldToggleState(state, true, 0.4, 0.4)).toBe(true)
})
