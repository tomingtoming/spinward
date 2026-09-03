import { describe, expect, test } from 'bun:test'
import { isSlotOccupied, parkingSlotFor, parkingSlotsFor, selectNearbyBuildings, slotHash } from './parkedCars'
import type { CityBuilding, CityRoad } from './cityLayout'

const R = 3200
const sidewalk = 5
const avenue: CityRoad = { azimuth: 0.02, axial: 0, tangentWidth: 8, axialLength: 40000, kind: 'local' }
const street: CityRoad = { azimuth: 0, axial: 500, tangentWidth: 3000, axialLength: 24, kind: 'arterial' }
const alley: CityRoad = { azimuth: 0.02 + 40 / R, axial: 300, tangentWidth: 7.5, axialLength: 60, kind: 'alley' }
const roads = [avenue, street, alley]

const parcelOnAvenue = (side: 1 | -1): CityBuilding => ({
  // building centre 20 m from the avenue centreline on the −tangent side
  azimuth: 0.02 + (side === -1 ? 1 : -1) * (4 + sidewalk + 12) / R,
  axial: 200,
  width: 10,
  depth: 10,
  height: 12,
  tone: 0.3,
  kind: 'block',
  urban: 0.9,
  front: { axis: 'tangent', side },
  parcel: { tangentOffset: 0, axialOffset: 0, tangentExtent: 24, axialExtent: 22 }
})

describe('parkingSlotFor', () => {
  test('a parcel on an avenue parks in the avenue kerb lane, nose along the axis', () => {
    const slot = parkingSlotFor(parcelOnAvenue(-1), R, roads, sidewalk, 6)
    expect(slot).not.toBeNull()
    expect(slot!.along).toBe('axial')
    expect(slot!.roadKind).toBe('local')
    // kerb lane: 4 − 1.35 = 2.65 m from the avenue centreline
    expect(Math.abs((slot!.azimuth - avenue.azimuth) * R)).toBeCloseTo(4 - 1.35, 1)
    expect(slot!.axial).toBeCloseTo(200, 6)
    expect([1, -1]).toContain(slot!.facing)
    expect(slot!.variant).toBeGreaterThanOrEqual(0)
    expect(slot!.variant).toBeLessThan(6)
  })

  test('a parcel fronting an alley (no grid road there) gets no slot', () => {
    const b = parcelOnAvenue(-1)
    b.azimuth = alley.azimuth + (7.5 * 0.5 + sidewalk + 12) / R
    b.axial = alley.axial
    expect(parkingSlotFor(b, R, roads, sidewalk, 6)).toBeNull()
  })

  test('parcels too short for a car get no slot; missing front/parcel gets none', () => {
    const b = parcelOnAvenue(-1)
    b.parcel = { ...b.parcel!, axialExtent: 5 }
    expect(parkingSlotFor(b, R, roads, sidewalk, 6)).toBeNull()
    const bare: CityBuilding = { azimuth: 0, axial: 0, width: 5, depth: 5, height: 5, tone: 0, kind: 'house' }
    expect(parkingSlotFor(bare, R, roads, sidewalk, 6)).toBeNull()
  })
})

describe('occupancy and hashing', () => {
  test('is deterministic and denser downtown than in the suburbs', () => {
    const slotA = parkingSlotFor(parcelOnAvenue(-1), R, roads, sidewalk, 6)!
    expect(isSlotOccupied(slotA, parcelOnAvenue(-1))).toBe(isSlotOccupied(slotA, parcelOnAvenue(-1)))
    expect(slotHash(0.1, 200, 1)).toBeCloseTo(slotHash(0.1, 200, 1), 12)
    expect(slotHash(0.1, 200, 1)).not.toBeCloseTo(slotHash(0.1, 200, 2), 6)
    let downtown = 0
    let suburb = 0
    for (let i = 0; i < 400; i++) {
      const b = parcelOnAvenue(-1)
      b.axial = 200 + i * 7
      const slot = parkingSlotFor(b, R, roads, sidewalk, 6)!
      if (isSlotOccupied(slot, { ...b, urban: 1 })) downtown++
      if (isSlotOccupied(slot, { ...b, urban: 0.2 })) suburb++
    }
    expect(downtown).toBeGreaterThan(suburb)
    expect(downtown / 400).toBeGreaterThan(0.4)
    expect(suburb / 400).toBeLessThan(0.3)
  })
})

describe('selectNearbyBuildings', () => {
  test('keeps buildings within range, wrapping the seam', () => {
    const mk = (azimuth: number, axial: number): CityBuilding => ({ ...parcelOnAvenue(-1), azimuth, axial })
    const all = [mk(0.001, 0), mk(Math.PI * 2 - 0.001, 0), mk(0.3, 0), mk(0, 2000)]
    expect(selectNearbyBuildings(all, R, 0, 0, 300).length).toBe(2)
  })
})

describe('parkingSlotsFor', () => {
  test('a long frontage holds two cars a quarter-extent apart; a short one holds one', () => {
    const long = parcelOnAvenue(-1) // axialExtent 22 ≥ 6.5 × 2.2
    const slots = parkingSlotsFor(long, R, roads, sidewalk, 6)
    expect(slots.length).toBe(2)
    expect(slots[0].axial).toBeCloseTo(200 - 5.5, 6)
    expect(slots[1].axial).toBeCloseTo(200 + 5.5, 6)
    const short = parcelOnAvenue(-1)
    short.parcel = { ...short.parcel!, axialExtent: 10 }
    expect(parkingSlotsFor(short, R, roads, sidewalk, 6).length).toBe(1)
  })
})
