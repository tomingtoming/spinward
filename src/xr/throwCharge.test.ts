import { expect, test } from 'bun:test'

import {
  computeThrowChargeSpeed,
  DEFAULT_THROW_CHARGE_SECONDS,
  DEFAULT_THROW_CHARGE_SPEED
} from './throwCharge'

test('computeThrowChargeSpeed starts at zero relative speed', () => {
  expect(computeThrowChargeSpeed(0, 1)).toBe(0)
  expect(computeThrowChargeSpeed(-0.2, 1)).toBe(0)
})

test('computeThrowChargeSpeed ramps up with held time and clamps at full charge', () => {
  expect(computeThrowChargeSpeed(DEFAULT_THROW_CHARGE_SECONDS * 0.5, 1)).toBeCloseTo(
    DEFAULT_THROW_CHARGE_SPEED * 0.5,
    6
  )
  expect(computeThrowChargeSpeed(DEFAULT_THROW_CHARGE_SECONDS * 2, 1.5)).toBeCloseTo(
    DEFAULT_THROW_CHARGE_SPEED * 1.5,
    6
  )
})
