const TWO_PI = Math.PI * 2

export type CityBuilding = {
  azimuth: number
  axial: number
  width: number
  depth: number
  height: number
  tone: number
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
const BASE_OCCUPANCY = 0.5

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

export const planCityBuildings = (config: CityPlanConfig): CityBuilding[] => {
  const { radius, length } = config

  if (radius <= 0 || length <= 0) {
    return []
  }

  const maxBuildings = config.maxBuildings ?? DEFAULT_MAX_BUILDINGS
  const random = createRandom(config.seed ?? DEFAULT_SEED)
  const cell = getCityCellSize(radius)
  const axialHalf = Math.max(0, length * 0.5 - cell)
  const usableArc = STRIP_ARC_RADIANS * LAND_STRIP_USABLE_FRACTION
  const tangentExtent = usableArc * radius
  const columns = Math.max(1, Math.floor(tangentExtent / cell))
  const rows = Math.max(1, Math.floor((axialHalf * 2) / cell))
  const candidates = columns * rows * LAND_STRIP_COUNT
  const keepProbability = Math.min(
    BASE_OCCUPANCY,
    candidates > 0 ? maxBuildings / candidates : 0
  )
  const heightBase = Math.min(radius * 0.22, cell * 2.4)
  const buildings: CityBuilding[] = []

  for (const stripCenter of getLandStripCenters()) {
    for (let row = 0; row < rows; row += 1) {
      for (let column = 0; column < columns; column += 1) {
        if (random() > keepProbability) {
          continue
        }

        const jitterAzimuth = ((random() - 0.5) * cell * 0.3) / radius
        const jitterAxial = (random() - 0.5) * cell * 0.3
        const azimuth =
          stripCenter -
          usableArc * 0.5 +
          ((column + 0.5) / columns) * usableArc +
          jitterAzimuth
        const axial = -axialHalf + ((row + 0.5) / rows) * axialHalf * 2 + jitterAxial
        const width = cell * (0.35 + random() * 0.4)
        const depth = cell * (0.35 + random() * 0.4)
        const towerness = random()
        const height = heightBase * (0.25 + towerness * towerness * 1.1)
        const tone = random()

        if (isInsidePlaza(azimuth, axial, radius)) {
          continue
        }

        buildings.push({ azimuth, axial, width, depth, height, tone })

        if (buildings.length >= maxBuildings) {
          return buildings
        }
      }
    }
  }

  return buildings
}
