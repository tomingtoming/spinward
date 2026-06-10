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

export type CityPlan = {
  roads: CityRoad[]
  buildings: CityBuilding[]
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
const DEFAULT_MAX_BUILDINGS = 2400
// Blocks are sized in surface meters relative to the city cell.
const BLOCK_TANGENT_CELLS = 3
const BLOCK_AXIAL_CELLS = 4
const SIDEWALK_FRACTION = 0.15
const LOT_FRACTION = 1.1
const MAX_KEEP_PROBABILITY = 0.85

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

export const getCityCellSize = (radius: number) => Math.max(6, radius * 0.045)

// Spawn plaza around (azimuth 0, axial 0) is kept clear of buildings so the
// start marker and respawn point stay walkable.
export const getPlazaTangentHalfWidth = (radius: number) => Math.max(10, radius * 0.3)
export const getPlazaAxialHalfLength = (radius: number) => Math.max(12, radius * 0.15)

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
    return { roads: [], buildings: [] }
  }

  const maxBuildings = config.maxBuildings ?? DEFAULT_MAX_BUILDINGS
  const random = createRandom(config.seed ?? DEFAULT_SEED)
  const cell = getCityCellSize(radius)
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

      const along = lot * (0.55 + alongRoll * 0.35)
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

  return { roads, buildings }
}
