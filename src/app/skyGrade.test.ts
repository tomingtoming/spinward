import { expect, test } from 'bun:test'

import {
  DEFAULT_SKY_LOOK,
  IZMA_SKY_LOOK,
  getInitialDayNightPhase,
  getSkyLook,
  sampleSkyGrade
} from './skyGrade'

test('sampleSkyGrade returns a key colour exactly at that key phase', () => {
  // 0.5 is the Izma noon key. t=0 there, so it reproduces it exactly.
  const grade = sampleSkyGrade(0.5, IZMA_SKY_LOOK)
  expect(grade.fog.getHex()).toBe(0x8fa9bf)
  expect(grade.background.getHex()).toBe(0x0a1622)
  expect(grade.sunGlowScale).toBeCloseTo(1.0, 5)
  expect(grade.exposure).toBeCloseTo(1.2, 5)
})

test('sampleSkyGrade interpolates between two keys', () => {
  // Between Izma noon (0.5) and dusk (0.75) the haze darkens monotonically.
  const noon = sampleSkyGrade(0.5, IZMA_SKY_LOOK).fog.r
  const mid = sampleSkyGrade(0.625, IZMA_SKY_LOOK).fog.r
  const dusk = sampleSkyGrade(0.75, IZMA_SKY_LOOK).fog.r
  expect(mid).toBeLessThan(noon)
  expect(mid).toBeGreaterThan(dusk)
})

test('sampleSkyGrade wraps across the midnight seam', () => {
  // 0.875 sits between the last key (0.75) and the first (0.0 -> wraps to 1.0),
  // so the haze keeps darkening toward midnight; the glow scale stays neutral.
  const grade = sampleSkyGrade(0.875, IZMA_SKY_LOOK)
  const dusk = sampleSkyGrade(0.75, IZMA_SKY_LOOK).fog.r
  const midnight = sampleSkyGrade(0.0, IZMA_SKY_LOOK).fog.r
  expect(grade.fog.r).toBeLessThan(dusk)
  expect(grade.fog.r).toBeGreaterThan(midnight)
  expect(grade.sunGlowScale).toBeCloseTo(1.0, 5)
})

test('default look reproduces the legacy cool endpoints', () => {
  expect(sampleSkyGrade(0.0, DEFAULT_SKY_LOOK).fog.getHex()).toBe(0x1b2530)
  expect(sampleSkyGrade(0.5, DEFAULT_SKY_LOOK).fog.getHex()).toBe(0x728ba0)
  // Symmetric: dawn (0.25) and dusk (0.75) grade identically, as before.
  expect(sampleSkyGrade(0.25, DEFAULT_SKY_LOOK).fog.getHex()).toBe(
    sampleSkyGrade(0.75, DEFAULT_SKY_LOOK).fog.getHex()
  )
})

test('Izma grade is physically honest: neutral haze, symmetric, steady Sol disk', () => {
  // A cylinder colony has no planetary limb, so dusk is not an Earth sunset. The
  // haze must not be pushed warm/red, dawn and dusk must read identically, and
  // the visible Sun keeps a steady Sol-white disk with no dusk halo swell.
  const dusk = sampleSkyGrade(0.84, IZMA_SKY_LOOK)
  // Cool-neutral aerial haze: blue is never below red (no warm/red sunset cast).
  expect(dusk.fog.b).toBeGreaterThanOrEqual(dusk.fog.r)
  // Symmetric: dawn (0.25) and dusk (0.75) grade identically.
  expect(sampleSkyGrade(0.25, IZMA_SKY_LOOK).fog.getHex()).toBe(
    sampleSkyGrade(0.75, IZMA_SKY_LOOK).fog.getHex()
  )
  // The Sun never reddens or swells its halo across the day.
  for (const phase of [0.0, 0.25, 0.5, 0.75]) {
    const grade = sampleSkyGrade(phase, IZMA_SKY_LOOK)
    expect(grade.sunCore.getHex()).toBe(0xfff6ee)
    expect(grade.sunGlowScale).toBeCloseTo(1.0, 5)
  }
})

test('getSkyLook maps ids and falls back to the cool default', () => {
  expect(getSkyLook('izma')).toBe(IZMA_SKY_LOOK)
  expect(getSkyLook('default')).toBe(DEFAULT_SKY_LOOK)
  expect(getSkyLook('elysium')).toBe(DEFAULT_SKY_LOOK)
  expect(getInitialDayNightPhase('izma')).toBeCloseTo(0.84, 5)
  expect(getInitialDayNightPhase('default')).toBeCloseTo(DEFAULT_SKY_LOOK.initialPhase, 5)
})
