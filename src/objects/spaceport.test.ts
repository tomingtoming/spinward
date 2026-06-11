import { describe, expect, test } from 'bun:test'

import { getSpaceportDimensions } from './spaceport'

describe('getSpaceportDimensions', () => {
  test('small habitats get a compact hub at the +Y end', () => {
    const dims = getSpaceportDimensions(18, 120)
    expect(dims.hubCenterY).toBeCloseTo(60, 6)
    expect(dims.hubRadius).toBeCloseTo(2.5, 6)
    expect(dims.hubLength).toBeCloseTo(20, 6)
    expect(dims.armLength).toBeCloseTo(8, 6)
  })

  test('giant habitats clamp the structure to sane absolute sizes', () => {
    const izma = getSpaceportDimensions(3200, 40000)
    expect(izma.hubRadius).toBeCloseTo(96, 6)
    expect(izma.hubLength).toBeCloseTo(600, 6)
    expect(izma.armLength).toBeCloseTo(360, 6)
    expect(izma.approachSpan).toBeCloseTo(3000, 6)

    const elysium = getSpaceportDimensions(30000, 2000)
    expect(elysium.hubRadius).toBeCloseTo(120, 6)
    expect(elysium.hubLength).toBeCloseTo(80, 6)
    expect(elysium.armLength).toBeCloseTo(360, 6)
  })

  test('hub structure stays clear of the habitat interior except the mouth', () => {
    // The hub straddles the end plane: half inside (arrival bay), half out.
    const dims = getSpaceportDimensions(3200, 40000)
    expect(dims.hubCenterY - dims.hubLength * 0.5).toBeLessThan(20000)
    expect(dims.hubCenterY + dims.hubLength * 0.5).toBeGreaterThan(20000)
  })
})
