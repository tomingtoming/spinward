import { describe, expect, test } from 'bun:test'

import {
  LAND_STRIP_COUNT,
  STRIP_ARC_RADIANS,
  getPlazaAxialHalfLength,
  getPlazaTangentHalfWidth,
  getWindowStripArcs,
  isAzimuthOnLandStrip,
  isInsidePlaza,
  planCityBuildings,
  resolveCitySurfaceCollision
} from './cityLayout'

const TWO_PI = Math.PI * 2

const wrapToPi = (angle: number) => {
  const wrapped = ((angle % TWO_PI) + TWO_PI) % TWO_PI
  return wrapped > Math.PI ? wrapped - TWO_PI : wrapped
}

describe('isAzimuthOnLandStrip', () => {
  test('land strips are centered on azimuth 0 and repeat every 120 degrees', () => {
    expect(isAzimuthOnLandStrip(0)).toBe(true)
    expect(isAzimuthOnLandStrip(TWO_PI / 3)).toBe(true)
    expect(isAzimuthOnLandStrip((2 * TWO_PI) / 3)).toBe(true)
    expect(isAzimuthOnLandStrip(STRIP_ARC_RADIANS)).toBe(false)
    expect(isAzimuthOnLandStrip(Math.PI)).toBe(false)
  })

  test('handles negative and wrapped azimuths', () => {
    expect(isAzimuthOnLandStrip(-0.1)).toBe(true)
    expect(isAzimuthOnLandStrip(TWO_PI - 0.1)).toBe(true)
    expect(isAzimuthOnLandStrip(-STRIP_ARC_RADIANS)).toBe(false)
  })
})

describe('getWindowStripArcs', () => {
  test('window strips alternate with land strips', () => {
    const arcs = getWindowStripArcs()
    expect(arcs).toHaveLength(LAND_STRIP_COUNT)

    for (const arc of arcs) {
      expect(isAzimuthOnLandStrip(arc.centerAzimuth)).toBe(false)
      expect(arc.arcRadians).toBeCloseTo(STRIP_ARC_RADIANS)
    }
  })
})

describe('resolveCitySurfaceCollision', () => {
  const radius = 18
  const building = {
    azimuth: 0.5,
    axial: 10,
    width: 4,
    depth: 6,
    height: 5,
    tone: 0.5
  }

  test('does nothing when the player is clear of all footprints', () => {
    const position = { azimuth: 2, axialPosition: -40 }
    expect(resolveCitySurfaceCollision(position, [building], radius)).toBe(false)
    expect(position).toEqual({ azimuth: 2, axialPosition: -40 })
  })

  test('pushes the player out along the axis of least penetration', () => {
    // Slightly inside the tangent face: tangent penetration is smallest.
    const position = {
      azimuth: building.azimuth + (building.width * 0.5 + 0.2) / radius,
      axialPosition: building.axial
    }
    expect(resolveCitySurfaceCollision(position, [building], radius)).toBe(true)
    const tangentDelta = (position.azimuth - building.azimuth) * radius
    expect(tangentDelta).toBeCloseTo(building.width * 0.5 + 0.45, 6)
    expect(position.axialPosition).toBeCloseTo(building.axial, 6)
  })

  test('pushes out axially when the axial face is closest', () => {
    const position = {
      azimuth: building.azimuth,
      axialPosition: building.axial - (building.depth * 0.5 + 0.1)
    }
    expect(resolveCitySurfaceCollision(position, [building], radius)).toBe(true)
    expect(position.axialPosition).toBeCloseTo(building.axial - building.depth * 0.5 - 0.45, 6)
  })

  test('handles azimuth wrap-around near 2*pi', () => {
    const wrappedBuilding = { ...building, azimuth: 0.02 }
    const position = { azimuth: Math.PI * 2 - 0.01, axialPosition: wrappedBuilding.axial }
    expect(resolveCitySurfaceCollision(position, [wrappedBuilding], radius)).toBe(true)
  })

  test('dead-center overlap still resolves outward deterministically', () => {
    const position = { azimuth: building.azimuth, axialPosition: building.axial }
    expect(resolveCitySurfaceCollision(position, [building], radius)).toBe(true)
    const tangentDelta = Math.abs(position.azimuth - building.azimuth) * radius
    const axialDelta = Math.abs(position.axialPosition - building.axial)
    expect(Math.max(tangentDelta, axialDelta)).toBeGreaterThan(0)
  })
})

describe('planCityBuildings', () => {
  test('is deterministic for the same seed', () => {
    const a = planCityBuildings({ radius: 18, length: 120, seed: 42 })
    const b = planCityBuildings({ radius: 18, length: 120, seed: 42 })
    expect(a).toEqual(b)
    expect(a.length).toBeGreaterThan(0)
  })

  test('different seeds produce different layouts', () => {
    const a = planCityBuildings({ radius: 18, length: 120, seed: 1 })
    const b = planCityBuildings({ radius: 18, length: 120, seed: 2 })
    expect(a).not.toEqual(b)
  })

  test('all buildings sit on land strips and outside the plaza', () => {
    const radius = 18
    const buildings = planCityBuildings({ radius, length: 120 })

    for (const building of buildings) {
      expect(isAzimuthOnLandStrip(building.azimuth)).toBe(true)
      expect(isInsidePlaza(building.azimuth, building.axial, radius)).toBe(false)
    }
  })

  test('plaza exclusion respects tangent and axial half extents', () => {
    const radius = 18
    expect(isInsidePlaza(0, 0, radius)).toBe(true)
    expect(
      isInsidePlaza(
        (getPlazaTangentHalfWidth(radius) * 1.2) / radius,
        0,
        radius
      )
    ).toBe(false)
    expect(isInsidePlaza(0, getPlazaAxialHalfLength(radius) * 1.2, radius)).toBe(false)
  })

  test('respects the instance cap at large scales', () => {
    const buildings = planCityBuildings({ radius: 3200, length: 40000 })
    expect(buildings.length).toBeLessThanOrEqual(2400)
    expect(buildings.length).toBeGreaterThan(500)
  })

  test('buildings stay within the axial extent and have positive dimensions', () => {
    const length = 120
    const buildings = planCityBuildings({ radius: 18, length })

    for (const building of buildings) {
      expect(Math.abs(building.axial)).toBeLessThanOrEqual(length * 0.5)
      expect(building.width).toBeGreaterThan(0)
      expect(building.depth).toBeGreaterThan(0)
      expect(building.height).toBeGreaterThan(0)
      expect(building.tone).toBeGreaterThanOrEqual(0)
      expect(building.tone).toBeLessThanOrEqual(1)
    }
  })

  test('returns an empty plan for degenerate dimensions', () => {
    expect(planCityBuildings({ radius: 0, length: 120 })).toEqual([])
    expect(planCityBuildings({ radius: 18, length: 0 })).toEqual([])
  })

  test('opposite side of the cylinder is also populated', () => {
    const buildings = planCityBuildings({ radius: 18, length: 120 })
    const oppositeStrip = buildings.filter(
      (building) => Math.abs(wrapToPi(building.azimuth - (TWO_PI * 2) / 3)) < STRIP_ARC_RADIANS
    )
    expect(oppositeStrip.length).toBeGreaterThan(0)
  })
})
