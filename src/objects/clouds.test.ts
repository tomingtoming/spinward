import { describe, expect, test } from 'bun:test'

import { planClouds } from './clouds'

describe('planClouds', () => {
  test('is deterministic for the same seed', () => {
    const a = planClouds({ radius: 18, length: 120, seed: 7 })
    const b = planClouds({ radius: 18, length: 120, seed: 7 })
    expect(a).toEqual(b)
    expect(a.length).toBeGreaterThan(0)
  })

  test('different seeds differ', () => {
    expect(planClouds({ radius: 18, length: 120, seed: 1 })).not.toEqual(
      planClouds({ radius: 18, length: 120, seed: 2 })
    )
  })

  test('small habitats keep a proportional cloud deck', () => {
    const radius = 18
    const length = 120
    const puffs = planClouds({ radius, length })

    for (const puff of puffs) {
      const altitude = radius - puff.radial
      expect(altitude).toBeGreaterThan(radius * 0.2)
      expect(altitude).toBeLessThan(radius * 0.85)
      expect(Math.abs(puff.axial)).toBeLessThan(length * 0.5)
      expect(puff.scale).toBeGreaterThan(0)
    }
  })

  test('huge habitats clamp the cloud layer to a realistic altitude', () => {
    const radius = 30000
    const puffs = planClouds({ radius, length: 2000 })
    expect(puffs.length).toBeGreaterThan(0)

    for (const puff of puffs) {
      const altitude = radius - puff.radial
      // Clamped band: ~1500m center, ~400m spread, plus per-puff jitter
      // bounded by the (also clamped) cluster size.
      expect(altitude).toBeGreaterThan(800)
      expect(altitude).toBeLessThan(2300)
    }
  })

  test('cluster count scales with habitat length within bounds', () => {
    const short = planClouds({ radius: 18, length: 120 })
    const long = planClouds({ radius: 18, length: 600 })
    expect(long.length).toBeGreaterThan(short.length)
  })

  test('returns nothing for degenerate dimensions', () => {
    expect(planClouds({ radius: 0, length: 120 })).toEqual([])
    expect(planClouds({ radius: 18, length: 0 })).toEqual([])
  })
})
