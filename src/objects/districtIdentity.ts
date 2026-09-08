// Large contiguous green districts, legible from the opposite land strip.
// Coordinates are normalized within one land strip, not world-space noise.
export const isDistrictPark = (
  radius: number, length: number, tangent: number, axial: number
) => radius >= 800 && length >= 8000 && (
  Math.hypot((tangent - 0.46) / 0.19, (axial - 0.12) / 0.065) < 1 ||
  Math.hypot((tangent + 0.42) / 0.15, (axial + 0.24) / 0.085) < 1
)

// Residential districts have pools of warm light; commercial cores stay
// brighter. Used by the distant city bake without changing physical light.
export const districtNightGain = (urban: number, industrial = false) =>
  industrial ? 0.32 : 0.4 + 0.6 * Math.min(1, Math.max(0, urban))
