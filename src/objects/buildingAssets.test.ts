import { describe, expect, test } from 'bun:test'

import {
  KENNEY_SUBURBAN_HEIGHT_M,
  fitSuburbanHouse,
  kenneyPickForBuilding,
  suburbanLotBoundary,
  suburbanParcelRect
} from './buildingAssets'
import { planCity, type CityBuilding } from './cityLayout'

const IZMA = { radius: 3200, length: 40000 }

const suburbanHouses = () =>
  planCity(IZMA).buildings.filter(
    (building) => kenneyPickForBuilding(building)?.set === 'suburban'
  )

describe('fitSuburbanHouse', () => {
  test('dresses exactly the suburban picks, deterministically', () => {
    const { buildings } = planCity(IZMA)
    for (const building of buildings) {
      const fit = fitSuburbanHouse(building)
      const pick = kenneyPickForBuilding(building)
      expect(fit !== null).toBe(pick?.set === 'suburban')
      if (fit !== null) {
        expect(fitSuburbanHouse(building)).toEqual(fit)
      }
    }
  })

  test('houses hold real stature: no miniature tail, no giants', () => {
    const houses = suburbanHouses()
    expect(houses.length).toBeGreaterThan(100)
    const maxStature = Math.max(...KENNEY_SUBURBAN_HEIGHT_M) * 1.08
    let fullStature = 0

    for (const building of houses) {
      const fit = fitSuburbanHouse(building)
      if (fit === null) {
        continue
      }
      expect(fit.height).toBeLessThanOrEqual(maxStature + 1e-6)
      // The only thing allowed to shrink a house below its stature band is
      // a genuinely small parcel.
      if (fit.height >= KENNEY_SUBURBAN_HEIGHT_M[fit.variant] * 0.92 - 1e-6) {
        fullStature += 1
      } else {
        const parcel = suburbanParcelRect(building)
        expect(Math.min(parcel.tangentExtent, parcel.axialExtent)).toBeLessThan(14)
      }
    }
    expect(fullStature / houses.length).toBeGreaterThan(0.9)
  })

  test('the house sits at the back of its parcel, front garden to the street', () => {
    for (const building of suburbanHouses()) {
      const fit = fitSuburbanHouse(building)
      if (fit === null) {
        continue
      }
      const parcel = suburbanParcelRect(building)

      // Inside the parcel on both axes.
      expect(
        Math.abs(fit.tangentOffset - parcel.tangentOffset) + fit.tangentExtent / 2
      ).toBeLessThanOrEqual(parcel.tangentExtent / 2 + 1e-6)
      expect(
        Math.abs(fit.axialOffset - parcel.axialOffset) + fit.axialExtent / 2
      ).toBeLessThanOrEqual(parcel.axialExtent / 2 + 1e-6)

      // Rear wall a fixed 2 m off the back boundary.
      const isTangentFront = fit.front.axis === 'tangent'
      const parcelF = isTangentFront ? parcel.tangentExtent : parcel.axialExtent
      const parcelCentreF =
        (isTangentFront ? parcel.tangentOffset : parcel.axialOffset) *
        fit.front.side
      const houseF =
        (isTangentFront ? fit.tangentOffset : fit.axialOffset) * fit.front.side
      const houseFExtent = isTangentFront ? fit.tangentExtent : fit.axialExtent
      const rearGap = houseF - houseFExtent / 2 - (parcelCentreF - parcelF / 2)
      expect(rearGap).toBeCloseTo(2, 5)
    }
  })

  test('parcels tile the row: no two suburban parcels overlap', () => {
    const houses = suburbanHouses()
    const rects = houses.map((building) => {
      const parcel = suburbanParcelRect(building)
      return {
        azimuth: building.azimuth + parcel.tangentOffset / IZMA.radius,
        axial: building.axial + parcel.axialOffset,
        tangentExtent: parcel.tangentExtent,
        axialExtent: parcel.axialExtent
      }
    })

    for (let a = 0; a < rects.length; a += 1) {
      for (let b = a + 1; b < rects.length; b += 1) {
        const tangentDelta =
          Math.abs(rects[a].azimuth - rects[b].azimuth) * IZMA.radius
        const axialDelta = Math.abs(rects[a].axial - rects[b].axial)
        const tangentGap =
          tangentDelta - (rects[a].tangentExtent + rects[b].tangentExtent) / 2
        const axialGap =
          axialDelta - (rects[a].axialExtent + rects[b].axialExtent) / 2
        expect(Math.max(tangentGap, axialGap)).toBeGreaterThanOrEqual(-1e-6)
      }
    }
  })

  test('lot boundaries stay inside the lot, clear the house, and leave a gate', () => {
    let checked = 0
    for (const building of suburbanHouses()) {
      const fit = fitSuburbanHouse(building)
      if (fit === null) {
        continue
      }
      const boundary = suburbanLotBoundary(building, fit)
      expect(suburbanLotBoundary(building, fit)).toEqual(boundary)
      expect(boundary.segments.length).toBeGreaterThanOrEqual(2)

      const houseTangent = [
        fit.tangentOffset - fit.tangentExtent / 2,
        fit.tangentOffset + fit.tangentExtent / 2
      ]
      const houseAxial = [
        fit.axialOffset - fit.axialExtent / 2,
        fit.axialOffset + fit.axialExtent / 2
      ]

      const parcel = suburbanParcelRect(building)
      for (const segment of boundary.segments) {
        // Inside the parcel.
        expect(
          Math.abs(segment.tangentOffset - parcel.tangentOffset) +
            segment.tangentExtent / 2
        ).toBeLessThanOrEqual(parcel.tangentExtent / 2 + 1e-6)
        expect(
          Math.abs(segment.axialOffset - parcel.axialOffset) +
            segment.axialExtent / 2
        ).toBeLessThanOrEqual(parcel.axialExtent / 2 + 1e-6)

        // Clear of the fitted house box.
        const overlapsTangent =
          segment.tangentOffset - segment.tangentExtent / 2 < houseTangent[1] - 1e-6 &&
          segment.tangentOffset + segment.tangentExtent / 2 > houseTangent[0] + 1e-6
        const overlapsAxial =
          segment.axialOffset - segment.axialExtent / 2 < houseAxial[1] - 1e-6 &&
          segment.axialOffset + segment.axialExtent / 2 > houseAxial[0] + 1e-6
        expect(overlapsTangent && overlapsAxial).toBe(false)
      }

      // The street edge keeps a walkable gate lined up with the house.
      const isTangentFront = fit.front.axis === 'tangent'
      const parcelFrontEdge =
        ((isTangentFront ? parcel.tangentOffset : parcel.axialOffset) *
          fit.front.side +
          (isTangentFront ? parcel.tangentExtent : parcel.axialExtent) / 2) -
        0.36
      const houseCross = isTangentFront ? fit.axialOffset : fit.tangentOffset
      for (const segment of boundary.segments) {
        const onFrontEdge = isTangentFront
          ? segment.tangentOffset * fit.front.side > parcelFrontEdge - 0.5
          : segment.axialOffset * fit.front.side > parcelFrontEdge - 0.5
        if (!onFrontEdge) {
          continue
        }
        const crossOffset = isTangentFront ? segment.axialOffset : segment.tangentOffset
        const crossExtent = isTangentFront ? segment.axialExtent : segment.tangentExtent
        expect(Math.abs(crossOffset - houseCross) - crossExtent / 2).toBeGreaterThanOrEqual(
          1 - 1e-6
        )
        checked += 1
      }
    }
    expect(checked).toBeGreaterThan(100)
  })

  test('no road runs behind a home: the rear strip of every parcel is roadless (sampled)', () => {
    const plan = planCity(IZMA)
    const TWO_PI = Math.PI * 2
    const wrapToPi = (angle: number) => {
      const wrapped = ((angle % TWO_PI) + TWO_PI) % TWO_PI
      return wrapped > Math.PI ? wrapped - TWO_PI : wrapped
    }
    const houses = plan.buildings.filter(
      (building) => kenneyPickForBuilding(building)?.set === 'suburban'
    )
    expect(houses.length).toBeGreaterThan(200)

    for (let index = 0; index < houses.length; index += 3) {
      const building = houses[index]
      const fit = fitSuburbanHouse(building)
      if (fit === null) {
        continue
      }
      const parcel = suburbanParcelRect(building)
      const isTangentFront = fit.front.axis === 'tangent'
      const parcelF = isTangentFront ? parcel.tangentExtent : parcel.axialExtent
      const parcelC = isTangentFront ? parcel.axialExtent : parcel.tangentExtent
      const centreF = isTangentFront ? parcel.tangentOffset : parcel.axialOffset
      const centreC = isTangentFront ? parcel.axialOffset : parcel.tangentOffset
      // A 3 m strip just behind the parcel's rear boundary, slightly
      // narrowed so tiling neighbours' side lanes do not count as "behind".
      const stripDepth = 3
      const stripF = centreF - fit.front.side * (parcelF / 2 + stripDepth / 2)
      const stripTangent = isTangentFront ? stripF : centreC
      const stripAxial = isTangentFront ? centreC : stripF
      const stripTangentExtent = isTangentFront ? stripDepth : parcelC - 3
      const stripAxialExtent = isTangentFront ? parcelC - 3 : stripDepth
      const azimuth = building.azimuth + stripTangent / IZMA.radius
      const axial = building.axial + stripAxial

      for (const road of plan.roads) {
        const tangentGap =
          Math.abs(wrapToPi(azimuth - road.azimuth)) * IZMA.radius -
          (stripTangentExtent + road.tangentWidth) / 2
        const axialGap =
          Math.abs(axial - road.axial) - (stripAxialExtent + road.axialLength) / 2
        expect(Math.max(tangentGap, axialGap)).toBeGreaterThanOrEqual(-1e-6)
      }
    }
  })

  test('boundary segments never stand on a road (sampled)', () => {
    const plan = planCity(IZMA)
    const TWO_PI = Math.PI * 2
    const wrapToPi = (angle: number) => {
      const wrapped = ((angle % TWO_PI) + TWO_PI) % TWO_PI
      return wrapped > Math.PI ? wrapped - TWO_PI : wrapped
    }
    const houses = plan.buildings.filter(
      (building) => kenneyPickForBuilding(building)?.set === 'suburban'
    )

    for (let index = 0; index < houses.length; index += 3) {
      const building = houses[index]
      const fit = fitSuburbanHouse(building)
      if (fit === null) {
        continue
      }
      for (const segment of suburbanLotBoundary(building, fit).segments) {
        const azimuth = building.azimuth + segment.tangentOffset / IZMA.radius
        const axial = building.axial + segment.axialOffset
        for (const road of plan.roads) {
          const tangentGap =
            Math.abs(wrapToPi(azimuth - road.azimuth)) * IZMA.radius -
            (segment.tangentExtent + road.tangentWidth) / 2
          const axialGap =
            Math.abs(axial - road.axial) -
            (segment.axialExtent + road.axialLength) / 2
          expect(Math.max(tangentGap, axialGap)).toBeGreaterThanOrEqual(-1e-6)
        }
      }
    }
  })

  test('a plan entry without front data keeps the legacy −axial aim', () => {
    const synthetic: CityBuilding = {
      azimuth: 0.2,
      axial: 5000,
      width: 30,
      depth: 28,
      height: 9,
      tone: 0.4,
      kind: 'house',
      urban: 0.1,
      oldTown: 0
    }
    const fit = fitSuburbanHouse(synthetic)
    expect(fit).not.toBeNull()
    expect(fit?.front).toEqual({ axis: 'axial', side: -1 })
  })
})
