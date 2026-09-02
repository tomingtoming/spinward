import { describe, expect, test } from 'bun:test'
import {
  createHazeProfile,
  diameterOpticalDepth,
  layeredOpticalDepth,
  layeredTransmittance,
  resolveHazeScaleHeight,
  setHazeProfile,
  DEFAULT_HAZE_SCALE_HEIGHT_METERS,
  MAX_HAZE_SCALE_HEIGHT_METERS,
  MIN_HAZE_SCALE_HEIGHT_METERS
} from './layeredHaze'
import { visibilityToFogDensity } from '../app/airVisibility'

const izma = () => {
  const profile = createHazeProfile()
  setHazeProfile(profile, 3200, 500)
  return profile
}
const rho16km = visibilityToFogDensity(16_000)

describe('resolveHazeScaleHeight', () => {
  test('defaults when absent or unparsable', () => {
    expect(resolveHazeScaleHeight(null)).toBe(DEFAULT_HAZE_SCALE_HEIGHT_METERS)
    expect(resolveHazeScaleHeight('')).toBe(DEFAULT_HAZE_SCALE_HEIGHT_METERS)
    expect(resolveHazeScaleHeight('abc')).toBe(DEFAULT_HAZE_SCALE_HEIGHT_METERS)
  })
  test('zero or negative means uniform fog (null)', () => {
    expect(resolveHazeScaleHeight('0')).toBeNull()
    expect(resolveHazeScaleHeight('-5')).toBeNull()
  })
  test('clamps into the sane band', () => {
    expect(resolveHazeScaleHeight('1')).toBe(MIN_HAZE_SCALE_HEIGHT_METERS)
    expect(resolveHazeScaleHeight('1e9')).toBe(MAX_HAZE_SCALE_HEIGHT_METERS)
    expect(resolveHazeScaleHeight('800')).toBe(800)
  })
})

describe('setHazeProfile', () => {
  test('null scale height switches the shader to the uniform branch', () => {
    const profile = createHazeProfile()
    setHazeProfile(profile, 2000, null)
    expect(profile.x).toBe(2000)
    expect(profile.z).toBe(0)
    expect(profile.y).toBe(0)
  })
})

describe('layeredOpticalDepth', () => {
  test('uniform branch reproduces the legacy Gaussian FogExp2 (the A/B control)', () => {
    const profile = createHazeProfile()
    setHazeProfile(profile, 3200, null)
    const tau = layeredOpticalDepth({ x: 3100, y: 0, z: 0 }, { x: 3100, y: 10_000, z: 0 }, rho16km, profile)
    expect(tau).toBeCloseTo((rho16km * 10_000) ** 2, 9)
    // The Gaussian form's 2%-contrast range at the "16km" setting is ~8km.
    const tau8km = layeredOpticalDepth({ x: 3100, y: 0, z: 0 }, { x: 3100, y: 8_090, z: 0 }, rho16km, profile)
    expect(Math.exp(-tau8km)).toBeCloseTo(0.02, 2)
  })

  test('layered branch is Beer–Lambert at the floor (Koschmieder: 16km → 10km ≈ 8.7%)', () => {
    const profile = izma()
    const tau = layeredOpticalDepth({ x: 3200, y: 0, z: 0 }, { x: 3200, y: 10_000, z: 0 }, rho16km, profile)
    expect(Math.exp(-tau)).toBeCloseTo(0.0868, 3)
  })

  test('a horizontal sightline at street height is unchanged by the layer (article: 10km stays 8.7%)', () => {
    const profile = izma()
    // 100m up, 10km along the axis: density is e^(-100/500) of the floor value all the way.
    const tau = layeredOpticalDepth({ x: 3100, y: -10_000, z: 0 }, { x: 3100, y: 0, z: 0 }, rho16km, profile)
    expect(tau).toBeCloseTo(rho16km * 10_000 * Math.exp(-100 / 500), 6)
  })

  test('floor → axis → far wall matches the closed form within the sampling error', () => {
    const profile = izma()
    const closed = diameterOpticalDepth(3200, 500, rho16km)
    // 8 midpoint taps underestimate the sharp floor peaks; 64 taps converge.
    const coarse = layeredOpticalDepth({ x: 3200, y: 0, z: 0 }, { x: -3200, y: 0, z: 0 }, rho16km, profile, 8)
    const fine = layeredOpticalDepth({ x: 3200, y: 0, z: 0 }, { x: -3200, y: 0, z: 0 }, rho16km, profile, 64)
    expect(Math.abs(fine - closed) / closed).toBeLessThan(0.03)
    expect(Math.abs(coarse - closed) / closed).toBeLessThan(0.15)
  })

  test('the overhead wall reads through the layer where the uniform fog hid it', () => {
    const layered = izma()
    const uniform = createHazeProfile()
    setHazeProfile(uniform, 3200, null)
    const from = { x: 3198.3, y: 0, z: 0 }
    const to = { x: -3200, y: 0, z: 0 }
    const overheadLayered = layeredTransmittance(from, to, rho16km, layered, 64)
    const overheadUniform = layeredTransmittance(from, to, rho16km, uniform, 64)
    // Legacy Gaussian at 2R: e^-(ρ·6400)² ≈ 9%; the article's uniform
    // Beer–Lambert figure is 21%; boundary layer ≈ 74–78% (no Rayleigh term).
    expect(overheadUniform).toBeCloseTo(0.087, 2)
    expect(overheadLayered).toBeGreaterThan(0.7)
    expect(overheadLayered).toBeLessThan(0.82)
  })

  test('is symmetric in direction and zero for a zero-length segment', () => {
    const profile = izma()
    const a = { x: 3000, y: 200, z: 400 }
    const b = { x: -1000, y: -3000, z: 2500 }
    expect(layeredOpticalDepth(a, b, rho16km, profile)).toBeCloseTo(layeredOpticalDepth(b, a, rho16km, profile), 9)
    expect(layeredOpticalDepth(a, a, rho16km, profile)).toBe(0)
  })
})
