import { describe, expect, test } from 'bun:test'

import {
  getDaylight,
  stepDayNightPhase
} from './dayNight'

describe('stepDayNightPhase', () => {
  test('advances proportionally to elapsed time', () => {
    expect(stepDayNightPhase(0, 45, 180)).toBeCloseTo(0.25, 9)
  })

  test('wraps past a full cycle', () => {
    expect(stepDayNightPhase(0.9, 36, 180)).toBeCloseTo(0.1, 9)
  })

  test('a non-positive cycle length pauses the clock', () => {
    expect(stepDayNightPhase(0.4, 10, 0)).toBe(0.4)
    expect(stepDayNightPhase(0.4, 10, -5)).toBe(0.4)
  })

  test('ignores negative time steps', () => {
    expect(stepDayNightPhase(0.4, -10, 180)).toBeCloseTo(0.4, 9)
  })
})

describe('getDaylight', () => {
  test('is dark at midnight and bright at noon', () => {
    expect(getDaylight(0)).toBeCloseTo(0, 9)
    expect(getDaylight(0.5)).toBeCloseTo(1, 9)
    expect(getDaylight(1)).toBeCloseTo(0, 9)
  })

  test('stays within [0, 1] and is symmetric around noon', () => {
    for (let phase = 0; phase <= 1; phase += 0.05) {
      const daylight = getDaylight(phase)
      expect(daylight).toBeGreaterThanOrEqual(0)
      expect(daylight).toBeLessThanOrEqual(1)
    }

    expect(getDaylight(0.3)).toBeCloseTo(getDaylight(0.7), 9)
  })
})
