import { describe, expect, test } from 'bun:test'

import {
  getAirColumnFraction,
  getAtmosphereDepth,
  getHabitatSpan
} from './habitatConfig'

test('getHabitatSpan returns length for cylinders', () => {
  expect(
    getHabitatSpan({
      type: 'cylinder',
      length: 120,
      thickness: 0
    })
  ).toBe(120)
})

test('getHabitatSpan prefers thickness for ring-style approximations', () => {
  expect(
    getHabitatSpan({
      type: 'ring',
      length: 120,
      thickness: 2000
    })
  ).toBe(2000)
})

describe('confined-atmosphere model', () => {
  test('a cylinder is air to the axis (depth = radius)', () => {
    expect(getAtmosphereDepth({ type: 'cylinder', radius: 3200, thickness: 0 })).toBe(3200)
  })

  test('a ring holds only a thin floor shell (depth = thickness)', () => {
    // Elysium: 30 km radius floor, ~2 km rim — the bore is vacuum.
    expect(getAtmosphereDepth({ type: 'ring', radius: 30000, thickness: 2000 })).toBe(2000)
  })

  test('a cylinder fogs uniformly: the whole sightline is air (fraction = 1)', () => {
    // Keeps Playground / Izma / Cooper haze exactly as before.
    expect(getAirColumnFraction({ type: 'cylinder', radius: 18, thickness: 0 })).toBe(1)
    expect(getAirColumnFraction({ type: 'cylinder', radius: 3200, thickness: 0 })).toBe(1)
  })

  test('a ring lets most of a cross-bore sightline through vacuum (fraction << 1)', () => {
    const fraction = getAirColumnFraction({ type: 'ring', radius: 30000, thickness: 2000 })
    // depth / R = 2000 / 30000.
    expect(fraction).toBeCloseTo(2000 / 30000, 6)
    // Far rim therefore stays visible rather than socking in.
    expect(fraction).toBeLessThan(0.1)
    expect(fraction).toBeGreaterThan(0)
  })

  test('the air fraction is clamped to [0, 1] and never divides by zero', () => {
    // A degenerate shell deeper than the radius cannot exceed a full column.
    expect(getAirColumnFraction({ type: 'ring', radius: 1000, thickness: 5000 })).toBe(1)
    expect(getAirColumnFraction({ type: 'cylinder', radius: 0, thickness: 0 })).toBe(0)
  })
})
