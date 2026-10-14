// Geographic (JGD2011 longitude/latitude) to the Tokyo band frames.
//
// PLATEAU sources for the Tokyo bands are projected in EPSG:6677 — JGD2011 /
// Japan Plane Rectangular CS IX (Gauss-Krüger, GRS80, origin 36°N 139°50'E,
// scale 0.9999). The band frame then subtracts an origin and rotates, the same
// affine as assets/plateau/geo.py `Frame.place`. The projection follows the
// Geospatial Information Authority of Japan series expansion (the one pyproj
// evaluates for this CRS); it agrees with pyproj to ~1 cm across the bands.

export type BandFrame = { origin: [number, number]; angle: number }
export type GeoBand = { id: string; band: number; frame: BandFrame }

const A = 6378137
const F = 298.257222101
const M0 = 0.9999
const LAT0 = (36 * Math.PI) / 180
const LON0 = ((139 + 50 / 60) * Math.PI) / 180

const n = 1 / (2 * F - 1)
const n2 = n * n, n3 = n2 * n, n4 = n3 * n, n5 = n4 * n
const A0 = 1 + n2 / 4 + n4 / 64
const AJ = [
  (-3 / 2) * n + (9 / 16) * n3 - (3 / 32) * n5,
  (15 / 16) * n2 - (15 / 32) * n4,
  (-35 / 48) * n3 + (105 / 256) * n5,
  (315 / 512) * n4,
  (-693 / 1280) * n5
]
const ALPHA = [
  n / 2 - (2 / 3) * n2 + (5 / 16) * n3 + (41 / 180) * n4 - (127 / 288) * n5,
  (13 / 48) * n2 - (3 / 5) * n3 + (557 / 1440) * n4 + (281 / 630) * n5,
  (61 / 240) * n3 - (103 / 140) * n4 + (15061 / 26880) * n5,
  (49561 / 161280) * n4 - (179 / 168) * n5,
  (34729 / 80640) * n5
]
const A_BAR = (M0 * A) / (1 + n) * A0
const S_BAR_0 = ((M0 * A) / (1 + n)) *
  (A0 * LAT0 + AJ.reduce((sum, a, i) => sum + a * Math.sin(2 * (i + 1) * LAT0), 0))

/** Longitude/latitude in degrees to EPSG:6677 easting/northing in metres. */
export function projectJgd2011ZoneIX(lonDeg: number, latDeg: number): { east: number; north: number } {
  const lat = (latDeg * Math.PI) / 180
  const lon = (lonDeg * Math.PI) / 180
  const sinLat = Math.sin(lat)
  const k = (2 * Math.sqrt(n)) / (1 + n)
  const t = Math.sinh(Math.atanh(sinLat) - k * Math.atanh(k * sinLat))
  const tBar = Math.sqrt(1 + t * t)
  const dLon = lon - LON0
  const lc = Math.cos(dLon), ls = Math.sin(dLon)
  const xi = Math.atan2(t, lc)
  const eta = Math.atanh(ls / tBar)
  let north = xi, east = eta
  for (let j = 1; j <= 5; j += 1) {
    north += ALPHA[j - 1] * Math.sin(2 * j * xi) * Math.cosh(2 * j * eta)
    east += ALPHA[j - 1] * Math.cos(2 * j * xi) * Math.sinh(2 * j * eta)
  }
  return { east: A_BAR * east, north: A_BAR * north - S_BAR_0 }
}

/** Band-local metres for a longitude/latitude (assets/plateau/geo.py Frame.place). */
export function bandLocalFromLonLat(frame: BandFrame, lonDeg: number, latDeg: number): [number, number] {
  const { east, north } = projectJgd2011ZoneIX(lonDeg, latDeg)
  const e = east - frame.origin[0], nn = north - frame.origin[1]
  const c = Math.cos(frame.angle), s = Math.sin(frame.angle)
  return [e * s - nn * c, e * c + nn * s]
}

/**
 * Unit vector of geographic north in band-local axes. Every band shares one
 * rotation, so the same vector serves the whole colony.
 */
export function bandLocalNorth(frame: BandFrame): [number, number] {
  return [-Math.cos(frame.angle), Math.sin(frame.angle)]
}

export type GeoPlace = { id: string; label: string; spawn: number[]; region: string }

/**
 * The published arrival nearest to a geographic point, measured in the band
 * that arrival lives in. `inside` says whether the point itself lies on a band
 * (the colony carries ~402 km² of the real city; outside it, the nearest
 * arrival is still returned so a visitor in Chiba can look up into Tokyo).
 */
export function nearestMetroPlace(
  bands: readonly GeoBand[],
  places: readonly GeoPlace[],
  lonDeg: number,
  latDeg: number,
  bandWidth: number,
  span: number
): { place: GeoPlace; distance: number; inside: boolean; local: [number, number] } | null {
  let best: { place: GeoPlace; distance: number; local: [number, number] } | null = null
  let inside = false
  for (const band of bands) {
    const local = bandLocalFromLonLat(band.frame, lonDeg, latDeg)
    if (Math.abs(local[0]) <= bandWidth / 2 && Math.abs(local[1]) <= span / 2) inside = true
    for (const place of places) {
      if (place.region !== band.id) continue
      const distance = Math.hypot(local[0] - place.spawn[0], local[1] - place.spawn[1])
      if (best === null || distance < best.distance) best = { place, distance, local }
    }
  }
  return best ? { ...best, inside } : null
}
