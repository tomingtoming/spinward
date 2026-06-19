import { describe, expect, test } from 'bun:test'

import {
  DEFAULT_INTRO_REVEAL,
  introRevealDurationSeconds,
  introRevealPitch,
  type IntroRevealConfig
} from './introReveal'

const CONFIG: IntroRevealConfig = {
  riseSeconds: 1.5,
  holdSeconds: 2,
  fallSeconds: 1.5,
  peakPitch: 0.8
}

describe('introRevealDurationSeconds', () => {
  test('is the sum of rise, hold and fall', () => {
    expect(introRevealDurationSeconds(CONFIG)).toBeCloseTo(5)
    expect(introRevealDurationSeconds()).toBeCloseTo(
      DEFAULT_INTRO_REVEAL.riseSeconds +
        DEFAULT_INTRO_REVEAL.holdSeconds +
        DEFAULT_INTRO_REVEAL.fallSeconds
    )
  })
})

describe('introRevealPitch', () => {
  test('is zero before the reveal starts', () => {
    expect(introRevealPitch(0, CONFIG)).toBe(0)
    expect(introRevealPitch(-1, CONFIG)).toBe(0)
  })

  test('reaches the peak at the end of the rise and holds it', () => {
    expect(introRevealPitch(CONFIG.riseSeconds, CONFIG)).toBeCloseTo(CONFIG.peakPitch)
    expect(introRevealPitch(CONFIG.riseSeconds + 1, CONFIG)).toBeCloseTo(CONFIG.peakPitch)
    expect(
      introRevealPitch(CONFIG.riseSeconds + CONFIG.holdSeconds - 0.001, CONFIG)
    ).toBeCloseTo(CONFIG.peakPitch)
  })

  test('rises monotonically from zero to the peak', () => {
    let previous = -1
    for (let t = 0; t <= CONFIG.riseSeconds; t += CONFIG.riseSeconds / 10) {
      const pitch = introRevealPitch(t, CONFIG)
      expect(pitch).toBeGreaterThanOrEqual(previous)
      expect(pitch).toBeLessThanOrEqual(CONFIG.peakPitch + 1e-9)
      previous = pitch
    }
  })

  test('falls back to the horizon by the end and stays there', () => {
    const duration = introRevealDurationSeconds(CONFIG)
    const midFall = CONFIG.riseSeconds + CONFIG.holdSeconds + CONFIG.fallSeconds / 2
    const midPitch = introRevealPitch(midFall, CONFIG)
    expect(midPitch).toBeGreaterThan(0)
    expect(midPitch).toBeLessThan(CONFIG.peakPitch)
    expect(introRevealPitch(duration, CONFIG)).toBeCloseTo(0)
    expect(introRevealPitch(duration + 5, CONFIG)).toBe(0)
  })

  test('never exceeds the configured peak', () => {
    const duration = introRevealDurationSeconds(CONFIG)
    for (let t = 0; t <= duration; t += 0.05) {
      expect(introRevealPitch(t, CONFIG)).toBeLessThanOrEqual(CONFIG.peakPitch + 1e-9)
    }
  })
})
