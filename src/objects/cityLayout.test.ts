import { describe, expect, test } from 'bun:test'

import {
  FULL_360_TOPOLOGY,
  ISLAND_THREE_TOPOLOGY
} from '../sim/habitatConfig'
import {
  LAND_STRIP_COUNT,
  STRIP_ARC_RADIANS,
  getCityCellSize,
  getCityGroundHeight,
  getLandArcs,
  getOverlookAltitude,
  getOverlookTowerClearance,
  getPlazaAxialHalfLength,
  getPlazaTangentHalfWidth,
  getWindowArcs,
  getWindowStripArcs,
  isAzimuthOnLandArc,
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

describe('topology-aware land and window arcs', () => {
  test('the default topology reproduces the three Island Three strips and windows', () => {
    expect(getLandArcs()).toHaveLength(LAND_STRIP_COUNT)

    const windows = getWindowArcs()
    expect(windows).toHaveLength(LAND_STRIP_COUNT)

    for (const arc of windows) {
      expect(isAzimuthOnLandStrip(arc.centerAzimuth)).toBe(false)
      expect(arc.arcRadians).toBeCloseTo(STRIP_ARC_RADIANS)
    }

    // The derived windows match the legacy hardcoded strips by center.
    const legacyCenters = getWindowStripArcs()
      .map((arc) => arc.centerAzimuth)
      .sort((a, b) => a - b)
    const derivedCenters = windows.map((arc) => arc.centerAzimuth).sort((a, b) => a - b)
    for (let index = 0; index < legacyCenters.length; index += 1) {
      expect(derivedCenters[index]).toBeCloseTo(legacyCenters[index], 6)
    }
  })

  test('a full-circle land arc has no windows and is habitable everywhere', () => {
    expect(getLandArcs(FULL_360_TOPOLOGY)).toHaveLength(1)
    expect(getWindowArcs(FULL_360_TOPOLOGY)).toEqual([])

    for (const azimuth of [0, STRIP_ARC_RADIANS, Math.PI, (2 * TWO_PI) / 3, -0.7]) {
      expect(isAzimuthOnLandArc(azimuth, FULL_360_TOPOLOGY)).toBe(true)
    }
  })

  test('isAzimuthOnLandArc agrees with the legacy strip test on the default topology', () => {
    for (const azimuth of [0, STRIP_ARC_RADIANS, Math.PI, (2 * TWO_PI) / 3, -0.1]) {
      expect(isAzimuthOnLandArc(azimuth)).toBe(isAzimuthOnLandStrip(azimuth))
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
    tone: 0.5,
    kind: 'block' as const
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

  test('buildings at or below the blocking height are walked over, taller ones still block', () => {
    const position = { azimuth: building.azimuth, axialPosition: building.axial }
    expect(
      resolveCitySurfaceCollision(position, [building], radius, undefined, building.height)
    ).toBe(false)
    expect(
      resolveCitySurfaceCollision(position, [building], radius, undefined, building.height - 1)
    ).toBe(true)
  })
})

describe('getCityGroundHeight', () => {
  const radius = 18
  const building: CityBuilding = {
    azimuth: 0.5,
    axial: 10,
    width: 4,
    depth: 6,
    height: 5,
    tone: 0.5,
    kind: 'block'
  }

  test('returns the roof height over the footprint when reachable from the altitude', () => {
    expect(getCityGroundHeight([building], radius, 0.5, 10, 5)).toBeCloseTo(5, 6)
    expect(getCityGroundHeight([building], radius, 0.5, 10, 4.2)).toBeCloseTo(5, 6)
  })

  test('a tower far above your feet is a wall, not a floor', () => {
    expect(getCityGroundHeight([building], radius, 0.5, 10, 0)).toBe(0)
  })

  test('returns 0 over open ground', () => {
    expect(getCityGroundHeight([building], radius, 2.5, -30, 5)).toBe(0)
  })

  test('the tallest reachable roof wins when footprints stack', () => {
    const low = { ...building, height: 2 }
    expect(getCityGroundHeight([low, building], radius, 0.5, 10, 6)).toBeCloseTo(5, 6)
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

  test('road hierarchy: arterials wide but realistic, locals narrow', () => {
    for (const [radius, length] of [[18, 120], [3200, 40000], [30000, 2000]] as const) {
      const { roads } = planCity({ radius, length })
      const kinds = new Set(roads.map((road) => road.kind))
      expect(kinds.has('arterial')).toBe(true)
      expect(kinds.has('local')).toBe(true)

      for (const road of roads) {
        const width = Math.min(road.tangentWidth, road.axialLength)
        if (road.kind === 'arterial') {
          expect(width).toBeGreaterThanOrEqual(6)
          expect(width).toBeLessThanOrEqual(24)
        } else {
          expect(width).toBeGreaterThanOrEqual(4)
          expect(width).toBeLessThanOrEqual(8)
        }
      }
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

  test('most buildings face a nearby road (inner-ring courts face alleys)', () => {
    const radius = 18
    const cell = getCityCellSize(radius, 120)
    const { roads, buildings } = planCity({ radius, length: 120 })
    let facing = 0

    for (const building of buildings) {
      const nearestFrontage = Math.min(
        ...roads.map((road) => {
          const { tangentGap, axialGap } = buildingRoadGaps(building, road, radius)
          return Math.max(tangentGap, axialGap, 0)
        })
      )

      if (nearestFrontage <= cell * 0.25) {
        facing += 1
      }
    }

    expect(facing / buildings.length).toBeGreaterThan(0.5)
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
    expect(buildings.length).toBeLessThanOrEqual(12000)
    // The downtown/countryside urbanization field intentionally leaves the
    // outskirts to fields and low-rise hamlets, so the city no longer saturates
    // the cap — but it stays a substantial, dense-cored colony.
    expect(buildings.length).toBeGreaterThan(4000)
  })

  test('assigns building archetypes with sane shapes', () => {
    const { buildings } = planCity({ radius: 3200, length: 40000 })
    const kinds = new Set(buildings.map((b) => b.kind))

    for (const kind of ['block', 'setback', 'tower', 'house'] as const) {
      expect(kinds.has(kind)).toBe(true)
    }

    for (const building of buildings) {
      if (building.kind === 'house') {
        expect(building.height).toBeLessThanOrEqual(10)
      }
      if (building.kind === 'tower') {
        expect(building.width).toBeCloseTo(building.depth, 6)
      }
      expect(building.height).toBeLessThanOrEqual(78 + 1e-9)
    }
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

  test('the spawn plaza block is never zoned as a park or farm', () => {
    for (const radius of [18, 3200]) {
      const { patches } = planCity({ radius, length: radius === 18 ? 120 : 40000 })

      for (const patch of patches) {
        const tangentDelta = Math.abs(wrapToPi(patch.azimuth)) * radius
        const coversPlazaCenter =
          tangentDelta < patch.tangentExtent * 0.5 &&
          Math.abs(patch.axial) < patch.axialExtent * 0.5
        expect(coversPlazaCenter).toBe(false)
      }
    }
  })

  test('trees stay human-scale on giant habitats', () => {
    const { trees } = planCity({ radius: 3200, length: 40000 })
    expect(trees.length).toBeGreaterThan(0)

    for (const tree of trees) {
      expect(tree.height).toBeLessThanOrEqual(9 * 1.05)
    }
  })

  test('thin rings still get a city: cell size respects the span', () => {
    expect(getCityCellSize(30000, 2000)).toBeCloseTo(160, 6)

    const { buildings, roads } = planCity({ radius: 30000, length: 2000 })
    expect(buildings.length).toBeGreaterThan(200)
    expect(roads.length).toBeGreaterThan(0)
  })

  test('the plaza is a modest crossroads square at every scale', () => {
    expect(getPlazaTangentHalfWidth(30000)).toBe(16)
    expect(getPlazaAxialHalfLength(30000)).toBe(14)
    expect(getPlazaTangentHalfWidth(18)).toBe(8)
    expect(getPlazaAxialHalfLength(18)).toBe(8)
  })

  test('large habitats put an arterial crossroads exactly at the spawn point', () => {
    const radius = 3200
    const { roads } = planCity({ radius, length: 32000 })
    const avenueAtSpawn = roads.find(
      (road) =>
        road.kind === 'arterial' &&
        Math.abs(road.azimuth) * radius < 0.5 &&
        road.axialLength > road.tangentWidth
    )
    const streetAtSpawn = roads.find(
      (road) =>
        road.kind === 'arterial' &&
        Math.abs(road.axial) < 0.5 &&
        road.tangentWidth > road.axialLength
    )
    expect(avenueAtSpawn).toBeDefined()
    expect(streetAtSpawn).toBeDefined()
  })

  test('building heights stay in the near-1g band on giant habitats', () => {
    for (const [radius, length] of [[3200, 40000], [30000, 2000]] as const) {
      const { buildings } = planCity({ radius, length })
      expect(buildings.length).toBeGreaterThan(0)

      for (const building of buildings) {
        // heightBase clamp times tower factors, capped at 78m — still within
        // a few percent of surface gravity on the giant presets.
        expect(building.height).toBeLessThanOrEqual(78 + 1e-9)
      }
    }
  })

  test('plans the overlook tower just below the overlook altitude', () => {
    const radius = 18
    const { tower } = planCity({ radius, length: 120 })

    expect(tower).not.toBeNull()
    expect(tower?.height).toBeCloseTo(getOverlookAltitude(radius) - 1.5, 6)
    expect(tower?.deckRadius).toBeGreaterThan(0)
    // Diagonally off the spawn crossroads, on the trailing side of the
    // Coriolis drift, clear of both arterials.
    expect(tower!.azimuth).toBeLessThan(0)
    expect(Math.abs(tower!.azimuth) * radius).toBeCloseTo(
      getOverlookTowerClearance(radius),
      6
    )
    expect(tower!.axial).toBeCloseTo(getOverlookTowerClearance(radius), 6)
  })

  test('opposite side of the cylinder is also populated', () => {
    const { buildings } = planCity({ radius: 18, length: 120 })
    const oppositeStrip = buildings.filter(
      (building) => Math.abs(wrapToPi(building.azimuth - (TWO_PI * 2) / 3)) < STRIP_ARC_RADIANS
    )
    expect(oppositeStrip.length).toBeGreaterThan(0)
  })

  test('an explicit Island Three topology reproduces the default city exactly', () => {
    const base = planCity({ radius: 18, length: 120, seed: 7 })
    const explicit = planCity({
      radius: 18,
      length: 120,
      seed: 7,
      topology: ISLAND_THREE_TOPOLOGY
    })
    expect(explicit).toEqual(base)
  })

  test('a full-circle topology wraps the city around the entire circumference', () => {
    const { buildings, roads } = planCity({
      radius: 3200,
      length: 32000,
      topology: FULL_360_TOPOLOGY
    })

    expect(buildings.length).toBeGreaterThan(0)
    expect(roads.length).toBeGreaterThan(0)

    // The city now fills the former window gaps — buildings appear off the
    // three Island Three land strips.
    const inFormerWindows = buildings.filter(
      (building) => !isAzimuthOnLandStrip(building.azimuth)
    )
    expect(inFormerWindows.length).toBeGreaterThan(0)

    // Every building still sits on the (now full-circle) habitable wall.
    for (const building of buildings) {
      expect(isAzimuthOnLandArc(building.azimuth, FULL_360_TOPOLOGY)).toBe(true)
    }
  })
})
