// Slice ① of docs/far-field-lod.md: the air-haze knob becomes a VISIBILITY
// in metres instead of a raw extinction coefficient, so tier defaults and
// on-device tuning speak the same unit the design doc reasons in ("the far
// wall is 6.4km away"). Koschmieder's 2%-contrast threshold converts:
// extinction = 3.912 / visibility.
export const KOSCHMIEDER = 3.912

// Keep the band generous: 2km still lets a small colony read as air, 100km is
// effectively the pre-slice-① clear look.
export const MIN_VISIBILITY_METERS = 2_000
export const MAX_VISIBILITY_METERS = 100_000

export const visibilityToFogDensity = (visibilityMeters: number): number =>
  KOSCHMIEDER / visibilityMeters

// `?fog=<metres>` overrides the tier default for on-device A/B (phones tune
// without opening lil-gui). Unparsable input falls back to the tier default;
// parsable input is clamped into the sane band.
export const resolveFogVisibility = (
  urlValue: string | null,
  tierDefaultMeters: number
): number => {
  if (urlValue === null || urlValue.trim() === '') {
    return tierDefaultMeters
  }

  const parsed = Number(urlValue)
  if (!Number.isFinite(parsed)) {
    return tierDefaultMeters
  }

  return Math.min(
    MAX_VISIBILITY_METERS,
    Math.max(MIN_VISIBILITY_METERS, parsed)
  )
}
