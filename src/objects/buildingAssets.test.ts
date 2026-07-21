import { describe, expect, test } from 'bun:test'

import {
  KENNEY_SUBURBAN_HEIGHT_M,
  fitSuburbanHouse,
  kenneyPickForBuilding,
  suburbanLotBoundary
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
        expect(Math.min(building.width, building.depth)).toBeLessThan(12)
      }
    }
    expect(fullStature / houses.length).toBeGreaterThan(0.9)
  })

  test('the house stays inside its lot with a street-front lawn of ≤3 m', () => {
    for (const building of suburbanHouses()) {
      const fit = fitSuburbanHouse(building)
      if (fit === null) {
        continue
      }

      expect(Math.abs(fit.tangentOffset) + fit.tangentExtent / 2).toBeLessThanOrEqual(
        building.width / 2 + 1e-6
      )
      expect(Math.abs(fit.axialOffset) + fit.axialExtent / 2).toBeLessThanOrEqual(
        building.depth / 2 + 1e-6
      )

      const frontLot = fit.front.axis === 'tangent' ? building.width : building.depth
      const frontExtent =
        fit.front.axis === 'tangent' ? fit.tangentExtent : fit.axialExtent
      const frontOffset =
        fit.front.axis === 'tangent' ? fit.tangentOffset : fit.axialOffset
      const setback =
        frontLot / 2 - (frontOffset * fit.front.side + frontExtent / 2)
      expect(setback).toBeGreaterThanOrEqual(-1e-6)
      expect(setback).toBeLessThanOrEqual(3 + 1e-6)
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

      for (const segment of boundary.segments) {
        // Inside the lot.
        expect(
          Math.abs(segment.tangentOffset) + segment.tangentExtent / 2
        ).toBeLessThanOrEqual(building.width / 2 + 1e-6)
        expect(
          Math.abs(segment.axialOffset) + segment.axialExtent / 2
        ).toBeLessThanOrEqual(building.depth / 2 + 1e-6)

        // Clear of the fitted house box.
        const overlapsTangent =
          segment.tangentOffset - segment.tangentExtent / 2 < houseTangent[1] - 1e-6 &&
          segment.tangentOffset + segment.tangentExtent / 2 > houseTangent[0] + 1e-6
        const overlapsAxial =
          segment.axialOffset - segment.axialExtent / 2 < houseAxial[1] - 1e-6 &&
          segment.axialOffset + segment.axialExtent / 2 > houseAxial[0] + 1e-6
        expect(overlapsTangent && overlapsAxial).toBe(false)
      }

      // The street edge keeps a walkable gate on the lot's cross centre.
      const isTangentFront = fit.front.axis === 'tangent'
      const frontEdge =
        (isTangentFront ? building.width : building.depth) / 2 - 0.36
      for (const segment of boundary.segments) {
        const onFrontEdge = isTangentFront
          ? segment.tangentOffset * fit.front.side > frontEdge - 0.5
          : segment.axialOffset * fit.front.side > frontEdge - 0.5
        if (!onFrontEdge) {
          continue
        }
        const crossOffset = isTangentFront ? segment.axialOffset : segment.tangentOffset
        const crossExtent = isTangentFront ? segment.axialExtent : segment.tangentExtent
        expect(Math.abs(crossOffset) - crossExtent / 2).toBeGreaterThanOrEqual(1 - 1e-6)
        checked += 1
      }
    }
    expect(checked).toBeGreaterThan(100)
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
