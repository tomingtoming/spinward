import { describe, expect, test } from 'bun:test'

import type { CityRoad } from './cityLayout'
import { planRoadTilePlacements, type RoadTilePlacement } from './roadTiles'

// A minimal one-block strip: two axial avenues crossing two tangential
// streets, arterial ring around a local core — enough to exercise every
// junction shape (crossroads in the middle, Ts on the edges, bends at the
// corners) once trimmed down per test.

const RADIUS = 1000

const avenue = (azimuth: number, kind: CityRoad['kind'] = 'arterial'): CityRoad => ({
  azimuth,
  axial: 0,
  tangentWidth: 16,
  axialLength: 800,
  kind
})

const street = (
  axial: number,
  tangentSpanMeters: number,
  kind: CityRoad['kind'] = 'arterial'
): CityRoad => ({
  azimuth: 0,
  axial,
  tangentWidth: tangentSpanMeters / RADIUS * RADIUS,
  axialLength: 12,
  kind
})

const plan = (roads: CityRoad[], overrides?: { range?: number; maxTiles?: number }) =>
  planRoadTilePlacements({
    roads,
    radius: RADIUS,
    focusAzimuth: 0,
    focusAxial: 0,
    rangeMeters: overrides?.range ?? 600,
    maxTiles: overrides?.maxTiles
  })

const ofKind = (placements: RoadTilePlacement[], kind: RoadTilePlacement['kind']) =>
  placements.filter((placement) => placement.kind === kind)

describe('planRoadTilePlacements', () => {
  test('a mid-strip crossing becomes a crossroad tile sized by both roads', () => {
    // Street spans ±400 m; the avenue at azimuth 0 crosses well inside it.
    const placements = plan([avenue(0), street(0, 800)])
    const crossroads = ofKind(placements, 'crossroad')

    expect(crossroads).toHaveLength(1)
    expect(crossroads[0].azimuth).toBeCloseTo(0, 9)
    expect(crossroads[0].axial).toBeCloseTo(0, 9)
    // Envelope: tangential span from the avenue (16/0.8), axial from the
    // street (12/0.8); quarterTurns is even so mesh X carries the tangent.
    expect(crossroads[0].quarterTurns % 2).toBe(0)
    expect(crossroads[0].alongMeters).toBeCloseTo(20, 6)
    expect(crossroads[0].crossMeters).toBeCloseTo(15, 6)
  })

  test('a street ending on an edge avenue becomes a T with the stem pointing back in', () => {
    // Street spans tangentially ±200 m around azimuth 0; the avenue sits at
    // its -tangent end, so the street interior lies toward +tangent.
    const edgeAvenueAzimuth = -200 / RADIUS
    const placements = plan([avenue(edgeAvenueAzimuth), street(0, 400)])
    const tees = ofKind(placements, 'tee')

    expect(tees).toHaveLength(1)
    // Stem +Z must map to +tangent: quarter turn 1.
    expect(tees[0].quarterTurns).toBe(1)
  })

  test('an avenue ending on an edge street becomes a T stemming back along the axis', () => {
    // Avenue spans axially ±400; the street sits at its +axial end, so the
    // avenue interior lies toward -axial (stem +Z → -axial: quarter turn 0).
    const placements = plan([avenue(0), street(400, 800)])
    const tees = ofKind(placements, 'tee')

    expect(tees).toHaveLength(1)
    expect(tees[0].quarterTurns).toBe(0)
  })

  test('a corner (both roads ending) becomes a bend', () => {
    const placements = plan([avenue(-200 / RADIUS), street(400, 400)])
    const bends = ofKind(placements, 'bend')

    expect(bends).toHaveLength(1)
    // Street interior +tangent, avenue interior -axial → quarter turn 1.
    expect(bends[0].quarterTurns).toBe(1)
  })

  test('straight tiles fill the runs without overlapping the junction envelope', () => {
    const placements = plan([avenue(0), street(0, 800)])
    const junction = ofKind(placements, 'crossroad')[0]
    const straights = placements.filter(
      (placement) => placement.kind === 'straight' || placement.kind === 'crossing'
    )

    expect(straights.length).toBeGreaterThan(10)

    for (const tile of straights) {
      if (tile.quarterTurns === 1) {
        // Avenue tile: must clear the junction's axial envelope.
        const gap =
          Math.abs(tile.axial - junction.axial) -
          (tile.alongMeters * 0.5 + junction.crossMeters * 0.5)
        expect(gap).toBeGreaterThanOrEqual(-1e-6)
      } else {
        const gap =
          Math.abs(tile.azimuth - junction.azimuth) * RADIUS -
          (tile.alongMeters * 0.5 + junction.alongMeters * 0.5)
        expect(gap).toBeGreaterThanOrEqual(-1e-6)
      }
    }
  })

  test('arterial tiles abutting a junction become zebra crossings', () => {
    const placements = plan([avenue(0), street(0, 800)])
    const crossings = ofKind(placements, 'crossing')

    // Four approaches to the one crossroad.
    expect(crossings.length).toBe(4)
    for (const crossing of crossings) {
      const distance = Math.hypot(
        crossing.azimuth * RADIUS - 0,
        crossing.axial - 0
      )
      expect(distance).toBeLessThan(60)
    }
  })

  test('local roads keep plain straights (no zebra)', () => {
    const placements = plan([avenue(0, 'local'), street(0, 800, 'local')])
    expect(ofKind(placements, 'crossing')).toHaveLength(0)
    expect(ofKind(placements, 'straight').length).toBeGreaterThan(10)
  })

  test('range and cap bound the output, nearest first', () => {
    const all = plan([avenue(0), street(0, 800)])
    const capped = plan([avenue(0), street(0, 800)], { maxTiles: 8 })

    expect(capped).toHaveLength(8)
    const cappedMax = Math.max(...capped.map((placement) => placement.distance))
    const allMax = Math.max(...all.map((placement) => placement.distance))
    expect(cappedMax).toBeLessThanOrEqual(allMax)

    const near = plan([avenue(0), street(0, 800)], { range: 50 })
    for (const placement of near) {
      expect(placement.distance).toBeLessThanOrEqual(50)
    }
  })

  test('a full-circle street tiles around the focus without a seam blowup', () => {
    const fullRing: CityRoad = {
      azimuth: 0,
      axial: 0,
      tangentWidth: Math.PI * 2 * RADIUS,
      axialLength: 12,
      kind: 'arterial'
    }
    const placements = plan([fullRing], { range: 100 })

    expect(placements.length).toBeGreaterThan(5)
    for (const placement of placements) {
      expect(placement.distance).toBeLessThanOrEqual(100)
      expect(placement.kind === 'straight' || placement.kind === 'crossing').toBe(true)
    }
  })

  test('small drums keep the painted roads (no overlay below the curvature floor)', () => {
    const placements = planRoadTilePlacements({
      roads: [avenue(0), street(0, 40)],
      radius: 18,
      focusAzimuth: 0,
      focusAxial: 0,
      rangeMeters: 600
    })
    expect(placements).toHaveLength(0)
  })

  test('tangential runs stay under the curvature pitch cap', () => {
    const placements = plan([street(0, 800)])
    for (const placement of placements) {
      expect(placement.alongMeters).toBeLessThanOrEqual(20 + 1e-6)
    }
  })
})
