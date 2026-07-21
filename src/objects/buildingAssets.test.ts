import { describe, expect, test } from 'bun:test'

import {
  KENNEY_SUBURBAN_HEIGHT_M,
  fitSuburbanHouse,
  kenneyPickForBuilding
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
