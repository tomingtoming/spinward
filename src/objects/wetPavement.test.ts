import { test, expect } from 'bun:test'
import { stepPavementWetness } from './wetPavement'

test('rain wets quickly but stopping a shower leaves a slowly drying surface', () => {
  let wet = 0
  for (let i = 0; i < 720; i++) wet = stepPavementWetness(wet, 1, 1 / 60)
  expect(wet).toBeCloseTo(1, 10)
  for (let i = 0; i < 600; i++) wet = stepPavementWetness(wet, 0, 1 / 60)
  expect(wet).toBeCloseTo(11 / 12, 9)
  for (let i = 0; i < 7200; i++) wet = stepPavementWetness(wet, 0, 1 / 60)
  expect(wet).toBe(0)
})

test('wetness is timestep independent and bounded through a weather reversal', () => {
  const run = (hz: number) => {
    let wet = 0
    for (const [rain, seconds] of [[1, 6], [0, 18], [1, 4], [0, 90]])
      for (let i = 0; i < seconds * hz; i++) wet = stepPavementWetness(wet, rain, 1 / hz)
    return wet
  }
  expect(run(30)).toBeCloseTo(run(120), 10)
  expect(stepPavementWetness(.5, 1, -3)).toBe(.5)
  expect(stepPavementWetness(.5, 4, 1000)).toBe(1)
  expect(stepPavementWetness(.5, -4, 1000)).toBe(0)
})
