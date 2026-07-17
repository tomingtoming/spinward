export type DetailedBuildingLod = 0 | 1 | null

export type DetailedBuildingLodThresholds = {
  lod0Distance: number
  lod1Distance: number
  hysteresisFraction?: number
  lod0TransitionDistance?: number
  lod1TransitionDistance?: number
}

export type DetailedBuildingLodBlend = {
  lod0: number
  lod1: number
  procedural: number
}

const fullTurn = Math.PI * 2

export const wrapBuildingAngleToPi = (angle: number) => {
  const wrapped = ((angle % fullTurn) + fullTurn) % fullTurn
  return wrapped > Math.PI ? wrapped - fullTurn : wrapped
}

// Distance along the inhabited cylinder surface. This is the right metric for
// authored detail: a building 10 km down the spin axis must not become LOD0
// merely because it shares the player's azimuth.
export const getBuildingSurfaceDistance = (
  radius: number,
  focusAzimuth: number,
  focusAxial: number,
  buildingAzimuth: number,
  buildingAxial: number
) => {
  const tangentDistance =
    wrapBuildingAngleToPi(buildingAzimuth - focusAzimuth) * radius
  return Math.hypot(tangentDistance, buildingAxial - focusAxial)
}

// Straight camera-to-building distance inside the bore. Far-LOD screen-size
// culling uses this instead of surface distance because the opposite wall is a
// 2R chord away, while axial separation remains linear.
export const getBuildingChordDistance = (
  radius: number,
  focusAzimuth: number,
  focusAxial: number,
  buildingAzimuth: number,
  buildingAxial: number
) => {
  const theta = Math.abs(
    wrapBuildingAngleToPi(buildingAzimuth - focusAzimuth)
  )
  const radialChord = 2 * radius * Math.sin(theta * 0.5)
  return Math.hypot(radialChord, buildingAxial - focusAxial)
}

// Keep the previous LOD slightly beyond its nominal boundary. Quantized focus
// updates then produce stable VR silhouettes instead of toggling every time the
// player crosses a threshold by a metre or two.
export const selectDetailedBuildingLod = (
  distance: number,
  previous: DetailedBuildingLod,
  thresholds: DetailedBuildingLodThresholds
): DetailedBuildingLod => {
  const lod0Distance = Math.max(0, thresholds.lod0Distance)
  const lod1Distance = Math.max(lod0Distance, thresholds.lod1Distance)
  const hysteresis = Math.min(
    0.4,
    Math.max(0, thresholds.hysteresisFraction ?? 0.12)
  )

  if (previous === 0) {
    if (distance <= lod0Distance * (1 + hysteresis)) {
      return 0
    }
    return distance <= lod1Distance ? 1 : null
  }

  if (previous === 1) {
    if (distance < lod0Distance * (1 - hysteresis)) {
      return 0
    }
    return distance <= lod1Distance * (1 + hysteresis) ? 1 : null
  }

  if (distance <= lod0Distance) {
    return 0
  }
  return distance <= lod1Distance ? 1 : null
}

const smoothUnit = (value: number) => {
  const clamped = Math.min(1, Math.max(0, value))
  return clamped * clamped * (3 - 2 * clamped)
}

// Continuous coverage for screen-door LOD transitions. Only two layers are
// ever active at once, and their weights sum to one, so the renderer can use
// complementary dither masks without transparent sorting or alpha overdraw.
export const getDetailedBuildingLodBlend = (
  distance: number,
  thresholds: DetailedBuildingLodThresholds
): DetailedBuildingLodBlend => {
  const lod0Distance = Math.max(0, thresholds.lod0Distance)
  const lod1Distance = Math.max(lod0Distance, thresholds.lod1Distance)
  const lodGap = lod1Distance - lod0Distance
  const maxHalfWidth = lodGap * 0.45
  const lod0HalfWidth = Math.min(
    maxHalfWidth,
    Math.max(0, thresholds.lod0TransitionDistance ?? lod0Distance * 0.2)
  )
  const lod1HalfWidth = Math.min(
    maxHalfWidth,
    Math.max(0, thresholds.lod1TransitionDistance ?? lod1Distance * 0.1)
  )

  if (lod0HalfWidth > 0 && distance < lod0Distance + lod0HalfWidth) {
    const mix = smoothUnit(
      (distance - (lod0Distance - lod0HalfWidth)) / (lod0HalfWidth * 2)
    )
    return { lod0: 1 - mix, lod1: mix, procedural: 0 }
  }

  if (distance < lod1Distance - lod1HalfWidth) {
    return { lod0: 0, lod1: 1, procedural: 0 }
  }

  if (lod1HalfWidth > 0 && distance < lod1Distance + lod1HalfWidth) {
    const mix = smoothUnit(
      (distance - (lod1Distance - lod1HalfWidth)) / (lod1HalfWidth * 2)
    )
    return { lod0: 0, lod1: 1 - mix, procedural: mix }
  }

  return { lod0: 0, lod1: 0, procedural: 1 }
}
