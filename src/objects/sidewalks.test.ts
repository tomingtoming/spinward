import { describe, expect, test } from 'bun:test'
import { planSidewalkSegments } from './sidewalks'
import { planCity, type CityIntersection, type CityRoad } from './cityLayout'
import { SurfaceIndex } from './streetAccess'

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
      expect(b.tangentExtent).toBe(2)
      // never inside the cross street's road box
      const lo = b.axial - b.axialExtent * 0.5
      const hi = b.axial + b.axialExtent * 0.5
      expect(hi <= 200 - 12 + 1e-9 || lo >= 200 + 12 - 1e-9).toBe(true)
      // centred one half road + half sidewalk off the avenue centreline
      expect(Math.abs((b.azimuth - avenue.azimuth) * R)).toBeCloseTo(4 + 1, 6)
    }
    // street: 2 runs (either side of the avenue) × 2 sides
    expect(streetBands.length).toBe(4)
    for (const b of streetBands) {
      expect(b.axialExtent).toBe(3)
      expect(Math.abs(b.axial - street.axial)).toBeCloseTo(12 + 1.5, 6)
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

// Check the layer actually used by main.ts, not only the access-path layer.
const overlapsRoad = (s: ReturnType<typeof planSidewalkSegments>[number], r: CityRoad, radius: number) => {
  const dt = Math.abs(Math.atan2(Math.sin(s.azimuth - r.azimuth), Math.cos(s.azimuth - r.azimuth))) * radius
  return dt < (s.tangentExtent + r.tangentWidth) / 2 - 1e-5 &&
    Math.abs(s.axial - r.axial) < (s.axialExtent + r.axialLength) / 2 - 1e-5
}

test('uncatalogued shared lanes and offset T junctions cut the actual raised sidewalks, including the seam', () => {
  for (const focus of [0, Math.PI - 0.001]) {
    const roads: CityRoad[] = [
      { azimuth: focus, axial: 0, tangentWidth: 12, axialLength: 300, kind: 'collector' },
      { azimuth: focus + 50 / R, axial: 45, tangentWidth: 100, axialLength: 4, kind: 'alley' },
      { azimuth: focus - 52 / R, axial: -50, tangentWidth: 100, axialLength: 6, kind: 'local' }
    ]
    const segments = planSidewalkSegments(roads, [], R, 3, () => false)
    expect(segments.length).toBeGreaterThan(4)
    for (const s of segments) for (const road of roads) expect(overlapsRoad(s, road, R)).toBe(false)
  }
})

test('every raised sidewalk in the production Izma plan clears every carriageway', () => {
  const plan = planCity({ radius: R, length: 40000, maxBuildings: 64000 })
  const segments = planSidewalkSegments(plan.roads, plan.intersections, R, 3, () => false)
  const index = new SurfaceIndex(R)
  plan.roads.forEach((road, i) => index.insert(road, i))
  let overlaps = 0
  for (const s of segments) {
    for (const i of index.query({ ...s, tangentWidth: s.tangentExtent, axialLength: s.axialExtent }))
      if (overlapsRoad(s, plan.roads[i], R)) overlaps++
  }
  expect(segments.length).toBeGreaterThan(1000)
  expect(overlaps).toBe(0)
})
