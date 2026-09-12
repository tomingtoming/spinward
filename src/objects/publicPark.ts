import type { CityPatch, CityPlan, CityTree } from './cityLayout'

type Point = { x: number; y: number }
export type ParkPath = { x: number; y: number; width: number; depth: number }
export type PublicPark = {
  patch: CityPatch
  azimuth: number
  axial: number
  entrance: Point
  forward: Point
  roadIndex: number
  paths: ParkPath[]
  benches: Point[]
  lamps: Point[]
  trees: CityTree[]
}

export const PARK_PATH_HEIGHT = .14
const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a))
const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n))
const inside = (p: Point, r: ParkPath, margin = 0) =>
  Math.abs(p.x - r.x) <= r.width / 2 + margin && Math.abs(p.y - r.y) <= r.depth / 2 + margin

/** A small public garden in an existing green parcel. No RNG or city-layout
 * mutation: buildings, traffic and the surrounding tree distribution stay put. */
export function planPublicPark(plan: CityPlan, radius: number): PublicPark | null {
  if (radius < 800) return null
  const candidates: Array<{ patch: CityPatch; centre: Point; entrance: Point; forward: Point; roadIndex: number; score: number }> = []
  const patches = plan.patches.filter(p => p.kind === 'park' && Math.min(p.tangentExtent, p.axialExtent) >= 60)
    .sort((a, b) => Math.hypot(wrap(a.azimuth) * radius, a.axial) - Math.hypot(wrap(b.azimuth) * radius, b.axial)).slice(0, 12)
  for (const patch of patches) {
    for (const [roadIndex, road] of plan.roads.entries()) {
      if (road.kind === 'alley') continue
      const x = wrap(road.azimuth - patch.azimuth) * radius, y = road.axial - patch.axial
      const avenue = road.axialLength > road.tangentWidth
      const across = avenue ? x : y, along = avenue ? y : x
      const half = (avenue ? patch.tangentExtent : patch.axialExtent) / 2
      const span = (avenue ? patch.axialExtent : patch.tangentExtent) / 2
      const roadHalf = (avenue ? road.tangentWidth : road.axialLength) / 2
      const roadSpan = (avenue ? road.axialLength : road.tangentWidth) / 2
      const gap = Math.abs(across) - roadHalf - half
      if (gap < -.01 || gap > 12) continue
      const lo = Math.max(-span + 24, along - roadSpan + 4), hi = Math.min(span - 24, along + roadSpan - 4)
      if (lo > hi) continue
      const side = Math.sign(across), pos = clamp(avenue ? -patch.axial : -wrap(patch.azimuth) * radius, lo, hi)
      const centre = avenue ? { x: side * (half - 22), y: pos } : { x: pos, y: side * (half - 22) }
      const entrance = avenue ? { x: side * (half - 2), y: pos } : { x: pos, y: side * (half - 2) }
      const forward = avenue ? { x: -side, y: 0 } : { x: 0, y: -side }
      const score = Math.hypot(wrap(patch.azimuth) * radius + entrance.x, patch.axial + entrance.y)
      candidates.push({ patch, centre, entrance, forward, roadIndex, score })
    }
  }
  candidates.sort((a, b) => a.score - b.score || a.roadIndex - b.roadIndex)
  for (const candidate of candidates) {
    const { patch, centre, forward, roadIndex } = candidate
    const entrance = { x: candidate.entrance.x - centre.x, y: candidate.entrance.y - centre.y }
    const paths: ParkPath[] = [
      { x: -10, y: 0, width: 2.2, depth: 26.2 }, { x: 10, y: 0, width: 2.2, depth: 26.2 },
      { x: 0, y: -12, width: 22.2, depth: 2.2 }, { x: 0, y: 12, width: 22.2, depth: 2.2 }
    ]
    // Continue to the parcel edge; nearby pavement may cover the first metre.
    const end = { x: entrance.x - forward.x * 1.98, y: entrance.y - forward.y * 1.98 }
    if (forward.x) paths.push({ x: (end.x + Math.sign(end.x) * 10) / 2, y: 0, width: Math.abs(end.x) - 10, depth: 2.2 })
    else paths.push({ x: 0, y: (end.y + Math.sign(end.y) * 12) / 2, width: 2.2, depth: Math.abs(end.y) - 12 })
    const benches = [{ x: -4, y: -14 }, { x: 4, y: -14 }]
    paths.push(...benches.map(b => ({ x: b.x, y: b.y + .4, width: 2.6, depth: 3 })))
    const azimuth = patch.azimuth + centre.x / radius, axial = patch.axial + centre.y
    // Do not send the walking route through an existing trunk or building.
    const obstacles = plan.buildings.map(b => ({ x: wrap(b.azimuth - azimuth) * radius, y: b.axial - axial, width: b.width, depth: b.depth }))
    if (paths.some(p => obstacles.some(b => Math.abs(p.x - b.x) < (p.width + b.width) / 2 + .6 && Math.abs(p.y - b.y) < (p.depth + b.depth) / 2 + .6))) continue
    // Keep an eight-metre ball practice lane inside the lawn, clear of
    // existing trunks as well as the path and bench network.
    if (plan.trees.some(t => Math.abs(wrap(t.azimuth - azimuth) * radius) < 3.5 && Math.abs(t.axial - axial) < 7)) continue
    if (obstacles.some(b => Math.abs(b.x) < b.width / 2 + 3.5 && Math.abs(b.y) < b.depth / 2 + 7)) continue
    if (plan.trees.some(t => paths.some(p => inside({ x: wrap(t.azimuth - azimuth) * radius, y: t.axial - axial }, p, .8)))) continue
    const trees = [[-16, -17], [16, -17], [-16, 17], [16, 17], [-16, 5], [16, -5], [-4, 18], [5, 18]].map(([x, y], i) => ({
      azimuth: azimuth + x / radius, axial: axial + y, height: 7 + (i % 3) * .8, tone: .18 + i * .09
    })).filter(t => {
      const p = { x: wrap(t.azimuth - azimuth) * radius, y: t.axial - axial }
      return !paths.some(r => inside(p, r, 2.5)) &&
        Math.abs(wrap(t.azimuth - patch.azimuth)) * radius < patch.tangentExtent / 2 - 3 &&
        Math.abs(t.axial - patch.axial) < patch.axialExtent / 2 - 3 &&
        !plan.trees.some(other => Math.hypot(wrap(t.azimuth - other.azimuth) * radius, t.axial - other.axial) < 5)
    })
    // Light the approach and the front of each bench. Lighting only from
    // behind the backrest leaves the usable face black at night.
    const lamps = [{ x: -7, y: -9 }, { x: 7, y: -9 },
      { x: entrance.x + forward.x * 4 + forward.y * 3.5, y: entrance.y + forward.y * 4 - forward.x * 3.5 }]
      .filter(p => !paths.some(r => inside(p, r, .8)))
    return { patch, azimuth, axial, entrance, forward, roadIndex, paths, benches, lamps, trees }
  }
  return null
}

/** Partition overlapping strips into disjoint rectangles, avoiding coplanar
 * duplicate faces at the loop corners, entrance and bench pads. */
export function parkPathTiles(paths: ParkPath[]): ParkPath[] {
  const xs = [...new Set(paths.flatMap(p => [p.x - p.width / 2, p.x + p.width / 2]))].sort((a, b) => a - b)
  const ys = [...new Set(paths.flatMap(p => [p.y - p.depth / 2, p.y + p.depth / 2]))].sort((a, b) => a - b)
  const tiles: ParkPath[] = []
  for (let x = 1; x < xs.length; x++) for (let y = 1; y < ys.length; y++) {
    const p = { x: (xs[x - 1] + xs[x]) / 2, y: (ys[y - 1] + ys[y]) / 2 }
    if (paths.some(r => inside(p, r))) tiles.push({ ...p, width: xs[x] - xs[x - 1], depth: ys[y] - ys[y - 1] })
  }
  return tiles
}
