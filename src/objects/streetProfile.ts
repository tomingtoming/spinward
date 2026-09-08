// Spinward design values, not a claim of compliance with a national standard.
// Carriageway and each sidewalk are separate, absolute surface metres.
const dividedStreet = (lanesPerDirection: number, laneWidth: number, sidewalk: number) => ({
  lanesPerDirection, laneWidth, sidewalk, carriageway: lanesPerDirection * 2 * laneWidth
})
export const STREET_PROFILES = {
  arterial: dividedStreet(3, 3.25, 3),
  collector: dividedStreet(2, 3, 2.5),
  local: dividedStreet(1, 3, 2),
  alley: { lanesPerDirection: 0, laneWidth: 0, carriageway: 4, sidewalk: 0 }
} as const
export type StreetKind = keyof typeof STREET_PROFILES
export const getStreetProfile = (kind: StreetKind, radius = Infinity) =>
  (kind === 'arterial' || kind === 'collector') && radius < 300 ? dividedStreet(1, 3, 2.5) : STREET_PROFILES[kind]
// Offsets are measured from the centreline, inner lane first.
export const streetLaneCenters = (kind: StreetKind, direction: 1 | -1, radius = Infinity) => {
  const p = getStreetProfile(kind, radius)
  return Array.from({ length: p.lanesPerDirection }, (_, i) => direction * (i + 0.5) * p.laneWidth)
}
export const streetLaneDividers = (kind: StreetKind) => {
  const p = STREET_PROFILES[kind]
  return Array.from({ length: Math.max(0, p.lanesPerDirection - 1) }, (_, i) => (i + 1) * p.laneWidth)
}
export const FOOTPATH_WIDTH = 2
