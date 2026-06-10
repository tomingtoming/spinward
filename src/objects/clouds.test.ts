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

  test('puffs float in the low-gravity band near the axis', () => {
    const radius = 18
    const length = 120
    const puffs = planClouds({ radius, length })

    for (const puff of puffs) {
      // Cluster radial band plus per-puff jitter stays well below the ground
      // and above the axis spine.
      expect(puff.radial).toBeGreaterThan(radius * 0.25)
      expect(puff.radial).toBeLessThan(radius * 0.7)
      expect(Math.abs(puff.axial)).toBeLessThan(length * 0.5)
      expect(puff.scale).toBeGreaterThan(0)
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
