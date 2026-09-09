import type { CityRoad } from './cityLayout'
import { STREET_PROFILES } from './streetProfile'
import { SurfaceIndex } from './streetAccess'

export type WalkwayRect = { t0: number; t1: number; a0: number; a1: number }
const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a))
export const subtractWalkwayRect = (p: WalkwayRect, road: WalkwayRect): WalkwayRect[] => {
  const t0 = Math.max(p.t0, road.t0), t1 = Math.min(p.t1, road.t1)
  const a0 = Math.max(p.a0, road.a0), a1 = Math.min(p.a1, road.a1)
  if (t1 - t0 <= 1e-5 || a1 - a0 <= 1e-5) return [p]
  return [{ ...p, t1: t0 }, { ...p, t0: t1 },
    { t0, t1, a0: p.a0, a1: a0 }, { t0, t1, a0: a1, a1: p.a1 }]
    .filter(r => r.t1 - r.t0 > 1e-5 && r.a1 - r.a0 > 1e-5)
}

// Sidewalks end at every carriageway, including shared residential lanes.
// Work in focus-relative surface metres; cylindrical queries still wrap.
export const planStreetWalkways = (roads: CityRoad[], radius: number, azimuth: number, axial: number, range = 180) => {
  const index = new SurfaceIndex(radius)
  roads.forEach((r, i) => index.insert(r, i))
  const pieces: WalkwayRect[] = []
  for (const road of roads) {
    const width = STREET_PROFILES[road.kind].sidewalk
    if (!width) continue
    const avenue = road.axialLength > road.tangentWidth
    const t = wrap(road.azimuth - azimuth) * radius, a = road.axial - axial
    for (const side of [-1, 1]) {
      const ct = t + (avenue ? side * (road.tangentWidth + width) / 2 : 0)
      const ca = a + (avenue ? 0 : side * (road.axialLength + width) / 2)
      const w = avenue ? width : road.tangentWidth, h = avenue ? road.axialLength : width
      const rect = { t0: Math.max(-range, ct - w / 2), t1: Math.min(range, ct + w / 2),
        a0: Math.max(-range, ca - h / 2), a1: Math.min(range, ca + h / 2) }
      if (rect.t0 >= rect.t1 || rect.a0 >= rect.a1) continue
      let remaining = [rect]
      const query = { azimuth: azimuth + (rect.t0 + rect.t1) / (2 * radius), axial: axial + (rect.a0 + rect.a1) / 2,
        tangentWidth: rect.t1 - rect.t0, axialLength: rect.a1 - rect.a0 }
      for (const id of index.query(query)) {
        const r = roads[id], rt = wrap(r.azimuth - azimuth) * radius, ra = r.axial - axial
        remaining = remaining.flatMap(p => subtractWalkwayRect(p, { t0: rt - r.tangentWidth / 2, t1: rt + r.tangentWidth / 2,
          a0: ra - r.axialLength / 2, a1: ra + r.axialLength / 2 }))
      }
      pieces.push(...remaining)
    }
  }
  return pieces
}
