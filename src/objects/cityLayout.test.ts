import { describe, expect, test } from 'bun:test'

import {
  LAND_STRIP_COUNT,
  STRIP_ARC_RADIANS,
  getCityCellSize,
  getOverlookAltitude,
  getPlazaAxialHalfLength,
  getPlazaTangentHalfWidth,
  getWindowStripArcs,
  isAzimuthOnLandStrip,
  isInsidePlaza,
  planCity,
  resolveCitySurfaceCollision,
  type CityBuilding,
  type CityRoad
} from './cityLayout'

const TWO_PI = Math.PI * 2

const wrapToPi = (angle: number) => {
  const wrapped = ((angle % TWO_PI) + TWO_PI) % TWO_PI
  return wrapped > Math.PI ? wrapped - TWO_PI : wrapped
}

// Gap between a building footprint and a road rectangle in surface meters.
// Negative values mean the rectangles overlap on that axis.
const buildingRoadGaps = (building: CityBuilding, road: CityRoad, radius: number) => {
  const tangentDelta = Math.abs(wrapToPi(building.azimuth - road.azimuth)) * radius
  const axialDelta = Math.abs(building.axial - road.axial)
  return {
    tangentGap: tangentDelta - (building.width + road.tangentWidth) * 0.5,
    axialGap: axialDelta - (building.depth + road.axialLength) * 0.5
  }
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

describe('planCity', () => {
  test('is deterministic for the same seed', () => {
    const a = planCity({ radius: 18, length: 120, seed: 42 })
    const b = planCity({ radius: 18, length: 120, seed: 42 })
    expect(a).toEqual(b)
    expect(a.buildings.length).toBeGreaterThan(0)
    expect(a.roads.length).toBeGreaterThan(0)
  })

  test('different seeds produce different building layouts', () => {
    const a = planCity({ radius: 18, length: 120, seed: 1 })
    const b = planCity({ radius: 18, length: 120, seed: 2 })
    expect(a.buildings).not.toEqual(b.buildings)
    // The road grid is structural and independent of the seed.
    expect(a.roads).toEqual(b.roads)
  })

  test('all buildings sit on land strips and outside the plaza', () => {
    const radius = 18
    const { buildings } = planCity({ radius, length: 120 })

    for (const building of buildings) {
      expect(isAzimuthOnLandStrip(building.azimuth)).toBe(true)
      expect(isInsidePlaza(building.azimuth, building.axial, radius)).toBe(false)
    }
  })

  test('roads are centered on land strips', () => {
    const { roads } = planCity({ radius: 18, length: 120 })
    expect(roads.length).toBeGreaterThan(0)

    for (const road of roads) {
      expect(isAzimuthOnLandStrip(road.azimuth)).toBe(true)
    }
  })

  test('no building overlaps a road', () => {
    const radius = 18
    const { roads, buildings } = planCity({ radius, length: 120 })

    for (const building of buildings) {
      for (const road of roads) {
        const { tangentGap, axialGap } = buildingRoadGaps(building, road, radius)
        expect(Math.max(tangentGap, axialGap)).toBeGreaterThanOrEqual(-1e-6)
      }
    }
  })

  test('every building faces a nearby road', () => {
    const radius = 18
    const cell = getCityCellSize(radius)
    const { roads, buildings } = planCity({ radius, length: 120 })

    for (const building of buildings) {
      const nearestFrontage = Math.min(
        ...roads.map((road) => {
          const { tangentGap, axialGap } = buildingRoadGaps(building, road, radius)
          return Math.max(tangentGap, axialGap, 0)
        })
      )
      expect(nearestFrontage).toBeLessThanOrEqual(cell * 0.25)
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
    const { buildings } = planCity({ radius: 3200, length: 40000 })
    expect(buildings.length).toBeLessThanOrEqual(2400)
    expect(buildings.length).toBeGreaterThan(500)
  })

  test('buildings stay within the axial extent and have positive dimensions', () => {
    const length = 120
    const { buildings } = planCity({ radius: 18, length })

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
    const empty = { roads: [], buildings: [], patches: [], trees: [], tower: null }
    expect(planCity({ radius: 0, length: 120 })).toEqual(empty)
    expect(planCity({ radius: 18, length: 0 })).toEqual(empty)
  })

  test('zones some blocks as parks or farms with trees on land strips', () => {
    const radius = 18
    const { patches, trees, buildings } = planCity({ radius, length: 360 })

    expect(patches.length).toBeGreaterThan(0)
    expect(trees.length).toBeGreaterThan(0)

    for (const patch of patches) {
      expect(isAzimuthOnLandStrip(patch.azimuth)).toBe(true)
      expect(patch.tangentExtent).toBeGreaterThan(0)
      expect(patch.axialExtent).toBeGreaterThan(0)
      expect(['park', 'farm']).toContain(patch.kind)
    }

    for (const tree of trees) {
      expect(isAzimuthOnLandStrip(tree.azimuth)).toBe(true)
      expect(tree.height).toBeGreaterThan(0)
      expect(isInsidePlaza(tree.azimuth, tree.axial, radius)).toBe(false)
    }

    // Zoned blocks hold no buildings: no building center falls inside a patch.
    for (const building of buildings) {
      for (const patch of patches) {
        const tangentDelta = Math.abs(wrapToPi(building.azimuth - patch.azimuth)) * radius
        const axialDelta = Math.abs(building.axial - patch.axial)
        const inside =
          tangentDelta < patch.tangentExtent * 0.5 && axialDelta < patch.axialExtent * 0.5
        expect(inside).toBe(false)
      }
    }
  })

  test('plans the overlook tower just below the overlook altitude', () => {
    const radius = 18
    const { tower } = planCity({ radius, length: 120 })

    expect(tower).not.toBeNull()
    expect(tower?.height).toBeCloseTo(getOverlookAltitude(radius) - 1.5, 6)
    expect(tower?.deckRadius).toBeGreaterThan(0)
    // Beside the plaza, on the trailing side of the Coriolis drift.
    expect(tower!.azimuth).toBeLessThan(0)
    expect(Math.abs(tower!.azimuth) * radius).toBeLessThanOrEqual(
      getPlazaTangentHalfWidth(radius)
    )
  })

  test('opposite side of the cylinder is also populated', () => {
    const { buildings } = planCity({ radius: 18, length: 120 })
    const oppositeStrip = buildings.filter(
      (building) => Math.abs(wrapToPi(building.azimuth - (TWO_PI * 2) / 3)) < STRIP_ARC_RADIANS
    )
    expect(oppositeStrip.length).toBeGreaterThan(0)
  })
})
