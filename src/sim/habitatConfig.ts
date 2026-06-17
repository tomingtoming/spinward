export type HabitatType = 'cylinder' | 'ring'

const TWO_PI = Math.PI * 2

// A habitable wall coverage arc, centered on `centerAzimuth` (radians) and
// spanning `arcRadians`. Windows are the azimuthal complement of the land
// arcs, so `landArcs` is the single source of truth for "where is wall".
export type LandArc = {
  centerAzimuth: number
  arcRadians: number
}

// How the habitable wall is laid out around the circumference. Everything
// window-derived (the carved shell openings, the external mirrors, the glow
// strips) is computed from `landArcs`, so flipping the arcs reshapes the
// colony without forking the renderers.
export type HabitatTopology = {
  landArcs: LandArc[]
}

// Island Three / Izma: three 60° land strips alternating with three 60°
// windows. The historical default the whole simulator was built around.
export const ISLAND_THREE_TOPOLOGY: HabitatTopology = {
  landArcs: [0, 1, 2].map((index) => ({
    centerAzimuth: (index * TWO_PI) / 3,
    arcRadians: TWO_PI / 6
  }))
}

// A single arc spanning the whole circle: the entire inner wall is habitable
// and there are no windows (Cooper Station-style end-lit cylinder).
export const FULL_360_TOPOLOGY: HabitatTopology = {
  landArcs: [{ centerAzimuth: 0, arcRadians: TWO_PI }]
}

export type HabitatConfig = {
  type: HabitatType
  radius: number
  length: number
  thickness: number
  rpm: number
  simScale: number
  currentPresetId: string
  topology: HabitatTopology
  ballSpeedScale: number
  jetpackAcceleration: number
  ballLifetimeSeconds: number
  maxTrailPoints: number
}

export const DEFAULT_HABITAT_CONFIG: HabitatConfig = {
  type: 'cylinder',
  radius: 18,
  length: 120,
  thickness: 0,
  rpm: 5,
  simScale: 1,
  currentPresetId: 'playground',
  topology: ISLAND_THREE_TOPOLOGY,
  ballSpeedScale: 1,
  jetpackAcceleration: 12,
  ballLifetimeSeconds: 30,
  maxTrailPoints: 200
}

export const getHabitatSpan = (
  config: Pick<HabitatConfig, 'type' | 'length' | 'thickness'>
) => (config.type === 'ring' ? Math.max(config.thickness, config.length) : config.length)
