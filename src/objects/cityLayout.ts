const TWO_PI = Math.PI * 2

export type CityBuilding = {
  azimuth: number
  axial: number
  width: number
  depth: number
  height: number
  tone: number
}

export type CityRoad = {
  azimuth: number
  axial: number
  tangentWidth: number
  axialLength: number
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

export type CityPlan = {
  roads: CityRoad[]
  buildings: CityBuilding[]
  patches: CityPatch[]
  trees: CityTree[]
  tower: CityTower | null
}

export type CityPlanConfig = {
  radius: number
  length: number
  seed?: number
  maxBuildings?: number
}

export type WindowStripArc = {
  centerAzimuth: number
  arcRadians: number
}

export const LAND_STRIP_COUNT = 3
export const STRIP_ARC_RADIANS = TWO_PI / (LAND_STRIP_COUNT * 2)
// Buildings stay inside this fraction of a land strip so streets remain
// along the window edges.
const LAND_STRIP_USABLE_FRACTION = 0.86
const DEFAULT_SEED = 0x1f2e3d4c
const DEFAULT_MAX_BUILDINGS = 4500
// Blocks are sized in surface meters relative to the city cell.
const BLOCK_TANGENT_CELLS = 3
const BLOCK_AXIAL_CELLS = 4
const SIDEWALK_FRACTION = 0.15
const LOT_FRACTION = 0.85
const MAX_KEEP_PROBABILITY = 0.92
const PARK_BLOCK_PROBABILITY = 0.12
const FARM_BLOCK_PROBABILITY = 0.18
const MAX_TREES = 1500

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

// City cell scale follows the smaller of the two habitat dimensions, so
// thin rings (span << radius) still get a walkable street grid.
export const getCityCellSize = (radius: number, length = Number.POSITIVE_INFINITY) =>
  Math.max(6, Math.min(radius * 0.045, length * 0.08))

// Spawn plaza around (azimuth 0, axial 0) is kept clear of buildings so the
// start marker and respawn point stay walkable.
// Human-scale: clamped in absolute meters so giant habitats do not carve
// kilometer-wide empty fields around the spawn.
export const getPlazaTangentHalfWidth = (radius: number) =>
  Math.min(80, Math.max(10, radius * 0.3))
export const getPlazaAxialHalfLength = (radius: number) =>
  Math.min(60, Math.max(12, radius * 0.15))

// Overlook travel altitude above the surface — shared with the respawn logic
// so the observation tower tops out just below the spawn point.
export const getOverlookAltitude = (radius: number) =>
  Math.min(60, Math.max(8, radius * 0.5))

export const getOverlookTower = (radius: number): CityTower => {
  const deckRadius = Math.min(12, Math.max(2, radius * 0.12))

  return {
    // Beside the plaza, trailing the Coriolis drift of the overlook drop so
    // the falling player slides past the tower instead of through it. The
    // offset grows with the deck so the column does not fill the spawn view.
    azimuth:
      -Math.min(getPlazaTangentHalfWidth(radius) * 0.7, 8 + deckRadius * 1.4) /
      radius,
    axial: 0,
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

// Walking collision against building footprints, resolved in the unrolled
// surface plane (tangent meters x axial meters). Pushes the position out of
// any overlapped footprint along the axis of least penetration.
export const resolveCitySurfaceCollision = (
  position: { azimuth: number; axialPosition: number },
  buildings: readonly CityBuilding[],
  radius: number,
  clearance = 0.45
) => {
  if (radius <= 0) {
    return false
  }

  let moved = false

  for (const building of buildings) {
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

// Generates a street grid per land strip and lines the resulting blocks with
// buildings that face the surrounding roads (perimeter-block city pattern).
export const planCity = (config: CityPlanConfig): CityPlan => {
  const { radius, length } = config

  if (radius <= 0 || length <= 0) {
    return { roads: [], buildings: [], patches: [], trees: [], tower: null }
  }

  const maxBuildings = config.maxBuildings ?? DEFAULT_MAX_BUILDINGS
  const random = createRandom(config.seed ?? DEFAULT_SEED)
  const cell = getCityCellSize(radius, length)
  const avenueWidth = cell * 0.55
  const streetWidth = cell * 0.45
  const sidewalk = cell * SIDEWALK_FRACTION
  const lot = cell * LOT_FRACTION
  const heightBase = Math.min(radius * 0.22, cell * 2.4)
  const usableArc = STRIP_ARC_RADIANS * LAND_STRIP_USABLE_FRACTION
  const tangentExtent = usableArc * radius
  const axialHalf = Math.max(0, length * 0.5 - cell)
  const axialExtent = axialHalf * 2
  const blocksTangent = Math.max(1, Math.round(tangentExtent / (cell * BLOCK_TANGENT_CELLS)))
  const blocksAxial = Math.max(1, Math.round(axialExtent / (cell * BLOCK_AXIAL_CELLS)))
  const blockWidth = tangentExtent / blocksTangent
  const blockLength = axialExtent / blocksAxial

  const innerWidthEstimate = blockWidth - avenueWidth - sidewalk * 2
  const innerLengthEstimate = blockLength - streetWidth - sidewalk * 2
  const lotsPerBlockEstimate =
    2 * Math.max(0, Math.floor(innerLengthEstimate / lot)) +
    2 * Math.max(0, Math.floor(innerWidthEstimate / lot))
  const candidateEstimate =
    lotsPerBlockEstimate * blocksTangent * blocksAxial * LAND_STRIP_COUNT
  const keepProbability = Math.min(
    MAX_KEEP_PROBABILITY,
    candidateEstimate > 0 ? maxBuildings / candidateEstimate : 0
  )

  const roads: CityRoad[] = []
  const buildings: CityBuilding[] = []
  const patches: CityPatch[] = []
  const trees: CityTree[] = []

  const placeBuilding = (
    stripCenter: number,
    tangentCenter: number,
    axialCenter: number,
    width: number,
    depth: number,
    height: number,
    tone: number
  ) => {
    if (buildings.length >= maxBuildings) {
      return
    }

    const azimuth = stripCenter + tangentCenter / radius

    if (isInsidePlaza(azimuth, axialCenter, radius)) {
      return
    }

    buildings.push({ azimuth, axial: axialCenter, width, depth, height, tone })
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
    depthMax: number
  ) => {
    const span = rowEnd - rowStart
    const count = Math.floor(span / lot)

    if (count < 1 || depthMax <= 0) {
      return
    }

    const pitch = span / count

    for (let index = 0; index < count; index += 1) {
      // Consume the RNG in a fixed pattern so layouts stay deterministic
      // regardless of which lots are kept.
      const keepRoll = random()
      const alongRoll = random()
      const depthRoll = random()
      const heightRoll = random()
      const toneRoll = random()
      const jitterRoll = random()

      if (keepRoll > keepProbability) {
        continue
      }

      const along = lot * (0.62 + alongRoll * 0.32)
      const depth = depthMax * (0.55 + depthRoll * 0.45)
      const alongCenter =
        rowStart + (index + 0.5) * pitch + (jitterRoll - 0.5) * lot * 0.2
      const frontCenter = edgeCoordinate + edgeSide * depth * 0.5
      const height = heightBase * (0.25 + heightRoll * heightRoll * 1.1)

      if (facing === 'avenue') {
        placeBuilding(stripCenter, frontCenter, alongCenter, depth, along, height, toneRoll)
      } else {
        placeBuilding(stripCenter, alongCenter, frontCenter, along, depth, height, toneRoll)
      }
    }
  }

  for (const stripCenter of getLandStripCenters()) {
    for (let i = 0; i <= blocksTangent; i += 1) {
      roads.push({
        azimuth: stripCenter + (-tangentExtent * 0.5 + i * blockWidth) / radius,
        axial: 0,
        tangentWidth: avenueWidth,
        axialLength: axialExtent + streetWidth
      })
    }

    for (let j = 0; j <= blocksAxial; j += 1) {
      roads.push({
        azimuth: stripCenter,
        axial: -axialHalf + j * blockLength,
        tangentWidth: tangentExtent + avenueWidth,
        axialLength: streetWidth
      })
    }

    for (let i = 0; i < blocksTangent; i += 1) {
      for (let j = 0; j < blocksAxial; j += 1) {
        const tangent0 = -tangentExtent * 0.5 + i * blockWidth + avenueWidth * 0.5 + sidewalk
        const tangent1 = -tangentExtent * 0.5 + (i + 1) * blockWidth - avenueWidth * 0.5 - sidewalk
        const axial0 = -axialHalf + j * blockLength + streetWidth * 0.5 + sidewalk
        const axial1 = -axialHalf + (j + 1) * blockLength - streetWidth * 0.5 - sidewalk
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

        if (
          zoneRoll < PARK_BLOCK_PROBABILITY + FARM_BLOCK_PROBABILITY &&
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

        const depthMax = Math.min(cell * 0.9, innerWidth * 0.35, innerLength * 0.35)

        // Rows fronting the avenues (block's tangent edges)...
        placeEdgeRow(stripCenter, 'avenue', tangent0, 1, axial0, axial1, depthMax)
        placeEdgeRow(stripCenter, 'avenue', tangent1, -1, axial0, axial1, depthMax)
        // ...and rows fronting the cross streets, inset past the corner lots.
        placeEdgeRow(
          stripCenter,
          'street',
          axial0,
          1,
          tangent0 + depthMax + sidewalk,
          tangent1 - depthMax - sidewalk,
          depthMax
        )
        placeEdgeRow(
          stripCenter,
          'street',
          axial1,
          -1,
          tangent0 + depthMax + sidewalk,
          tangent1 - depthMax - sidewalk,
          depthMax
        )
      }
    }
  }

  return { roads, buildings, patches, trees, tower: getOverlookTower(radius) }
}
