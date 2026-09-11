import type { LandArc } from '../sim/habitatConfig'

// Large contiguous green districts, legible from the opposite land strip.
// Coordinates are normalized within one land strip, not world-space noise.
export const isDistrictPark = (
  radius: number, length: number, tangent: number, axial: number
) => radius >= 800 && length >= 8000 && (
  Math.hypot((tangent - 0.46) / 0.19, (axial - 0.12) / 0.065) < 1 ||
  Math.hypot((tangent + 0.42) / 0.15, (axial + 0.24) / 0.085) < 1
)

// Secondary urban nodes (0..1 peak) strung along the strip: the overhead
// night view of the reference colony is several saturated white clusters
// along the veins with dim fabric between, not one bullseye. Normalized
// strip coordinates like isDistrictPark; smoothstep shoulders so each node
// has a real core and a real edge.
const NODES: ReadonlyArray<readonly [number, number, number, number, number]> = [
  // [tangent, axial, tangentRadius, axialRadius, peak]
  [-0.35, -0.55, 0.55, 0.13, 0.86],
  [0.4, -0.28, 0.5, 0.11, 0.8],
  [-0.3, 0.3, 0.55, 0.14, 0.9],
  [0.35, 0.58, 0.5, 0.12, 0.78]
]
export const districtNodeAt = (tangent: number, axial: number) => {
  let best = 0
  for (const [t, a, rt, ra, peak] of NODES) {
    const raw = Math.max(0, 1 - Math.hypot((tangent - t) / rt, (axial - a) / ra))
    best = Math.max(best, peak * raw * raw * (3 - 2 * raw))
  }
  return best
}

// Dark voids in the night field (light-only, see cityShellBake): the
// reference strip has irregular dark holes between its clusters.
const VOIDS: ReadonlyArray<readonly [number, number, number, number]> = [
  // [tangent, axial, tangentRadius, axialRadius]
  [0.22, -0.5, 0.14, 0.06],
  [-0.3, 0.5, 0.16, 0.07],
  [0.05, -0.12, 0.12, 0.05]
]
export const districtVoidAt = (tangent: number, axial: number) => {
  let best = 0
  for (const [t, a, rt, ra] of VOIDS) {
    const raw = Math.max(0, 1 - Math.hypot((tangent - t) / rt, (axial - a) / ra))
    best = Math.max(best, raw * raw * (3 - 2 * raw))
  }
  return best
}

// Residential districts have pools of warm light; commercial cores stay
// brighter. Used by the distant city bake without changing physical light.
// Steeper than linear (2026-09-11) so cores saturate and fabric dims.
export const districtNightGain = (urban: number, industrial = false) =>
  industrial ? 0.32 : 0.3 + 0.7 * Math.pow(Math.min(1, Math.max(0, urban)), 1.7)

const TWO_PI = Math.PI * 2

// Strip-normalized frame for the night districts: tangent −1..1 across the
// usable strip width, axial −1..1 along the bore. Null for a single
// full-circle arc (no side windows, e.g. Cooper) or when the point is off
// every land arc — those keep the uniform field.
export const stripFrameAt = (
  landArcs: readonly LandArc[] | null,
  length: number,
  azimuth: number,
  axial: number
): { tangent: number; axial: number } | null => {
  if (landArcs === null || length <= 0) {
    return null
  }
  for (const arc of landArcs) {
    if (arc.arcRadians >= TWO_PI - 1e-6) {
      return null
    }
    const delta =
      ((((azimuth - arc.centerAzimuth + Math.PI) % TWO_PI) + TWO_PI) % TWO_PI) - Math.PI
    if (Math.abs(delta) <= arc.arcRadians * 0.5) {
      return { tangent: delta / (arc.arcRadians * 0.47), axial: axial / (length * 0.5) }
    }
  }
  return null
}

// Deterministic per-building brightness roll (0.5..1): from the bore a lit
// district is speckle, not a field of equal blobs. Hashed from the footprint
// so the shell bake and the far batch agree on which buildings blaze, and no
// plan RNG is consumed.
export const nightSpeckle = (azimuth: number, axial: number) => {
  const h = Math.sin(azimuth * 127.1 + axial * 0.0311) * 43758.5453
  return 0.5 + 0.5 * (h - Math.floor(h))
}

// The night-district factor shared by the shell bake and the far batch:
// secondary cores lift the effective urbanization, voids dim. Light-only —
// the city plan is untouched (see cityShellBake).
export const nightDistrictGain = (
  urban: number,
  industrial: boolean,
  frame: { tangent: number; axial: number } | null
) => {
  const node = frame === null ? 0 : districtNodeAt(frame.tangent, frame.axial)
  const hollow = frame === null ? 0 : districtVoidAt(frame.tangent, frame.axial)
  const urbanNight = Math.max(urban, node)
  return {
    urbanNight,
    hollow,
    gain: districtNightGain(urbanNight, industrial) * (1 - 0.75 * hollow)
  }
}
