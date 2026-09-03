import { describe, expect, test } from 'bun:test'
import { planSidewalkSegments } from './sidewalks'
import type { CityIntersection, CityRoad } from './cityLayout'

const R = 3200
const sidewalk = 5
const avenue: CityRoad = { azimuth: 0.05, axial: 0, tangentWidth: 8, axialLength: 1000, kind: 'local' }
const street: CityRoad = { azimuth: 0, axial: 200, tangentWidth: 2000, axialLength: 24, kind: 'arterial' }
const alley: CityRoad = { azimuth: 0.02, axial: 100, tangentWidth: 7.5, axialLength: 60, kind: 'alley' }
const crossing: CityIntersection = { azimuth: 0.05, axial: 200, avenueKind: 'local', streetKind: 'arterial', avenueWidth: 8, streetWidth: 24 }

describe('planSidewalkSegments', () => {
  test('lays a band on both sides of each grid road, cut at the crossing, none for alleys', () => {
    const segments = planSidewalkSegments([avenue, street, alley], [crossing], R, sidewalk, () => false)
    const avenueBands = segments.filter((s) => s.isAvenue)
    const streetBands = segments.filter((s) => !s.isAvenue)
    // avenue: 2 runs (before / after the crossing) × 2 sides
    expect(avenueBands.length).toBe(4)
    for (const b of avenueBands) {
      expect(b.tangentExtent).toBe(sidewalk)
      // never inside the cross street's road box
      const lo = b.axial - b.axialExtent * 0.5
      const hi = b.axial + b.axialExtent * 0.5
      expect(hi <= 200 - 12 + 1e-9 || lo >= 200 + 12 - 1e-9).toBe(true)
      // centred one half road + half sidewalk off the avenue centreline
      expect(Math.abs((b.azimuth - avenue.azimuth) * R)).toBeCloseTo(4 + 2.5, 6)
    }
    // street: 2 runs (either side of the avenue) × 2 sides
    expect(streetBands.length).toBe(4)
    for (const b of streetBands) {
      expect(b.axialExtent).toBe(sidewalk)
      expect(Math.abs(b.axial - street.axial)).toBeCloseTo(12 + 2.5, 6)
      const t0 = (b.azimuth - street.azimuth) * R - b.tangentExtent * 0.5
      const t1 = (b.azimuth - street.azimuth) * R + b.tangentExtent * 0.5
      const avenueT = (avenue.azimuth - street.azimuth) * R
      expect(t1 <= avenueT - 4 + 1e-6 || t0 >= avenueT + 4 - 1e-6).toBe(true)
    }
  })

  test('kerb side points back at the road', () => {
    const segments = planSidewalkSegments([avenue], [], R, sidewalk, () => false)
    expect(segments.length).toBe(2)
    for (const b of segments) {
      const side = Math.sign((b.azimuth - avenue.azimuth) * R)
      expect(b.roadSide).toBe(-side as 1 | -1)
    }
  })

  test('skips bands inside open squares', () => {
    const segments = planSidewalkSegments([avenue], [], R, sidewalk, (_, axial) => Math.abs(axial) < 1e9)
    expect(segments.length).toBe(0)
  })
})
