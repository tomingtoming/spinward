import type { CityBuilding, CityRoad } from './cityLayout'
import type { StreetAccess, StreetAccessRejection } from './streetAccess'
import { SurfaceIndex } from './surfaceIndex'
import { StreetNetwork } from './streetNetwork'
import { legacyStreetPaths } from './streetPath'
import { FOOTPATH_WIDTH } from './streetProfile'
import { streetPathSurfaces, streetSurfaceEnvelope } from './streetSurfacePlan'
import { intersectStreetPolygons, polygonArea, positivePolygon, type StreetPolygon } from './streetPolygon'

type Point = { x: number; y: number }
type Origin = { azimuth: number; axial: number }
const EPS = 1e-5
const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a))
const vertex = (x: number, y: number) => ({ x, y, u: x, v: y })
const dot = (a: Point, b: Point) => a.x * b.x + a.y * b.y
const relative = (p: StreetPolygon, from: Origin, to: Origin, radius: number) => {
  const x = wrap(from.azimuth - to.azimuth) * radius, y = from.axial - to.axial
  return p.map(v => ({ ...v, x: v.x + x, y: v.y + y }))
}
export function buildingFootprint(b: CityBuilding): StreetPolygon {
  const c = Math.cos(b.yaw ?? 0), s = Math.sin(b.yaw ?? 0)
  return [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([x, y]) =>
    vertex(c * x * b.width / 2 - s * y * b.depth / 2, s * x * b.width / 2 + c * y * b.depth / 2))
}
function envelope(p: StreetPolygon, origin: Origin, radius: number) {
  const xs = p.map(v => v.x), ys = p.map(v => v.y)
  const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys)
  return { azimuth: origin.azimuth + (x0 + x1) / (2 * radius), axial: origin.axial + (y0 + y1) / 2,
    tangentWidth: x1 - x0, axialLength: y1 - y0 }
}
const overlaps = (a: StreetPolygon, b: StreetPolygon) => polygonArea(intersectStreetPolygons(a, b)) > EPS

type Kerb = { low: number; high: number; slope: number; intercept: number }
/** Lower envelope of the road's incoming edges, across the entire door width.
 * Sampling only the centre or the two corners misses gaps and intermediate
 * bends. Breakpoints include edge endpoints AND intersections of competing
 * edges, so every resulting interval has one exact, nearest boundary. */
function corridorToRoad(polygons: StreetPolygon[], normal: Point, width: number, maxGap: number) {
  const lateral = { x: normal.y, y: -normal.x }, half = width / 2, edges: Kerb[] = []
  for (const polygon of polygons) for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i], b = polygon[(i + 1) % polygon.length]
    const x0 = dot(a, lateral), x1 = dot(b, lateral)
    if (x1 - x0 < EPS) continue // This edge must face the entrance.
    const y0 = dot(a, normal), y1 = dot(b, normal), slope = (y1 - y0) / (x1 - x0), intercept = y0 - slope * x0
    let low = Math.max(-half, x0), high = Math.min(half, x1)
    if (Math.abs(slope) < 1e-10) { if (intercept < -EPS || intercept > maxGap + EPS) continue }
    else {
      const a = (-EPS - intercept) / slope, b = (maxGap + EPS - intercept) / slope
      low = Math.max(low, Math.min(a, b)); high = Math.min(high, Math.max(a, b))
    }
    if (high - low > 1e-8) edges.push({ low, high, slope, intercept })
  }
  const cuts = [-half, half, ...edges.flatMap(e => [e.low, e.high])]
  for (let i = 0; i < edges.length; i++) for (let j = i + 1; j < edges.length; j++) {
    const a = edges[i], b = edges[j], denominator = a.slope - b.slope
    if (Math.abs(denominator) < 1e-10) continue
    const x = (b.intercept - a.intercept) / denominator
    if (x > Math.max(a.low, b.low) && x < Math.min(a.high, b.high)) cuts.push(x)
  }
  cuts.sort((a, b) => a - b)
  const pieces: StreetPolygon[] = []
  let length = Infinity
  const point = (x: number, y: number) => vertex(lateral.x * x + normal.x * y, lateral.y * x + normal.y * y)
  for (let i = 1; i < cuts.length; i++) {
    const a = cuts[i - 1], b = cuts[i], middle = (a + b) / 2
    if (b - a < 1e-8) continue
    let edge: Kerb | undefined, distance = Infinity
    for (const e of edges) if (middle >= e.low && middle <= e.high) {
      const d = e.slope * middle + e.intercept
      if (d < distance) { distance = d; edge = e }
    }
    if (!edge) return null // Even a narrow uncovered interval is not frontage.
    const ya = Math.max(0, edge.slope * a + edge.intercept), yb = Math.max(0, edge.slope * b + edge.intercept)
    if (a <= 0 && b >= 0) length = Math.min(length, Math.max(0, edge.intercept))
    const piece = positivePolygon([point(a, 0), point(b, 0), point(b, yb), point(a, ya)])
    if (polygonArea(piece) > 1e-8) pieces.push(piece)
  }
  return Number.isFinite(length) ? { pieces, length } : null
}

/** Compile access once from the same sampled ribbons and graph as pavement.
 * AABBs are a broad phase only; overlap and full-width frontage use polygons.
 * The original reserved footprint remains an obstacle even if a fitted house
 * is smaller, so later lot walls cannot consume a neighbour's certified path. */
export function certifyStreetAccess(
  buildings: CityBuilding[], roads: CityRoad[] | StreetNetwork, radius: number, maxGap: number,
  fit: (building: CityBuilding) => CityBuilding = b => b
) {
  const network = roads instanceof StreetNetwork ? roads : new StreetNetwork(legacyStreetPaths(roads), radius)
  if (network.radius !== radius || !Number.isFinite(maxGap) || maxGap < 0) throw Error('Invalid frontage coordinates')
  const surfaces = network.streets.flatMap((path, street) => streetPathSurfaces(path, radius).map(s =>
    ({ ...s, street, bounds: streetSurfaceEnvelope(s, radius) })))
  const roadIndex = new SurfaceIndex(radius), buildingIndex = new SurfaceIndex(radius)
  surfaces.forEach((s, i) => roadIndex.insert(s.bounds, i))
  const footprints = buildings.map(buildingFootprint)
  const buildingBounds = buildings.map((b, i) => envelope(footprints[i], b, radius))
  buildingBounds.forEach((bounds, i) => buildingIndex.insert(bounds, i))
  const close = (a: ReturnType<typeof envelope>, b: ReturnType<typeof envelope>) =>
    Math.abs(wrap(a.azimuth - b.azimuth)) * radius < (a.tangentWidth + b.tangentWidth) / 2 + EPS &&
    Math.abs(a.axial - b.axial) < (a.axialLength + b.axialLength) / 2 + EPS
  const connected = new Set(network.streets.flatMap((s, i) => s.kind === 'arterial' ? [network.components[i]] : []))
  const accepted: Array<CityBuilding & { front: NonNullable<CityBuilding['front']>; access: StreetAccess }> = []
  const rejected: StreetAccessRejection[] = []
  buildings.forEach((original, index) => {
    const b = fit(original), front = b.front
    if (!front) { rejected.push({ building: original, reason: 'missing-front' }); return }
    const c = Math.cos(b.yaw ?? 0), s = Math.sin(b.yaw ?? 0), tangent = front.axis === 'tangent'
    const normal = { x: front.side * (tangent ? c : -s), y: front.side * (tangent ? s : c) }
    const half = (tangent ? b.width : b.depth) / 2, width = Math.min(FOOTPATH_WIDTH, (tangent ? b.depth : b.width) * .5)
    const entrance = { azimuth: b.azimuth + normal.x * half / radius, axial: b.axial + normal.y * half }
    const fittedGap = maxGap + Math.abs(wrap(b.azimuth - original.azimuth)) * radius + Math.abs(b.axial - original.axial) +
      Math.max(original.width - b.width, original.depth - b.depth, 0) / 2
    const bounds = envelope([...footprints[index], ...relative(buildingFootprint(b), b, original, radius)], original, radius)
    bounds.tangentWidth += fittedGap * 2; bounds.axialLength += fittedGap * 2
    const nearby = [...roadIndex.query(bounds)].map(i => surfaces[i]).filter(s =>
      s.source.level === (b.streetLevel ?? 0) && close(bounds, s.bounds))
    if (nearby.some(s => overlaps(footprints[index], relative(s.polygon, s.source, original, radius)))) {
      rejected.push({ building: original, reason: 'road-overlap' }); return
    }
    const groups = new Map<number, StreetPolygon[]>()
    for (const surface of nearby) {
      if (!connected.has(network.components[surface.street]) || Math.abs(surface.source.groundHeight - (b.baseHeight ?? 0)) > .5) continue
      const p = relative(surface.polygon, surface.source, entrance, radius), group = groups.get(surface.street)
      if (group) group.push(p); else groups.set(surface.street, [p])
    }
    let best: StreetAccess | null = null, blocked = false
    for (const [street, polygons] of groups) {
      const corridor = corridorToRoad(polygons, normal, width, fittedGap)
      if (!corridor || (best && corridor.length >= best.length - EPS)) continue
      const obstructed = corridor.pieces.some(piece => {
        const bounds = envelope(piece, entrance, radius)
        if (nearby.some(s => close(bounds, s.bounds) && overlaps(piece, relative(s.polygon, s.source, entrance, radius)))) return true
        return [...buildingIndex.query(bounds)].some(other => other !== index && close(bounds, buildingBounds[other]) &&
          (buildings[other].streetLevel ?? 0) === (b.streetLevel ?? 0) &&
          overlaps(piece, relative(footprints[other], buildings[other], entrance, radius)))
      })
      if (obstructed) { blocked = true; continue }
      // Straight entrances are fully represented by their endpoints and width.
      // Do not retain four redundant vertex objects for every city building.
      const rectangular = corridor.pieces.every(p => p.every(v => {
        const d = dot(v, normal)
        return Math.abs(d) < 1e-8 || Math.abs(d - corridor.length) < 1e-8
      }))
      best = { roadId: network.streets[street].id, roadIndex: street, entrance,
        roadEdge: { azimuth: entrance.azimuth + normal.x * corridor.length / radius, axial: entrance.axial + normal.y * corridor.length },
        width, length: corridor.length,
        ...(rectangular ? {} : { corridor: corridor.pieces }) }
    }
    if (best) accepted.push({ ...original, front, access: best, streetKind: network.streets[best.roadIndex].kind })
    else rejected.push({ building: original, reason: blocked ? 'blocked-path' : 'no-connected-frontage' })
  })
  return { buildings: accepted, rejected }
}

/** Synthetic/older callers may provide just the two endpoints. */
export function streetAccessPolygons(access: StreetAccess, radius: number): StreetPolygon[] {
  if (access.corridor) return access.corridor
  const x = wrap(access.roadEdge.azimuth - access.entrance.azimuth) * radius, y = access.roadEdge.axial - access.entrance.axial
  const length = Math.hypot(x, y)
  if (length < 1e-8) return []
  const dx = y / length * access.width / 2, dy = -x / length * access.width / 2
  return [positivePolygon([vertex(-dx, -dy), vertex(dx, dy), vertex(x + dx, y + dy), vertex(x - dx, y - dy)])]
}
