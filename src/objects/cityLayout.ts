import {
  ISLAND_THREE_TOPOLOGY,
  type HabitatTopology,
  type LandArc
} from '../sim/habitatConfig'

const TWO_PI = Math.PI * 2
const ARC_EPSILON = 1e-6

export type BuildingKind = 'block' | 'setback' | 'tower' | 'house' | 'slab' | 'lshape'

export type CityBuilding = {
  azimuth: number
  axial: number
  width: number
  depth: number
  height: number
  tone: number
  kind: BuildingKind
  // 0..1 urbanization at this lot (downtown = 1). Drives the facade palette;
  // optional so synthetic footprints (tower, tests) can omit it.
  urban?: number
}

export type RoadKind = 'arterial' | 'local'

export type CityRoad = {
  azimuth: number
  axial: number
  tangentWidth: number
  axialLength: number
  kind: RoadKind
}

export type CityPatchKind = 'park' | 'farm'

export type CityPatch = {
  azimuth: number
  axial: number
  tangentExtent: number
  axialExtent: number
  kind: CityPatchKind
}

export type CityTree = {
  azimuth: number
  axial: number
  height: number
  tone: number
}

export type CityTower = {
  azimuth: number
  axial: number
  height: number
  deckRadius: number
}

// One-off civic dome near the plaza — the city's "face" and a navigation
// anchor, mirroring the overlook tower across the spawn crossroads.
export type CityLandmark = {
  azimuth: number
  axial: number
  domeRadius: number
}

// The elevated expressway ring: one full-circumference deck at a fixed axial
// position beside downtown. Buildings keep out of its corridor the same way
// they keep out of the plaza.
// An on-ramp: a lane beside the deck that climbs from the ground to deck
// height along +azimuth. One per land strip, so the three of them sit 120
// degrees apart and the co-rotating colliders stay symmetric about the axis.
export type ExpresswayRamp = {
  azimuthStart: number
  azimuthSpan: number
}

export type CityExpressway = {
  axial: number
  corridorHalfWidth: number
  deckHeight: number
  deckWidth: number
  rampWidth: number
  // Azimuth span of the collector past each ramp top: the deck is locally
  // widened to under the (straight) ramp lane and an angled barrier funnels
  // traffic onto the main carriageway — hold-the-throttle merging, like a
  // real highway gore.
  collectorSpan: number
  ramps: ExpresswayRamp[]
}

export type CityPlan = {
  roads: CityRoad[]
  buildings: CityBuilding[]
  patches: CityPatch[]
  trees: CityTree[]
  tower: CityTower | null
  landmark: CityLandmark | null
  expressway: CityExpressway | null
}

export type CityPlanConfig = {
  radius: number
  length: number
  seed?: number
  maxBuildings?: number
  topology?: HabitatTopology
}

export type WindowStripArc = {
  centerAzimuth: number
  arcRadians: number
}

export const LAND_STRIP_COUNT = 3
export const STRIP_ARC_RADIANS = TWO_PI / (LAND_STRIP_COUNT * 2)
// Buildings stay inside this fraction of a land strip so streets remain
// along the window edges.
const LAND_STRIP_USABLE_FRACTION = 0.94
const DEFAULT_SEED = 0x1f2e3d4c
const DEFAULT_MAX_BUILDINGS = 12000
// Blocks are sized in surface meters relative to the city cell.
const BLOCK_TANGENT_CELLS = 3
const BLOCK_AXIAL_CELLS = 4
const LOT_FRACTION = 0.62
const MAX_KEEP_PROBABILITY = 0.92
const PARK_BLOCK_PROBABILITY = 0.08
const FARM_BLOCK_PROBABILITY = 0.1
const MAX_TREES = 1500
// Building rows nest inward until the block core is used up.
const MAX_BLOCK_RINGS = 4

const createRandom = (seed: number) => {
  let state = seed >>> 0

  return () => {
    state = (1664525 * state + 1013904223) >>> 0
    return state / 0xffffffff
  }
}

const wrapToPi = (angle: number) => {
  const wrapped = ((angle % TWO_PI) + TWO_PI) % TWO_PI
  return wrapped > Math.PI ? wrapped - TWO_PI : wrapped
}

export const getLandStripCenters = () =>
  Array.from({ length: LAND_STRIP_COUNT }, (_, index) => (index * TWO_PI) / LAND_STRIP_COUNT)

export const getWindowStripArcs = (): WindowStripArc[] =>
  Array.from({ length: LAND_STRIP_COUNT }, (_, index) => ({
    centerAzimuth: STRIP_ARC_RADIANS + (index * TWO_PI) / LAND_STRIP_COUNT,
    arcRadians: STRIP_ARC_RADIANS
  }))

export const isAzimuthOnLandStrip = (azimuth: number) => {
  const shifted = ((azimuth + STRIP_ARC_RADIANS * 0.5) % TWO_PI + TWO_PI) % TWO_PI
  return Math.floor(shifted / STRIP_ARC_RADIANS) % 2 === 0
}

// ── Topology-aware land / window arcs ───────────────────────────────────
// The land arcs are the single source of truth for habitable wall; windows
// are derived as their azimuthal complement. The default reproduces the
// legacy three-strip Island Three layout, so untouched callers and the
// existing tests keep their exact behavior.

export const getLandArcs = (
  topology: HabitatTopology = ISLAND_THREE_TOPOLOGY
): LandArc[] => topology.landArcs

// Windows are the gaps between consecutive land arcs around the circle. A
// single arc that spans the whole circle (Cooper) leaves no gaps, so there
// are no windows.
export const getWindowArcs = (
  topology: HabitatTopology = ISLAND_THREE_TOPOLOGY
): WindowStripArc[] => {
  const arcs = getLandArcs(topology)

  if (arcs.length === 0) {
    return []
  }

  const covered = arcs.reduce((sum, arc) => sum + arc.arcRadians, 0)

  if (covered >= TWO_PI - ARC_EPSILON) {
    return []
  }

  const intervals = arcs
    .map((arc) => ({
      start: ((arc.centerAzimuth - arc.arcRadians * 0.5) % TWO_PI + TWO_PI) % TWO_PI,
      length: arc.arcRadians
    }))
    .sort((a, b) => a.start - b.start)

  const windows: WindowStripArc[] = []

  for (let index = 0; index < intervals.length; index += 1) {
    const current = intervals[index]
    const next = intervals[(index + 1) % intervals.length]
    const gapStart = current.start + current.length
    const gapEnd = index + 1 < intervals.length ? next.start : next.start + TWO_PI
    const gapSpan = gapEnd - gapStart

    if (gapSpan > ARC_EPSILON) {
      windows.push({
        centerAzimuth: ((gapStart + gapSpan * 0.5) % TWO_PI + TWO_PI) % TWO_PI,
        arcRadians: gapSpan
      })
    }
  }

  return windows
}

export const isAzimuthOnLandArc = (
  azimuth: number,
  topology: HabitatTopology = ISLAND_THREE_TOPOLOGY
) => {
  for (const arc of getLandArcs(topology)) {
    if (Math.abs(wrapToPi(azimuth - arc.centerAzimuth)) <= arc.arcRadians * 0.5 + ARC_EPSILON) {
      return true
    }
  }

  return false
}

// City cell scale follows the smaller of the two habitat dimensions, so
// thin rings (span << radius) still get a walkable street grid.
export const getCityCellSize = (radius: number, length = Number.POSITIVE_INFINITY) =>
  Math.max(6, Math.min(radius * 0.025, length * 0.08))

// Realistic road widths in absolute meters: arterials top out at a wide
// boulevard, residential streets stay narrow regardless of habitat scale.
export const getArterialRoadWidth = (radius: number, length?: number) =>
  Math.min(24, Math.max(6, getCityCellSize(radius, length) * 0.5))

export const getLocalRoadWidth = (radius: number, length?: number) =>
  Math.min(8, Math.max(4, getCityCellSize(radius, length) * 0.28))

export const getSidewalkWidth = (radius: number, length?: number) =>
  Math.min(5, Math.max(1.2, getCityCellSize(radius, length) * 0.15))

// Even block counts put an avenue at the strip center and a street at
// axial 0: the spawn point lands exactly on an arterial crossroads.
// Habitats too small for two viable blocks keep a single one instead of
// collapsing below the minimum block size.
export const evenBlockCount = (raw: number) =>
  Math.round(raw) < 2 ? Math.max(1, Math.round(raw)) : 2 * Math.max(1, Math.round(raw / 2))

// The axial pitch of the cross-street grid — shared by planCity and the
// expressway placement so the ramp mouths can sit ON street rows.
export const getCityBlockLength = (radius: number, length: number) => {
  const cell = getCityCellSize(radius, length)
  const axialExtent = Math.max(0, length * 0.5 - cell) * 2

  if (axialExtent <= 0) {
    return 0
  }

  return axialExtent / evenBlockCount(axialExtent / (cell * BLOCK_AXIAL_CELLS))
}

// Spawn plaza around (azimuth 0, axial 0) is kept clear of buildings so the
// start marker and respawn point stay walkable.
// Human-scale: clamped in absolute meters so giant habitats do not carve
// kilometer-wide empty fields around the spawn.
// A modest crossroads square, not a vast clearing: the spawn sits on an
// arterial intersection and the city starts right at the sidewalk.
export const getPlazaTangentHalfWidth = (radius: number) =>
  Math.min(16, Math.max(8, radius * 0.04))
export const getPlazaAxialHalfLength = (radius: number) =>
  Math.min(14, Math.max(8, radius * 0.04))

// Overlook travel altitude above the surface — shared with the respawn logic
// so the observation tower tops out just below the spawn point.
export const getOverlookAltitude = (radius: number) =>
  Math.min(60, Math.max(8, radius * 0.5))

export const getOverlookTowerClearance = (radius: number) => {
  const deckRadius = Math.min(12, Math.max(2, radius * 0.12))
  return (
    getArterialRoadWidth(radius) * 0.5 + getSidewalkWidth(radius) + deckRadius + 4
  )
}

// Mirrored across the spawn crossroads from the overlook tower, so the two
// landmarks bracket the plaza and give the player an instant sense of
// direction. Same clearance dance as the tower: buildings keep out of its lot.
export const getPlazaLandmark = (radius: number): CityLandmark => {
  const clearance = getOverlookTowerClearance(radius)

  return {
    azimuth: clearance / radius,
    axial: -clearance,
    domeRadius: Math.min(16, Math.max(3.5, radius * 0.09))
  }
}

// The ring runs just south of the plaza block so it fills the spawn vista
// without cutting the crossroads. Small habitats skip it: an 18 m viaduct
// on a playground-sized drum would be a wall, not a skyline.
export const getCityExpressway = (
  radius: number,
  length: number
): CityExpressway | null => {
  if (radius < 800) {
    return null
  }

  const deckWidth = Math.min(18, Math.max(10, getArterialRoadWidth(radius, length) * 0.7))
  const deckHeight = 18
  // ~5% grade: comfortable to drive, short enough to read as one structure.
  const rampSpan = (deckHeight / 0.05) / radius
  // Wide enough to steer onto at speed — covers the street's viaduct-side
  // half plus a couple of metres past the centreline, so straddling the
  // middle line still catches the treads.
  const rampWidth = 14

  // Anchor the RAMP MOUTHS on a cross-street row: on foot a half-metre kerb
  // is a step, but the car can only enter the ramp head-on along its lane, so
  // the lane must BE a road — drive the cross street through the avenue
  // junction and the tarmac simply continues up the viaduct.
  const blockLength = getCityBlockLength(radius, length)
  const targetAxial = -Math.max(140, Math.min(400, radius * 0.055))
  const streetRow =
    blockLength > 0 && Math.abs(blockLength) < length * 0.35
      ? -Math.max(1, Math.round(-targetAxial / blockLength)) * blockLength
      : targetAxial
  // The ramp lane takes the street's VIADUCT-SIDE HALF (its outer edge on the
  // centreline), like a real on-ramp fork: keep to that half and the tarmac
  // lifts you; the other half passes underneath. Overlapping the whole street
  // put the 12 m lane in the middle of a 24 m road, so most approaches simply
  // slipped past the rising treads at ground level.
  const axial = streetRow - rampWidth - deckWidth * 0.5

  return {
    axial,
    // The corridor also shields the ramp lane beside the deck.
    corridorHalfWidth: deckWidth * 0.5 + rampWidth + 4,
    deckHeight,
    deckWidth,
    rampWidth,
    // ~3.5-degree funnel: rampWidth of axial taper over ~240 m of arc.
    collectorSpan: (rampWidth / Math.tan(0.06)) / radius,
    // Ramp mouths open just past each strip's avenue junction — far enough
    // that the flat approach apron (~15% of the span) clears the crossing
    // instead of spilling across to its far side.
    // The mouth opens one apron-length past the avenue junction, so the flat
    // approach apron (15% of the span, drawn/backfilled behind the mouth)
    // begins right where you exit the junction WITHOUT spilling back across
    // it (that regression made the apron slice diagonally over the avenue).
    ramps: getLandStripCenters().map((center) => ({
      azimuthStart:
        center +
        (rampSpan * radius * 0.15 +
          getArterialRoadWidth(radius, length) * 0.5 +
          6) /
          radius,
      azimuthSpan: rampSpan
    }))
  }
}

// The drivable/walkable elevation of the expressway surface at a point, in
// metres above the wall. 0 anywhere off the structure — including UNDER the
// deck, where the street level is the real surface; callers decide by
// altitude which of the two levels applies (same contract as roof standing).
// This is the single source of truth the physics colliders, the car's
// grounding, the walker's ground sampler and the visual ramps all follow.
export const getExpresswayElevation = (
  expressway: CityExpressway,
  radius: number,
  azimuth: number,
  axial: number
): number => {
  if (Math.abs(axial - expressway.axial) <= expressway.deckWidth * 0.5) {
    return expressway.deckHeight
  }

  if (radius <= 0) {
    return 0
  }

  const laneInner = expressway.axial + expressway.deckWidth * 0.5
  const laneOuter = laneInner + expressway.rampWidth

  for (const ramp of expressway.ramps) {
    const progress = wrapToPi(azimuth - ramp.azimuthStart) / ramp.azimuthSpan

    // The climb itself, in the straight ramp lane beside the deck.
    if (
      progress >= 0 &&
      progress <= 1 &&
      axial >= laneInner &&
      axial <= laneOuter
    ) {
      return expressway.deckHeight * progress
    }

    // The collector past the top: deck height across the widened band (deck
    // plus lane) while the barrier funnels traffic onto the carriageway.
    if (
      progress > 1 &&
      progress <= 1 + expressway.collectorSpan / ramp.azimuthSpan &&
      axial >= expressway.axial - expressway.deckWidth * 0.5 &&
      axial <= laneOuter
    ) {
      return expressway.deckHeight
    }
  }

  return 0
}

export const getOverlookTower = (radius: number): CityTower => {
  const deckRadius = Math.min(12, Math.max(2, radius * 0.12))
  // Diagonally off the spawn crossroads, clear of both arterials, trailing
  // the Coriolis drift of the overlook drop so the falling player slides
  // past the column instead of through it. Building placement keeps a
  // matching exclusion zone around it.
  const clearance = getOverlookTowerClearance(radius)

  return {
    azimuth: -clearance / radius,
    axial: clearance,
    height: Math.max(4, getOverlookAltitude(radius) - 1.5),
    deckRadius
  }
}

export const isInsidePlaza = (
  azimuth: number,
  axial: number,
  radius: number
) => {
  const tangentOffset = Math.abs(wrapToPi(azimuth)) * radius
  return (
    tangentOffset < getPlazaTangentHalfWidth(radius) &&
    Math.abs(axial) < getPlazaAxialHalfLength(radius)
  )
}

// ── Collision spatial index ─────────────────────────────────────────────
// The per-frame collision queries (walking, driving, ground height, free-fly
// confinement) used to scan every building. A coarse grid over the unrolled
// surface (tangent meters x axial meters) keeps them O(1) however dense the
// city gets. Buildings are inserted with a margin that covers every query
// clearance in use, so a lookup of the single containing cell suffices.

const COLLISION_CELL_SIZE = 64
const COLLISION_INSERT_MARGIN = 8

const positiveModulo = (value: number, modulus: number) =>
  ((value % modulus) + modulus) % modulus

export type CityCollisionIndex = {
  readonly kind: 'city-collision-index'
  readonly radius: number
  readonly azimuthCellCount: number
  readonly axialCellCount: number
  readonly axialMin: number
  readonly axialCellSize: number
  readonly cells: ReadonlyMap<number, readonly CityBuilding[]>
  readonly all: readonly CityBuilding[]
}

export type CityBuildingSource = readonly CityBuilding[] | CityCollisionIndex

const EMPTY_BUILDINGS: readonly CityBuilding[] = []

export const buildCityCollisionIndex = (
  buildings: readonly CityBuilding[],
  radius: number,
  length: number
): CityCollisionIndex => {
  const circumference = Math.max(Math.PI * 2 * radius, 1e-6)
  const azimuthCellCount = Math.max(1, Math.round(circumference / COLLISION_CELL_SIZE))
  const tangentCellSize = circumference / azimuthCellCount
  const axialMin = -length * 0.5
  const axialCellCount = Math.max(1, Math.ceil(Math.max(length, 1e-6) / COLLISION_CELL_SIZE))
  const axialCellSize = Math.max(length, 1e-6) / axialCellCount
  const cells = new Map<number, CityBuilding[]>()

  for (const building of buildings) {
    const halfWidth = building.width * 0.5 + COLLISION_INSERT_MARGIN
    const halfDepth = building.depth * 0.5 + COLLISION_INSERT_MARGIN
    const tangentCenter = positiveModulo(building.azimuth, TWO_PI) * radius
    const columnStart = Math.floor((tangentCenter - halfWidth) / tangentCellSize)
    const columnEnd = Math.floor((tangentCenter + halfWidth) / tangentCellSize)
    const rowStart = Math.max(
      0,
      Math.floor((building.axial - halfDepth - axialMin) / axialCellSize)
    )
    const rowEnd = Math.min(
      axialCellCount - 1,
      Math.floor((building.axial + halfDepth - axialMin) / axialCellSize)
    )

    for (let column = columnStart; column <= columnEnd; column += 1) {
      const wrappedColumn =
        ((column % azimuthCellCount) + azimuthCellCount) % azimuthCellCount

      for (let row = rowStart; row <= rowEnd; row += 1) {
        const key = row * azimuthCellCount + wrappedColumn
        const bucket = cells.get(key)

        if (bucket === undefined) {
          cells.set(key, [building])
        } else {
          bucket.push(building)
        }
      }
    }
  }

  return {
    kind: 'city-collision-index',
    radius,
    azimuthCellCount,
    axialCellCount,
    axialMin,
    axialCellSize,
    cells,
    all: buildings
  }
}

export const queryCityBuildingsNear = (
  index: CityCollisionIndex,
  azimuth: number,
  axialPosition: number
): readonly CityBuilding[] => {
  const tangent = positiveModulo(azimuth, TWO_PI) * index.radius
  const circumference = TWO_PI * index.radius
  const column = Math.min(
    index.azimuthCellCount - 1,
    Math.max(0, Math.floor((tangent / circumference) * index.azimuthCellCount))
  )
  const row = Math.min(
    index.axialCellCount - 1,
    Math.max(0, Math.floor((axialPosition - index.axialMin) / index.axialCellSize))
  )
  return index.cells.get(row * index.azimuthCellCount + column) ?? EMPTY_BUILDINGS
}

export const resolveBuildingsNear = (
  source: CityBuildingSource,
  azimuth: number,
  axialPosition: number
): readonly CityBuilding[] =>
  'kind' in source
    ? queryCityBuildingsNear(source, azimuth, axialPosition)
    : source

// Collect every building within a square window of cells around (azimuth,
// axialPosition), deduplicated into `out`. Used to stream a small active set of
// Rapier colliders around the car/walker (a building can sit in several cells,
// hence the Set). cellRadius 1 = a 3x3 cell window (~192 m at the 64 m grid).
export const collectCityBuildingsInWindow = (
  index: CityCollisionIndex,
  azimuth: number,
  axialPosition: number,
  cellRadius: number,
  out: Set<CityBuilding>
): Set<CityBuilding> => {
  out.clear()
  const circumference = TWO_PI * index.radius
  const tangent = positiveModulo(azimuth, TWO_PI) * index.radius
  const centerColumn = Math.floor((tangent / circumference) * index.azimuthCellCount)
  const centerRow = Math.floor((axialPosition - index.axialMin) / index.axialCellSize)

  for (let dc = -cellRadius; dc <= cellRadius; dc += 1) {
    const column =
      (((centerColumn + dc) % index.azimuthCellCount) + index.azimuthCellCount) %
      index.azimuthCellCount

    for (let dr = -cellRadius; dr <= cellRadius; dr += 1) {
      const row = centerRow + dr

      if (row < 0 || row >= index.axialCellCount) {
        continue
      }

      const bucket = index.cells.get(row * index.azimuthCellCount + column)

      if (bucket !== undefined) {
        for (const building of bucket) {
          out.add(building)
        }
      }
    }
  }

  return out
}

// Walking collision against building footprints, resolved in the unrolled
// surface plane (tangent meters x axial meters). Pushes the position out of
// any overlapped footprint along the axis of least penetration.
export const resolveCitySurfaceCollision = (
  position: { azimuth: number; axialPosition: number },
  buildings: CityBuildingSource,
  radius: number,
  clearance = 0.45,
  // Buildings no taller than this do not block: someone standing on a roof
  // walks over every neighbour at or below their feet.
  minBlockingHeight = 0
) => {
  if (radius <= 0) {
    return false
  }

  let moved = false

  for (const building of resolveBuildingsNear(
    buildings,
    position.azimuth,
    position.axialPosition
  )) {
    if (building.height <= minBlockingHeight) {
      continue
    }

    const halfWidth = building.width * 0.5 + clearance
    const halfDepth = building.depth * 0.5 + clearance
    const tangentDelta = wrapToPi(position.azimuth - building.azimuth) * radius
    const axialDelta = position.axialPosition - building.axial

    if (Math.abs(tangentDelta) >= halfWidth || Math.abs(axialDelta) >= halfDepth) {
      continue
    }

    const tangentPenetration = halfWidth - Math.abs(tangentDelta)
    const axialPenetration = halfDepth - Math.abs(axialDelta)

    if (tangentPenetration < axialPenetration) {
      const side = tangentDelta >= 0 ? 1 : -1
      position.azimuth = building.azimuth + (side * halfWidth) / radius
    } else {
      const side = axialDelta >= 0 ? 1 : -1
      position.axialPosition = building.axial + side * halfDepth
    }

    moved = true
  }

  return moved
}

// The walkable ground height at a surface point: the tallest building roof
// underfoot that is reachable from the current altitude (you stand on what
// is at or just below your feet — a tower far above you is a wall, not a
// floor). Returns 0 over open ground.
export const getCityGroundHeight = (
  buildings: CityBuildingSource,
  radius: number,
  azimuth: number,
  axialPosition: number,
  altitude: number,
  stepTolerance = 1.5
) => {
  if (radius <= 0) {
    return 0
  }

  let groundHeight = 0

  for (const building of resolveBuildingsNear(buildings, azimuth, axialPosition)) {
    if (
      building.height <= groundHeight ||
      building.height > altitude + stepTolerance
    ) {
      continue
    }

    const halfWidth = building.width * 0.5 + 0.3
    const halfDepth = building.depth * 0.5 + 0.3

    if (
      Math.abs(wrapToPi(azimuth - building.azimuth) * radius) < halfWidth &&
      Math.abs(axialPosition - building.axial) < halfDepth
    ) {
      groundHeight = building.height
    }
  }

  return groundHeight
}

// Generates a street grid per land strip and lines the resulting blocks with
// buildings that face the surrounding roads (perimeter-block city pattern).
export const planCity = (config: CityPlanConfig): CityPlan => {
  const { radius, length } = config

  if (radius <= 0 || length <= 0) {
    return {
      roads: [],
      buildings: [],
      patches: [],
      trees: [],
      tower: null,
      landmark: null,
      expressway: null
    }
  }

  const maxBuildings = config.maxBuildings ?? DEFAULT_MAX_BUILDINGS
  const random = createRandom(config.seed ?? DEFAULT_SEED)
  const cell = getCityCellSize(radius, length)
  const arterialWidth = getArterialRoadWidth(radius, length)
  const localWidth = getLocalRoadWidth(radius, length)
  const sidewalk = getSidewalkWidth(radius, length)
  // Strip edges plus every Nth boundary carry the arterials; the rest are
  // residential streets.
  const avenueKindAt = (index: number): RoadKind =>
    index === 0 ||
    index === blocksTangentCount ||
    index === blocksTangentCount / 2 ||
    index % 3 === 0
      ? 'arterial'
      : 'local'
  const streetKindAt = (index: number): RoadKind =>
    index === 0 ||
    index === blocksAxialCount ||
    index === blocksAxialCount / 2 ||
    index % 4 === 0
      ? 'arterial'
      : 'local'
  const roadWidthFor = (kind: RoadKind) =>
    kind === 'arterial' ? arterialWidth : localWidth
  const lot = cell * LOT_FRACTION
  // Buildings are human habitation: spin gravity falls off linearly with
  // height (g(h) = g0 * (1 - h/R)), so everyday buildings cling to the 1g
  // band near the surface. The absolute clamp keeps even giant habitats'
  // towers within a few percent of surface gravity.
  const heightBase = Math.min(radius * 0.22, cell * 2.4, 55)
  // Land coverage is data-driven: the default three-strip topology gives the
  // exact legacy geometry, while a single full-circle arc (Cooper) wraps the
  // whole circumference and skips the usable-fraction shrink (no window edges
  // to keep buildings off). Uniform arcs let us size the grid off the first.
  const landArcs = getLandArcs(config.topology)
  const arcSpan = landArcs[0]?.arcRadians ?? STRIP_ARC_RADIANS
  const wrapTangent = arcSpan >= TWO_PI - ARC_EPSILON
  const usableArc = wrapTangent ? arcSpan : arcSpan * LAND_STRIP_USABLE_FRACTION
  const tangentExtent = usableArc * radius
  const axialHalf = Math.max(0, length * 0.5 - cell)
  const axialExtent = axialHalf * 2

  // City "メリハリ": a downtown over the plaza (strip centre, axial 0) that falls
  // off to pastoral countryside at the strip edges. Drives building height,
  // density, archetype mix and farm-vs-built zoning so high-rises cluster where
  // people concentrate and fields take the outskirts. Computed per land strip
  // from a building/block's tangential + axial position, so it needs no RNG and
  // never changes the deterministic roll order.
  const clamp01 = (value: number) => Math.min(1, Math.max(0, value))
  const urbanizationAt = (tangentMeters: number, axialMeters: number) => {
    const tNorm = tangentExtent > 0 ? tangentMeters / (tangentExtent * 0.5) : 0
    const aNorm = axialHalf > 0 ? axialMeters / axialHalf : 0
    // Broad downtown over the plaza, easing through suburb to countryside.
    const core = Math.max(0, 1 - Math.hypot(tNorm, aNorm * 0.85) * 0.82)
    // A secondary district offset down one end so it is not a lone bullseye.
    const district = 0.7 * Math.max(0, 1 - Math.hypot((tNorm + 0.5) * 1.3, (aNorm - 0.55) * 1.1))
    // Low-frequency ripple so the urban edge is ragged, not a clean circle.
    const ripple = 0.12 * Math.cos(aNorm * 4.1) * Math.cos(tNorm * 3.3)
    // A suburban baseline so the outskirts keep scattered hamlets between the
    // fields rather than emptying to pure wilderness.
    return clamp01(Math.max(core, district) + ripple + 0.2)
  }

  const blocksTangentCount = evenBlockCount(tangentExtent / (cell * BLOCK_TANGENT_CELLS))
  const blocksAxialCount = evenBlockCount(axialExtent / (cell * BLOCK_AXIAL_CELLS))
  const blockWidth = tangentExtent / blocksTangentCount
  const blockLength = axialExtent / blocksAxialCount

  // Mirror the placement math exactly so keepProbability is accurate —
  // an inflated estimate starves the city instead of filling it.
  const innerWidthEstimate = blockWidth - localWidth - sidewalk * 2
  const innerLengthEstimate = blockLength - localWidth - sidewalk * 2
  let lotsPerBlockEstimate = 0
  {
    let estWidth = innerWidthEstimate
    let estLength = innerLengthEstimate

    for (let ring = 0; ring < MAX_BLOCK_RINGS; ring += 1) {
      if (estWidth < cell * 0.6 || estLength < cell * 0.6) {
        break
      }

      const ringDepth = Math.min(cell * 0.9, estWidth * 0.35, estLength * 0.35)
      lotsPerBlockEstimate +=
        2 * Math.max(0, Math.floor(estLength / lot)) +
        2 * Math.max(0, Math.floor((estWidth - 2 * (ringDepth + sidewalk)) / lot))
      const inset = 2 * (ringDepth + sidewalk * 1.5)
      estWidth -= inset
      estLength -= inset
    }
  }
  const candidateEstimate =
    lotsPerBlockEstimate * blocksTangentCount * blocksAxialCount * landArcs.length
  const keepProbability = Math.min(
    MAX_KEEP_PROBABILITY,
    candidateEstimate > 0 ? maxBuildings / candidateEstimate : 0
  )

  const roads: CityRoad[] = []
  const buildings: CityBuilding[] = []
  const patches: CityPatch[] = []
  const trees: CityTree[] = []

  const overlookTower = getOverlookTower(radius)
  const towerClearance =
    overlookTower.deckRadius + Math.max(4, getSidewalkWidth(radius, length))
  const landmark = getPlazaLandmark(radius)
  const landmarkClearance =
    landmark.domeRadius + Math.max(4, getSidewalkWidth(radius, length))
  const expressway = getCityExpressway(radius, length)

  const placeBuilding = (
    stripCenter: number,
    tangentCenter: number,
    axialCenter: number,
    width: number,
    depth: number,
    height: number,
    tone: number,
    kind: BuildingKind,
    urban: number
  ) => {
    if (buildings.length >= maxBuildings) {
      return
    }

    const azimuth = stripCenter + tangentCenter / radius

    if (isInsidePlaza(azimuth, axialCenter, radius)) {
      return
    }

    // The observation tower lives inside a normal block now: keep its
    // immediate footprint free of buildings.
    if (
      Math.abs(wrapToPi(azimuth - overlookTower.azimuth)) * radius <
        towerClearance + width * 0.5 &&
      Math.abs(axialCenter - overlookTower.axial) < towerClearance + depth * 0.5
    ) {
      return
    }

    // Same courtesy for the plaza dome across the crossroads.
    if (
      Math.abs(wrapToPi(azimuth - landmark.azimuth)) * radius <
        landmarkClearance + width * 0.5 &&
      Math.abs(axialCenter - landmark.axial) < landmarkClearance + depth * 0.5
    ) {
      return
    }

    // The expressway corridor stays clear along its whole circumference —
    // the deck must never slice through a tower.
    if (
      expressway !== null &&
      Math.abs(axialCenter - expressway.axial) <
        expressway.corridorHalfWidth + depth * 0.5
    ) {
      return
    }

    buildings.push({ azimuth, axial: axialCenter, width, depth, height, tone, kind, urban })
  }

  // A row of buildings along one block edge, all fronting the same road.
  // `edge` is the inner block boundary the building backs away from.
  const placeEdgeRow = (
    stripCenter: number,
    facing: 'avenue' | 'street',
    edgeCoordinate: number,
    edgeSide: 1 | -1,
    rowStart: number,
    rowEnd: number,
    depthMax: number,
    urban: number
  ) => {
    const span = rowEnd - rowStart
    const count = Math.floor(span / lot)

    if (count < 1 || depthMax <= 0) {
      return
    }

    const pitch = span / count

    // Pre-roll every pitch up front, in the same fixed 7-roll pattern as
    // always — the parcel-grain walk below takes variable strides, and rolling
    // ahead of it keeps RNG consumption identical no matter how lots merge or
    // split, so every other roll in the plan keeps its meaning.
    const rolls: Array<{
      keep: number
      along: number
      depth: number
      height: number
      tone: number
      jitter: number
      kind: number
    }> = []

    for (let index = 0; index < count; index += 1) {
      rolls.push({
        keep: random(),
        along: random(),
        depth: random(),
        height: random(),
        tone: random(),
        jitter: random(),
        kind: random()
      })
    }

    for (let index = 0; index < count; ) {
      const roll = rolls[index]
      // Parcel grain, derived (not freshly rolled) so the stride decision is
      // free: some lots merge into a double/triple plot carrying one large
      // building, some split into a pair of small in-fill buildings — the
      // mixed grain that makes a real skyline read as grown, not stamped.
      const grainRoll =
        (roll.along * 61.7 + roll.depth * 13.3) -
        Math.floor(roll.along * 61.7 + roll.depth * 13.3)
      const mergeProbability = 0.14 + urban * 0.08
      const splitProbability = 0.24 * (1 - urban * 0.5)
      let stride = 1

      if (grainRoll < mergeProbability && index + 1 < count) {
        stride = grainRoll < mergeProbability * 0.3 && index + 2 < count ? 3 : 2
      }

      const splitLot =
        stride === 1 &&
        grainRoll > 1 - splitProbability &&
        pitch * 0.36 >= 4

      // Downtown lots fill in; the countryside thins out toward fields.
      if (roll.keep > keepProbability * (0.55 + urban * 0.45)) {
        index += stride
        continue
      }

      const alongRoll = roll.along
      const depthRoll = roll.depth
      const heightRoll = roll.height
      const toneRoll = roll.tone
      const jitterRoll = roll.jitter
      const kindRoll = roll.kind

      const plotSpan = pitch * stride
      let along =
        stride > 1 ? plotSpan * (0.78 + alongRoll * 0.16) : lot * (0.74 + alongRoll * 0.24)
      let depth = depthMax * (0.55 + depthRoll * 0.45)
      const alongCenter =
        rowStart + (index + stride * 0.5) * pitch + (jitterRoll - 0.5) * lot * 0.2
      // Downtown stands tall; the outskirts stay low-rise. A merged plot
      // hosts a proportionally bigger building.
      let height =
        heightBase *
        (0.25 + heightRoll * heightRoll * 1.1) *
        (0.35 + urban * 0.65) *
        (1 + (stride - 1) * 0.12)

      if (splitLot) {
        // A pair of modest in-fill buildings sharing one pitch — the small
        // grain that nests against towers in the reference skyline.
        const infillAlong = pitch * 0.36
        const infillDepth = depth * 0.8
        let infillHeight = Math.max(5, Math.min(height * 0.7, 14))
        const infillKind: BuildingKind =
          infillHeight < heightBase * 0.45 && kindRoll < 0.7 ? 'house' : 'block'

        if (infillKind === 'house') {
          // Houses keep their global height contract (≤ 10 m).
          infillHeight = Math.min(infillHeight, 10)
        }
        const frontCenter = edgeCoordinate + edgeSide * infillDepth * 0.5

        for (const side of [-1, 1] as const) {
          const centre = alongCenter + side * pitch * 0.24
          // A derived second tone so the pair does not read as twins.
          const tone =
            side === -1 ? toneRoll : toneRoll * 0.63 + 0.31 - Math.floor(toneRoll * 0.63 + 0.31)

          if (facing === 'avenue') {
            placeBuilding(
              stripCenter,
              frontCenter,
              centre,
              infillDepth,
              infillAlong,
              infillHeight,
              tone,
              infillKind,
              urban
            )
          } else {
            placeBuilding(
              stripCenter,
              centre,
              frontCenter,
              infillAlong,
              infillDepth,
              infillHeight,
              tone,
              infillKind,
              urban
            )
          }
        }

        index += stride
        continue
      }

      // Building archetypes: low lots lean toward houses, tall rolls become
      // slim towers or stepped setbacks (downtown trades some setbacks for
      // podium slabs), everything else stays a block — except a slice of the
      // block band that folds into L-shapes for silhouette variety. The bands
      // subdivide the ONE existing kindRoll, so the deterministic roll order
      // (and every other roll's meaning) is untouched.
      let kind: BuildingKind = 'block'
      const towerThreshold = 0.84 - urban * 0.26
      const setbackThreshold = 0.62 - urban * 0.16

      if (height < heightBase * 0.45 && kindRoll < 0.55) {
        kind = 'house'
        height = Math.min(height, 10)
      } else if (kindRoll > towerThreshold) {
        kind = 'tower'
        const slim = Math.min(along, depth) * 0.85
        along = slim
        depth = slim
        height = Math.min(height * 1.25, 78)
      } else if (kindRoll > setbackThreshold) {
        const bandPosition =
          (kindRoll - setbackThreshold) / Math.max(1e-6, towerThreshold - setbackThreshold)

        // The podium slab is downtown furniture — a commercial base with a
        // narrower residential bar on top. The countryside keeps setbacks.
        if (bandPosition > 0.6 && urban > 0.45) {
          kind = 'slab'
          height = Math.min(height * 1.15, 70)
        } else {
          kind = 'setback'
          height = Math.min(height * 1.1, 76)
        }
      } else if (kindRoll > setbackThreshold * 0.75) {
        kind = 'lshape'
      }

      const frontCenter = edgeCoordinate + edgeSide * depth * 0.5

      if (facing === 'avenue') {
        placeBuilding(
          stripCenter,
          frontCenter,
          alongCenter,
          depth,
          along,
          height,
          toneRoll,
          kind,
          urban
        )
      } else {
        placeBuilding(
          stripCenter,
          alongCenter,
          frontCenter,
          along,
          depth,
          height,
          toneRoll,
          kind,
          urban
        )
      }

      index += stride
    }
  }

  for (const landArc of landArcs) {
    const stripCenter = landArc.centerAzimuth

    for (let i = 0; i <= blocksTangentCount; i += 1) {
      // On a full-circle arc the closing avenue lands on the same meridian as
      // the opening one, so skip it to avoid a doubled seam road.
      if (wrapTangent && i === blocksTangentCount) {
        continue
      }

      const kind = avenueKindAt(i)
      roads.push({
        azimuth: stripCenter + (-tangentExtent * 0.5 + i * blockWidth) / radius,
        axial: 0,
        tangentWidth: roadWidthFor(kind),
        axialLength: axialExtent + arterialWidth,
        kind
      })
    }

    for (let j = 0; j <= blocksAxialCount; j += 1) {
      const kind = streetKindAt(j)
      roads.push({
        azimuth: stripCenter,
        axial: -axialHalf + j * blockLength,
        tangentWidth: tangentExtent + arterialWidth,
        axialLength: roadWidthFor(kind),
        kind
      })
    }

    for (let i = 0; i < blocksTangentCount; i += 1) {
      for (let j = 0; j < blocksAxialCount; j += 1) {
        const tangent0 =
          -tangentExtent * 0.5 +
          i * blockWidth +
          roadWidthFor(avenueKindAt(i)) * 0.5 +
          sidewalk
        const tangent1 =
          -tangentExtent * 0.5 +
          (i + 1) * blockWidth -
          roadWidthFor(avenueKindAt(i + 1)) * 0.5 -
          sidewalk
        const axial0 =
          -axialHalf + j * blockLength + roadWidthFor(streetKindAt(j)) * 0.5 + sidewalk
        const axial1 =
          -axialHalf +
          (j + 1) * blockLength -
          roadWidthFor(streetKindAt(j + 1)) * 0.5 -
          sidewalk
        const innerWidth = tangent1 - tangent0
        const innerLength = axial1 - axial0

        if (innerWidth < cell * 0.6 || innerLength < cell * 0.6) {
          continue
        }

        // Block zoning: most blocks are residential, the rest become parks
        // (green + trees) or farm fields. The spawn plaza's block always
        // stays residential so the player starts on open plaza ground.
        const zoneRoll = random()
        const blockCenterAzimuth = stripCenter + ((tangent0 + tangent1) * 0.5) / radius
        const blockCenterAxial = (axial0 + axial1) * 0.5
        const blockUrban = urbanizationAt((tangent0 + tangent1) * 0.5, blockCenterAxial)
        // The countryside turns mostly to farm fields; downtown keeps the
        // original sparse green allotment.
        const farmProbability = Math.min(0.58, FARM_BLOCK_PROBABILITY + (1 - blockUrban) * 0.42)

        if (
          zoneRoll < PARK_BLOCK_PROBABILITY + farmProbability &&
          !isInsidePlaza(blockCenterAzimuth, blockCenterAxial, radius)
        ) {
          const kind: CityPatchKind =
            zoneRoll < PARK_BLOCK_PROBABILITY ? 'park' : 'farm'
          patches.push({
            azimuth: blockCenterAzimuth,
            axial: blockCenterAxial,
            tangentExtent: innerWidth,
            axialExtent: innerLength,
            kind
          })

          if (kind === 'park') {
            const treeTarget = Math.min(
              12,
              Math.floor((innerWidth * innerLength) / (cell * cell * 1.4))
            )

            for (let tree = 0; tree < treeTarget; tree += 1) {
              const tangentRoll = random()
              const axialRoll = random()
              const heightRoll = random()
              const toneRoll = random()

              if (trees.length >= MAX_TREES) {
                continue
              }

              const treeAzimuth =
                stripCenter +
                (tangent0 + cell * 0.3 + tangentRoll * (innerWidth - cell * 0.6)) / radius
              const treeAxial = axial0 + cell * 0.3 + axialRoll * (innerLength - cell * 0.6)

              if (isInsidePlaza(treeAzimuth, treeAxial, radius)) {
                continue
              }

              trees.push({
                azimuth: treeAzimuth,
                axial: treeAxial,
                // Trees are human-scale: the size basis is clamped so giant
                // habitats do not grow 100m cones.
                height: Math.min(cell, 9) * (0.55 + heightRoll * 0.5),
                tone: toneRoll
              })
            }
          }

          continue
        }

        // Nested rings of buildings march inward across alleys until the
        // block core is used up; whatever remains becomes a courtyard
        // garden, so blocks read full instead of hollow.
        let ringTangent0 = tangent0
        let ringTangent1 = tangent1
        let ringAxial0 = axial0
        let ringAxial1 = axial1

        for (let ring = 0; ring < MAX_BLOCK_RINGS; ring += 1) {
          const ringWidth = ringTangent1 - ringTangent0
          const ringLength = ringAxial1 - ringAxial0

          if (ringWidth < cell * 0.6 || ringLength < cell * 0.6) {
            break
          }

          const ringDepth = Math.min(cell * 0.9, ringWidth * 0.35, ringLength * 0.35)
          placeEdgeRow(stripCenter, 'avenue', ringTangent0, 1, ringAxial0, ringAxial1, ringDepth, blockUrban)
          placeEdgeRow(stripCenter, 'avenue', ringTangent1, -1, ringAxial0, ringAxial1, ringDepth, blockUrban)
          placeEdgeRow(
            stripCenter,
            'street',
            ringAxial0,
            1,
            ringTangent0 + ringDepth + sidewalk,
            ringTangent1 - ringDepth - sidewalk,
            ringDepth,
            blockUrban
          )
          placeEdgeRow(
            stripCenter,
            'street',
            ringAxial1,
            -1,
            ringTangent0 + ringDepth + sidewalk,
            ringTangent1 - ringDepth - sidewalk,
            ringDepth,
            blockUrban
          )

          const inset = ringDepth + sidewalk * 1.5
          ringTangent0 += inset
          ringTangent1 -= inset
          ringAxial0 += inset
          ringAxial1 -= inset
        }

        // Courtyard garden in whatever core is left.
        const coreWidth = ringTangent1 - ringTangent0
        const coreLength = ringAxial1 - ringAxial0
        const coreAzimuth = stripCenter + ((ringTangent0 + ringTangent1) * 0.5) / radius
        const coreAxial = (ringAxial0 + ringAxial1) * 0.5

        if (
          coreWidth >= cell * 0.45 &&
          coreLength >= cell * 0.45 &&
          !isInsidePlaza(coreAzimuth, coreAxial, radius)
        ) {
          patches.push({
            azimuth: coreAzimuth,
            axial: coreAxial,
            tangentExtent: coreWidth,
            axialExtent: coreLength,
            kind: 'park'
          })
        }
      }
    }
  }

  return {
    roads,
    buildings,
    patches,
    trees,
    tower: getOverlookTower(radius),
    landmark,
    expressway
  }
}
