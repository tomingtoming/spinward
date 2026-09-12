import { riverCentre, riverWalkHeight, riverRoadGeometry, type RiverDistrict } from '../objects/riverDistrictPlan'
import { sampleCitySurface } from '../objects/citySurfaceMesh'
import type { SurfacePoint } from './neighborhoodRoute'

type Point = { x: number; y: number; h: number; riverWalk: 'bridge' | 'upper' | 'ramp' | 'bank' }
type Edge = { a: number; b: number; width: number }
export type RiverWalkGraph = { nodes: Point[]; edges: Edge[]; portals: number[] }
const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a))
const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y, a.h - b.h)
const clamp = (n: number) => Math.max(0, Math.min(1, n))
const cache = new WeakMap<RiverDistrict, RiverWalkGraph>()

/** A bounded graph of existing pedestrian surfaces. Bridge and underpass
 * retain separate nodes at the same XY; only the four end ramps connect them. */
export function riverWalkGraph(p: RiverDistrict, radius: number): RiverWalkGraph {
  const previous = cache.get(p); if (previous) return previous
  const nodes: Point[] = [], edges: Edge[] = [], portals: number[] = []
  const add = (x: number, y: number, expected: number, riverWalk: Point['riverWalk']) => {
    let h = 0
    for (const s of p.surfaces) {
      if (s.material !== 'stone' && s.material !== 'earth') continue
      const b = s.collider, xx = x - wrap(b.azimuth - p.azimuth) * radius, yy = y - (b.axial - p.axial)
      if (Math.abs(xx) > b.width / 2 + .01 || Math.abs(yy) > b.depth / 2 + .01) continue
      h = Math.max(h, sampleCitySurface(b.surfaceMesh!, xx, yy, expected + .3))
    }
    // Every node uses the rendered/physical mesh, not a separate idealised slope.
    if (Math.abs(h - expected) > .31) throw Error('River walking node has no matching support')
    nodes.push({ x, y, h, riverWalk }); return nodes.length - 1
  }
  const line = (from: number, to: number, width: number, sample?: (t: number) => Point) => {
    const a = nodes[from], b = nodes[to], count = Math.ceil(distance(a, b) / 4)
    let last = from
    for (let i = 1; i < count; i++) {
      const t = i / count, q = sample?.(t) ?? { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, h: a.h + (b.h - a.h) * t, riverWalk: b.riverWalk }
      const next = add(q.x, q.y, q.h, q.riverWalk); edges.push({ a: last, b: next, width }); last = next
    }
    edges.push({ a: last, b: to, width })
  }
  const road = riverRoadGeometry(p, radius)
  const roadNode = (x: number, side: number) => { const q = road.point(x, side * 4.65, .34); return add(...q, 'bridge') }
  const lowerEnds = new Map<string, number>()
  for (const bank of [-1, 1]) {
    let last = -1
    for (let y = -100; y <= 100; y += 4) {
      const id = add(riverCentre(y) + bank * 13.5, y, riverWalkHeight(y), Math.abs(y) > 50 ? 'ramp' : 'bank')
      if (last >= 0) edges.push({ a: last, b: id, width: 1.6 })
      if (Math.abs(y) === 100) lowerEnds.set(`${bank}:${Math.sign(y)}`, id)
      last = id
    }
  }
  for (const side of [-1, 1]) {
    const junctions: { x: number; bank: number; id: number }[] = []
    for (const bank of [-1, 1]) {
      let lo = bank * 21 - 12, hi = bank * 21 + 12
      for (let i = 0; i < 35; i++) { const mid = (lo + hi) / 2, q = road.point(mid, side * 4.65, .34)
        if (q[0] < riverCentre(q[1]) + bank * 21) lo = mid; else hi = mid }
      const x = (lo + hi) / 2, id = roadNode(x, side), q = nodes[id]
      junctions.push({ x, bank, id })
      const endY = side * 100, upper = add(riverCentre(endY) + bank * 21, endY, 5.14, 'upper')
      line(id, upper, 1.25, t => {
        const y = q.y + (endY - q.y) * t, x = riverCentre(y) + bank * 21
        const h = 5.14 + .2 * clamp((7.8 - Math.abs((y - .25 * x) / Math.sqrt(1.0625))) / 2)
        return { x, y, h, riverWalk: 'upper' }
      })
      line(upper, lowerEnds.get(`${bank}:${side}`)!, 1.25)
    }
    const start = roadNode(road.left, side), end = roadNode(road.right, side)
    portals.push(start, end)
    const stops = [{ x: road.left, id: start }, ...junctions.sort((a, b) => a.x - b.x), { x: road.right, id: end }]
    for (let i = 1; i < stops.length; i++) {
      const a = stops[i - 1], b = stops[i]
      line(a.id, b.id, .75, t => { const q = road.point(a.x + (b.x - a.x) * t, side * 4.65, .34); return { x: q[0], y: q[1], h: q[2], riverWalk: 'bridge' } })
    }
  }
  const graph = { nodes, edges, portals }; cache.set(p, graph); return graph
}
const surface = (p: RiverDistrict, radius: number, q: Point): SurfacePoint => ({ azimuth: p.azimuth + q.x / radius, axial: p.axial + q.y, groundHeight: q.h, riverWalk: q.riverWalk })

export function riverLocalRoute(p: RiverDistrict, radius: number, start: SurfacePoint, goal: SurfacePoint): SurfacePoint[] | null {
  const graph = riverWalkGraph(p, radius), nodes = [...graph.nodes], edges = [...graph.edges]
  const attach = (point: SurfacePoint) => {
    const x = wrap(point.azimuth - p.azimuth) * radius, y = point.axial - p.axial, h = point.groundHeight ?? 0
    let best: { q: Point; edge: Edge; score: number } | undefined
    for (const edge of graph.edges) {
      const a = nodes[edge.a], b = nodes[edge.b], dx = b.x - a.x, dy = b.y - a.y
      const t = clamp(((x - a.x) * dx + (y - a.y) * dy) / (dx * dx + dy * dy || 1))
      const q = { x: a.x + dx * t, y: a.y + dy * t, h: a.h + (b.h - a.h) * t, riverWalk: t < .5 ? a.riverWalk : b.riverWalk }
      const d = Math.hypot(x - q.x, y - q.y)
      // No snapping across rails, carriageways or a vertical layer separation.
      if (d > edge.width || Math.abs(h - q.h) > .45) continue
      const score = Math.hypot(d, h - q.h)
      if (!best || score < best.score) best = { q, edge, score }
    }
    if (!best) return null
    const id = nodes.length; nodes.push(best.q)
    edges.push({ a: id, b: best.edge.a, width: 0 }, { a: id, b: best.edge.b, width: 0 })
    return { id, edge: best.edge }
  }
  const from = attach(start), to = attach(goal)
  if (!from || !to) return null
  if (from.edge === to.edge) edges.push({ a: from.id, b: to.id, width: 0 })
  const neighbors = nodes.map(() => [] as number[])
  for (const e of edges) { neighbors[e.a].push(e.b); neighbors[e.b].push(e.a) }
  const costs = nodes.map(() => Infinity), parents = nodes.map(() => -1), closed = new Set<number>()
  costs[from.id] = 0
  for (let i = 0; i < nodes.length; i++) {
    let id = -1
    for (let n = 0; n < nodes.length; n++) if (!closed.has(n) && (id < 0 || costs[n] < costs[id])) id = n
    if (id < 0 || !Number.isFinite(costs[id])) return null
    if (id === to.id) break
    closed.add(id)
    for (const n of neighbors[id]) { const cost = costs[id] + distance(nodes[id], nodes[n]); if (cost < costs[n]) { costs[n] = cost; parents[n] = id } }
  }
  if (!Number.isFinite(costs[to.id])) return null
  const ids: number[] = []
  for (let id = to.id; id >= 0; id = parents[id]) { ids.push(id); if (id === from.id) break }
  return [start, ...ids.reverse().map(id => surface(p, radius, nodes[id])), goal]
}

/** Connect one endpoint in the district to the existing street search only at
 * a real bridge sidewalk mouth. Unrelated street/vehicle routes remain theirs. */
export function routeThroughRiver(p: RiverDistrict, radius: number, start: SurfacePoint, goal: SurfacePoint,
  streets: (a: SurfacePoint, b: SurfacePoint) => SurfacePoint[] | null): SurfacePoint[] | null | undefined {
  const road = riverRoadGeometry(p, radius)
  const inside = (q: SurfacePoint) => {
    const x = wrap(q.azimuth - p.azimuth) * radius, y = q.axial - p.axial
    return Math.abs(y) < p.length / 2 && (Math.abs(x) < p.width / 2 ||
      x > road.left + .4 && x < road.right - .4 && Math.abs(y - road.point(x, 0)[1]) < 6.6)
  }
  const a = inside(start), b = inside(goal)
  if (!a && !b) return undefined
  if (a && b) return riverLocalRoute(p, radius, start, goal)
  const graph = riverWalkGraph(p, radius)
  let best: SurfacePoint[] | null = null, shortest = Infinity
  for (const id of graph.portals) {
    const portal = surface(p, radius, graph.nodes[id])
    const local = a ? riverLocalRoute(p, radius, start, portal) : riverLocalRoute(p, radius, portal, goal)
    if (!local) continue
    const outer = a ? streets(portal, goal) : streets(start, portal)
    if (!outer) continue
    const path = a ? [...local, ...outer.slice(1)] : [...outer, ...local.slice(1)]
    const length = path.reduce((d, q, i) => d + (i ? Math.hypot(wrap(q.azimuth - path[i - 1].azimuth) * radius, q.axial - path[i - 1].axial) : 0), 0)
    if (length < shortest) { best = path; shortest = length }
  }
  return best
}
