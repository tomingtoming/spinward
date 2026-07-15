import { describe, expect, test } from 'bun:test'

import {
  getBuildingChordDistance,
  getBuildingSurfaceDistance,
  selectDetailedBuildingLod
} from './buildingLod'

describe('building LOD distance', () => {
  test('surface distance wraps cleanly across the azimuth seam', () => {
    const radius = 100
    const distance = getBuildingSurfaceDistance(
      radius,
      Math.PI - 0.01,
      0,
      -Math.PI + 0.01,
      0
    )

    expect(distance).toBeCloseTo(2, 6)
  })

  test('surface distance includes axial separation', () => {
    expect(getBuildingSurfaceDistance(100, 0, 10, 0, 310)).toBe(300)
  })

  test('chord distance measures the opposite wall as two radii away', () => {
    expect(getBuildingChordDistance(3200, 0, 0, Math.PI, 0)).toBeCloseTo(
      6400,
      6
    )
  })
})

describe('building LOD hysteresis', () => {
  const thresholds = {
    lod0Distance: 100,
    lod1Distance: 300,
    hysteresisFraction: 0.1
  }

  test('classifies a new building at the nominal boundaries', () => {
    expect(selectDetailedBuildingLod(80, null, thresholds)).toBe(0)
    expect(selectDetailedBuildingLod(180, null, thresholds)).toBe(1)
    expect(selectDetailedBuildingLod(380, null, thresholds)).toBeNull()
  })

  test('keeps the previous LOD inside its hysteresis band', () => {
    expect(selectDetailedBuildingLod(108, 0, thresholds)).toBe(0)
    expect(selectDetailedBuildingLod(108, 1, thresholds)).toBe(1)
    expect(selectDetailedBuildingLod(325, 1, thresholds)).toBe(1)
    expect(selectDetailedBuildingLod(335, 1, thresholds)).toBeNull()
  })
})
