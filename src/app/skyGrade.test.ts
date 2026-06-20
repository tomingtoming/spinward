import { expect, test } from 'bun:test'

import {
  DEFAULT_SKY_LOOK,
  IZMA_SKY_LOOK,
  getInitialDayNightPhase,
  getSkyLook,
  sampleSkyGrade
} from './skyGrade'

test('sampleSkyGrade returns a key colour exactly at that key phase', () => {
  // 0.84 is a real Izma key (golden hour). t=0 there, so it should reproduce it.
  const grade = sampleSkyGrade(0.84, IZMA_SKY_LOOK)
  expect(grade.fog.getHex()).toBe(0xd99a63)
  expect(grade.background.getHex()).toBe(0x261826)
  expect(grade.sunGlowScale).toBeCloseTo(1.8, 5)
  expect(grade.exposure).toBeCloseTo(1.34, 5)
})

test('sampleSkyGrade interpolates between two keys', () => {
  // Halfway between Izma keys 0.78 and 0.84.
  const grade = sampleSkyGrade(0.81, IZMA_SKY_LOOK)
  expect(grade.sunGlowScale).toBeCloseTo((1.4 + 1.8) / 2, 5)
  expect(grade.exposure).toBeCloseTo((1.28 + 1.34) / 2, 5)
})

test('sampleSkyGrade wraps across the midnight seam', () => {
  // 0.97 sits between the last key (0.94) and the first (0.00 -> wraps to 1.0).
  const grade = sampleSkyGrade(0.97, IZMA_SKY_LOOK)
  // exposure between 1.22 (at 0.94) and 1.18 (at 0.00); 0.97 is halfway.
  expect(grade.exposure).toBeCloseTo((1.22 + 1.18) / 2, 5)
  expect(grade.sunGlowScale).toBeCloseTo((1.5 + 1.0) / 2, 5)
})

test('default look reproduces the legacy cool endpoints', () => {
  expect(sampleSkyGrade(0.0, DEFAULT_SKY_LOOK).fog.getHex()).toBe(0x1b2530)
  expect(sampleSkyGrade(0.5, DEFAULT_SKY_LOOK).fog.getHex()).toBe(0x728ba0)
  // Symmetric: dawn (0.25) and dusk (0.75) grade identically, as before.
  expect(sampleSkyGrade(0.25, DEFAULT_SKY_LOOK).fog.getHex()).toBe(
    sampleSkyGrade(0.75, DEFAULT_SKY_LOOK).fog.getHex()
  )
})

test('Izma dusk haze is warmer (redder) than the default cool look', () => {
  const phase = IZMA_SKY_LOOK.initialPhase
  const izma = sampleSkyGrade(phase, IZMA_SKY_LOOK)
  const cool = sampleSkyGrade(phase, DEFAULT_SKY_LOOK)
  // The colony grade pushes the far-side haze warm; the legacy grade stays blue.
  expect(izma.fog.r).toBeGreaterThan(cool.fog.r)
  expect(izma.fog.r).toBeGreaterThan(izma.fog.b)
})

test('getSkyLook maps ids and falls back to the cool default', () => {
  expect(getSkyLook('izma')).toBe(IZMA_SKY_LOOK)
  expect(getSkyLook('default')).toBe(DEFAULT_SKY_LOOK)
  expect(getSkyLook('elysium')).toBe(DEFAULT_SKY_LOOK)
  expect(getInitialDayNightPhase('izma')).toBeCloseTo(0.84, 5)
  expect(getInitialDayNightPhase('default')).toBeCloseTo(DEFAULT_SKY_LOOK.initialPhase, 5)
})
