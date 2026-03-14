import { expect, test } from 'bun:test'

import {
  approxEqual,
  asReal,
  omegaForSurfaceG,
  omegaToPeriod,
  omegaToRpm,
  periodToOmega,
  rpmToOmega,
  surfaceG,
  toRealLength,
  toRealVec3,
  toSimLength,
  toSimVec3
} from './units'

const SIM_SCALES = [0.005, 0.02, 0.1]
const SAMPLE_VALUES = [0, 0.1, 1, 10, 1234, 30000]

test('length conversions round-trip across supported sim scales', () => {
  for (const simScale of SIM_SCALES) {
    for (const value of SAMPLE_VALUES) {
      const real = asReal(value)
      const roundTrip = toRealLength(toSimLength(real, simScale), simScale)
      expect(approxEqual(roundTrip, real, 1e-9)).toBe(true)
    }
  }
})

test('vector conversions round-trip across supported sim scales', () => {
  for (const simScale of SIM_SCALES) {
    const real = {
      x: asReal(1234),
      y: asReal(-12.5),
      z: asReal(30000)
    }
    const roundTrip = toRealVec3(toSimVec3(real, simScale), simScale)

    expect(approxEqual(roundTrip.x, real.x, 1e-9)).toBe(true)
    expect(approxEqual(roundTrip.y, real.y, 1e-9)).toBe(true)
    expect(approxEqual(roundTrip.z, real.z, 1e-9)).toBe(true)
  }
})

test('rpm, omega, and period conversions round-trip', () => {
  const rpm = 0.5286
  const omega = rpmToOmega(rpm)
  const period = omegaToPeriod(omega)

  expect(approxEqual(omegaToRpm(omega), rpm, 1e-9)).toBe(true)
  expect(approxEqual(periodToOmega(period), omega, 1e-9)).toBe(true)
})

test('surfaceG and omegaForSurfaceG are inverse helpers', () => {
  const radius = 3200
  const omega = periodToOmega(113.5)
  const g = surfaceG(omega, radius)

  expect(approxEqual(omegaForSurfaceG(g, radius), omega, 1e-9)).toBe(true)
})
