import type { CityRoad } from './cityLayout'
import { SurfaceIndex } from './streetAccess'

const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a))
const EPS = 1e-5
type Rect = { x0: number; x1: number; y0: number; y1: number }
export type RoadSurface = CityRoad & { axis: 'axial' | 'tangent'; junction: boolean; sourceRoad: CityRoad }
export type RoadJunction = CityRoad & { roadIndices: number[] }
const axisOf = (r: CityRoad) => r.axialLength > r.tangentWidth ? 'axial' as const : 'tangent' as const
const relative = (r: CityRoad, origin: CityRoad, radius: number): Rect => {
  const x = wrap(r.azimuth - origin.azimuth) * radius, y = r.axial - origin.axial
  return { x0: x - r.tangentWidth / 2, x1: x + r.tangentWidth / 2,
    y0: y - r.axialLength / 2, y1: y + r.axialLength / 2 }
}
const intersect = (a: Rect, b: Rect): Rect | null => {
  const r = { x0: Math.max(a.x0, b.x0), x1: Math.min(a.x1, b.x1),
    y0: Math.max(a.y0, b.y0), y1: Math.min(a.y1, b.y1) }
  return r.x1 - r.x0 > EPS && r.y1 - r.y0 > EPS ? r : null
}
const subtract = (a: Rect, b: Rect): Rect[] => {
  const cut = intersect(a, b)
  if (!cut) return [a]
  return [
    { ...a, x1: cut.x0 }, { ...a, x0: cut.x1 },
    { x0: cut.x0, x1: cut.x1, y0: a.y0, y1: cut.y0 },
    { x0: cut.x0, x1: cut.x1, y0: cut.y1, y1: a.y1 }
  ].filter(r => r.x1 - r.x0 > EPS && r.y1 - r.y0 > EPS)
}
const surface = (rect: Rect, origin: CityRoad, radius: number): CityRoad => ({
  ...origin, azimuth: origin.azimuth + (rect.x0 + rect.x1) / (2 * radius),
  axial: origin.axial + (rect.y0 + rect.y1) / 2,
  tangentWidth: rect.x1 - rect.x0, axialLength: rect.y1 - rect.y0
})

// Junctions own the shared carriageway area. Street arms are explicitly cut
// at its boundary; parallel duplicates are also subtracted. Every resulting
// surface has a single owner, so all roads can sit at the SAME elevation.
// Original road IDs and access references remain unchanged in CityPlan.
export const compileRoadNetwork = (roads: CityRoad[], radius: number) => {
  const index = new SurfaceIndex(radius)
  const junctions: RoadJunction[] = []
  const junctionKeys = new Map<string, RoadJunction>()
  roads.forEach((r, i) => {
    for (const j of index.query(r)) {
      if (axisOf(r) === axisOf(roads[j])) continue
      const hit = intersect(relative(r, r, radius), relative(roads[j], r, radius))
      if (!hit) continue
      const patch = surface(hit, r, radius)
      const key = [wrap(patch.azimuth) * radius, patch.axial, patch.tangentWidth, patch.axialLength]
        .map(v => v.toFixed(4)).join(':')
      const existing = junctionKeys.get(key)
      if (existing) existing.roadIndices = [...new Set([...existing.roadIndices, i, j])]
      else {
        const node = { ...patch, roadIndices: [i, j] }
        junctions.push(node); junctionKeys.set(key, node)
      }
    }
    index.insert(r, i)
  })
  const occupied = new SurfaceIndex(radius)
  const owners: CityRoad[] = []
  const surfaces: RoadSurface[] = []
  const add = (r: CityRoad, junction: boolean) => {
    let pieces = [relative(r, r, radius)]
    for (const id of occupied.query(r)) {
      const obstacle = relative(owners[id], r, radius)
      pieces = pieces.flatMap(p => subtract(p, obstacle))
      if (!pieces.length) break
    }
    for (const p of pieces) surfaces.push({ ...surface(p, r, radius), axis: axisOf(r), junction, sourceRoad: r })
    occupied.insert(r, owners.length); owners.push(r)
  }
  for (const junction of junctions) add(junction, true)
  for (const road of roads) add(road, false)
  return { junctions, surfaces }
}

// Merge overlapping collinear copies before near-view intersection planning.
// Adjacent blocks often emit the same through lane from opposite sides.
export const coalesceRoads = (roads: CityRoad[], radius: number): CityRoad[] => {
  const groups = new Map<string, CityRoad[]>()
  for (const r of roads) {
    const axial = axisOf(r) === 'axial'
    const key = `${r.kind}:${axial}:${(axial ? wrap(r.azimuth) * radius : r.axial).toFixed(4)}:${(axial ? r.tangentWidth : r.axialLength).toFixed(4)}`
    const list = groups.get(key) ?? []; list.push(r); groups.set(key, list)
  }
  const out: CityRoad[] = []
  for (const group of groups.values()) {
    const origin = group[0], axial = axisOf(origin) === 'axial'
    const intervals = group.map(r => {
      const centre = axial ? r.axial : wrap(r.azimuth - origin.azimuth) * radius
      const half = (axial ? r.axialLength : r.tangentWidth) / 2
      return { start: centre - half, end: centre + half }
    }).sort((a, b) => a.start - b.start)
    const merged: typeof intervals = []
    for (const interval of intervals) {
      const last = merged.at(-1)
      if (last && interval.start <= last.end + EPS) last.end = Math.max(last.end, interval.end)
      else merged.push({ ...interval })
    }
    for (const interval of merged) out.push({ ...origin,
      azimuth: axial ? origin.azimuth : origin.azimuth + (interval.start + interval.end) / (2 * radius),
      axial: axial ? (interval.start + interval.end) / 2 : origin.axial,
      tangentWidth: axial ? origin.tangentWidth : interval.end - interval.start,
      axialLength: axial ? interval.end - interval.start : origin.axialLength })
  }
  return out
}
