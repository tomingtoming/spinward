import { expect, test } from 'bun:test'
import {
  districtNightGain,
  districtNodeAt,
  districtVoidAt,
  isDistrictPark,
  nightDistrictGain,
  nightSpeckle,
  stripFrameAt
} from './districtIdentity'

test('large parks stay away from the arrival axis and small habitats', () => {
  expect(isDistrictPark(3200, 40000, 0.46, 0.12)).toBe(true)
  expect(isDistrictPark(3200, 40000, -0.42, -0.24)).toBe(true)
  for (let axial = -1; axial <= 1; axial += 0.01) {
    expect(isDistrictPark(3200, 40000, 0, axial)).toBe(false)
  }
  expect(isDistrictPark(18, 120, 0.46, 0.12)).toBe(false)
})

test('night districts separate commercial, residential and industrial areas', () => {
  expect(districtNightGain(1)).toBeGreaterThan(districtNightGain(0.2))
  expect(districtNightGain(0.2)).toBeGreaterThan(districtNightGain(1, true))
})

test('secondary nodes peak inside their cores and vanish between them', () => {
  // Node cores (see NODES) are strong enough to count as CBD massing.
  expect(districtNodeAt(-0.35, -0.55)).toBeGreaterThan(0.8)
  expect(districtNodeAt(-0.3, 0.3)).toBeGreaterThan(0.85)
  // Midway between nodes and at the far cap the field is silent, so the
  // fringe and the dark voids survive.
  expect(districtNodeAt(0, 0)).toBe(0)
  expect(districtNodeAt(0.35, 0.9)).toBe(0)
  for (let tangent = -1; tangent <= 1; tangent += 0.05) {
    for (let axial = -1; axial <= 1; axial += 0.05) {
      const value = districtNodeAt(tangent, axial)
      expect(value).toBeGreaterThanOrEqual(0)
      expect(value).toBeLessThanOrEqual(1)
    }
  }
})

test('night voids are dark at their centres and absent over the cores', () => {
  expect(districtVoidAt(0.22, -0.5)).toBeGreaterThan(0.95)
  expect(districtVoidAt(-0.3, 0.5)).toBeGreaterThan(0.95)
  // Never on top of a node core, so a cluster is never hollowed out.
  expect(districtVoidAt(-0.35, -0.55)).toBe(0)
  expect(districtVoidAt(-0.3, 0.3)).toBe(0)
  expect(districtVoidAt(0.4, -0.28)).toBe(0)
})

test('stripFrameAt normalizes a land strip and wraps around the seam', () => {
  const third = (Math.PI * 2) / 3
  const arcs = [0, third, 2 * third].map(centerAzimuth => ({ centerAzimuth, arcRadians: Math.PI / 3 }))
  expect(stripFrameAt(arcs, 40000, 0, 0)).toEqual({ tangent: 0, axial: 0 })
  expect(stripFrameAt(arcs, 40000, 0, 10000)!.axial).toBeCloseTo(0.5, 10)
  // Just inside the strip edge lands near ±1 (usable width is 94 % of the arc).
  expect(stripFrameAt(arcs, 40000, Math.PI / 6 - 1e-3, 0)!.tangent).toBeCloseTo(1.06, 1)
  // The third strip straddles the −π/+π seam.
  expect(stripFrameAt(arcs, 40000, 2 * third + Math.PI * 2 - 0.1, 0)!.tangent).toBeCloseTo(-0.1 / (Math.PI / 3 * 0.47), 6)
  // Window strips and full-circle arcs give no frame.
  expect(stripFrameAt(arcs, 40000, Math.PI / 3, 0)).toBeNull()
  expect(stripFrameAt([{ centerAzimuth: 0, arcRadians: Math.PI * 2 }], 40000, 0, 0)).toBeNull()
  expect(stripFrameAt(null, 40000, 0, 0)).toBeNull()
})

test('night speckle is deterministic and bounded', () => {
  for (const [azimuth, axial] of [[0, 0], [0.3, 1200], [-2.1, -9000], [2.09, 15000]]) {
    const value = nightSpeckle(azimuth, axial)
    expect(value).toBe(nightSpeckle(azimuth, axial))
    expect(value).toBeGreaterThanOrEqual(0.5)
    expect(value).toBeLessThanOrEqual(1)
  }
})

test('nightDistrictGain lifts cores, dims voids and leaves frameless habitats alone', () => {
  const core = nightDistrictGain(0.3, false, { tangent: -0.3, axial: 0.3 })
  const hollow = nightDistrictGain(0.3, false, { tangent: 0.22, axial: -0.5 })
  const plain = nightDistrictGain(0.3, false, null)
  expect(core.urbanNight).toBeGreaterThan(0.85)
  expect(core.gain).toBeGreaterThan(plain.gain)
  expect(hollow.gain).toBeLessThan(plain.gain * 0.35)
  expect(plain.gain).toBeCloseTo(districtNightGain(0.3), 10)
})
