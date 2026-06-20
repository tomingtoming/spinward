export type HabitatType = 'cylinder' | 'ring'

// Which sky/atmosphere colour grade a habitat wears. Carried from a preset's
// flavor.skybox so per-colony looks (e.g. Izma's warm dusk) can diverge without
// forking the renderer. See app/skyGrade.ts for the profiles.
export type SkyLookId = 'default' | 'izma' | 'elysium'

const TWO_PI = Math.PI * 2

// A habitable wall coverage arc, centered on `centerAzimuth` (radians) and
// spanning `arcRadians`. Windows are the azimuthal complement of the land
// arcs, so `landArcs` is the single source of truth for "where is wall".
export type LandArc = {
  centerAzimuth: number
  arcRadians: number
}

// Descriptive metadata only. The end caps no longer read this: CylinderHabitat
// now derives each end from the sun side (the spaceport always sits on -Y) and
// whether the colony is end-lit (no side windows → a glazed +Y daylight
// window). Retained for preset readability and tests; safe to remove later.
export type EndStructure = 'docking-ring' | 'closed-cap'

// How the habitable wall is laid out around the circumference. Everything
// window-derived (the carved shell openings, the external mirrors, the glow
// strips) is computed from `landArcs`, so flipping the arcs reshapes the
// colony without forking the renderers. `endStructure` is vestigial metadata
// (see above) and no longer affects how the ends are capped.
export type HabitatTopology = {
  landArcs: LandArc[]
  endStructure: EndStructure
}

// Island Three / Izma: three 60° land strips alternating with three 60°
// windows, and closed end caps (a real Island Three cylinder is enclosed).
export const ISLAND_THREE_TOPOLOGY: HabitatTopology = {
  landArcs: [0, 1, 2].map((index) => ({
    centerAzimuth: (index * TWO_PI) / 3,
    arcRadians: TWO_PI / 6
  })),
  endStructure: 'closed-cap'
}

// A single arc spanning the whole circle: the entire inner wall is habitable
// and there are no windows (Cooper Station-style end-lit cylinder). The ends
// keep the open docking rings until per-colony end glazing lands.
export const FULL_360_TOPOLOGY: HabitatTopology = {
  landArcs: [{ centerAzimuth: 0, arcRadians: TWO_PI }],
  endStructure: 'docking-ring'
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
  skyLook: SkyLookId
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
  skyLook: 'default',
  ballSpeedScale: 1,
  jetpackAcceleration: 12,
  ballLifetimeSeconds: 30,
  maxTrailPoints: 200
}

export const getHabitatSpan = (
  config: Pick<HabitatConfig, 'type' | 'length' | 'thickness'>
) => (config.type === 'ring' ? Math.max(config.thickness, config.length) : config.length)

// Depth of the breathable air shell, measured inward from the floor toward the
// spin axis. An O'Neill cylinder is pressurized across its whole bore, so the
// air reaches ~the axis (depth ≈ radius). A ring (open torus, Elysium) holds
// only a thin layer against its floor by spin alone — the bore out to the axis
// is vacuum — so the air is about as deep as the rim (depth ≈ thickness).
export const getAtmosphereDepth = (
  config: Pick<HabitatConfig, 'type' | 'radius' | 'thickness'>
) => (config.type === 'ring' ? config.thickness : config.radius)

// Fraction of a straight cross-interior sightline (floor to the opposite floor:
// a diameter chord) that actually passes through the air shell r ∈ [R−depth, R].
// Along a diameter chord the radius runs R → 0 → R, so the in-air length is
// 2·depth out of the 2·R chord: the fraction is depth / R. A full-bore cylinder
// gives 1 — uniform haze, unchanged — while a thin ring shell gives a small
// fraction, so the far rim shows through the vacuum bore instead of being
// socked in. Used to scale the (uniform) fog density down for confined air.
export const getAirColumnFraction = (
  config: Pick<HabitatConfig, 'type' | 'radius' | 'thickness'>
) => {
  if (config.radius <= 0) {
    return 0
  }

  return Math.min(1, Math.max(0, getAtmosphereDepth(config) / config.radius))
}
