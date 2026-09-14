import { SurfaceIndex } from './streetAccess'
import { sampleStreetPath, streetRibbon, type StreetPath } from './streetPath'
import { StreetNetwork, type StreetSegment } from './streetNetwork'
import { intersectStreetPolygons, polygonArea, positivePolygon } from './streetPolygon'
import { getStreetProfile } from './streetProfile'
import { streetSurfaceEnvelope, relativeStreetPolygon, type StreetSurface } from './streetSurfacePlan'
import { CROSSWALK_LENGTH_METERS, CROSSWALK_SETBACK_METERS, STOP_LINE_GAP_METERS } from './intersectionSignals'

type Arm = { street: number; t: number; sign: 1 | -1; dx: number; dy: number }
export type StreetJunction = { node: number; arms: Arm[] }
export type StreetCrossing = { node: number; source: StreetPath; street: number; sign: 1 | -1; station: number; limit: number; start: number; end: number; distance: number }
export type StreetPaint = StreetSurface
const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a))
const MAX_SETBACK = 40

/** Crossings are attached to outgoing graph arms, not quarter-turn tiles.
 * Only the nearby markings become geometry. Underlying roads and sidewalks
 * remain owned by the common pavement compiler. */
export class StreetMarkingPlan {
  readonly junctions: StreetJunction[] = []
  private readonly crossingCache = new Map<number, StreetCrossing[]>()
  private readonly index: SurfaceIndex
  private readonly segments: StreetSegment[][]
  private readonly stations: number[][]
  private readonly stationJunctions: Map<number, StreetJunction>[]
  constructor(readonly network: StreetNetwork) {
    this.index = new SurfaceIndex(network.radius)
    this.segments = network.streets.map(() => [])
    this.stations = network.streets.map((_, i) => [0, network.streetLengths[i]])
    this.stationJunctions = network.streets.map(() => new Map())
    for (const s of network.segments) this.segments[s.street].push(s)
    network.nodes.forEach((node, id) => {
      const arms: Arm[] = []
      for (const edgeId of node.edges) {
        const e = network.edges[edgeId], path = network.streets[e.street]
        const sign = e.from === id ? 1 : -1, t = sign === 1 ? e.start : e.end
        const p = sampleStreetPath(path, t)
        const arm: Arm = { street: e.street, t, sign, dx: Math.cos(p.heading) * sign, dy: Math.sin(p.heading) * sign }
        const duplicate = arms.findIndex(a => a.dx * arm.dx + a.dy * arm.dy > 1 - 1e-8)
        if (duplicate < 0) arms.push(arm)
        else if (path.width > network.streets[arms[duplicate].street].width) arms[duplicate] = arm
      }
      if (arms.length < 3) return
      for (const edgeId of node.edges) {
        const e = network.edges[edgeId]
        this.stations[e.street].push(this.distanceAt(e.street, e.from === id ? e.start : e.end))
      }
      // Authored ramps and floors carry their own appearance and crossings.
      if (arms.some(a => network.streets[a.street].surfaceOwner === 'authored')) return
      this.index.insert({ ...node, tangentWidth: 0, axialLength: 0 }, this.junctions.length)
      this.junctions.push({ node: id, arms })
    })
    this.stations = this.stations.map(values => [...new Set(values)].sort((a, b) => a - b))
    for (const junction of this.junctions) for (const arm of junction.arms)
      this.stationJunctions[arm.street].set(this.distanceAt(arm.street, arm.t), junction)
  }

  distanceAt(street: number, t: number) {
    const parts = this.segments[street]
    const s = parts.find(p => t <= p.end.t + 1e-9) ?? parts.at(-1)!
    return s.distanceStart + (s.distanceEnd - s.distanceStart) * (t - s.start.t) / (s.end.t - s.start.t)
  }
  parameterAt(street: number, d: number) {
    const parts = this.segments[street], s = parts.find(p => d <= p.distanceEnd + 1e-9) ?? parts.at(-1)!
    return s.start.t + (s.end.t - s.start.t) * (d - s.distanceStart) / (s.distanceEnd - s.distanceStart)
  }

  crossings(azimuth: number, axial: number, range: number, maxCrossings = 512): StreetCrossing[] {
    if (!(range > 0) || maxCrossings <= 0) return []
    const { network } = this, radius = network.radius, span = (range + MAX_SETBACK + 4) * 2
    const out: StreetCrossing[] = []
    for (const id of this.index.query({ azimuth, axial, tangentWidth: span, axialLength: span })) {
      const junction = this.junctions[id]
      for (const c of this.junctionCrossings(junction)) {
        const p = sampleStreetPath(c.source, (c.start + c.end) / 2)
        const distance = Math.hypot(wrap(c.source.azimuth + p.x / radius - azimuth) * radius, c.source.axial + p.y - axial)
        if (distance <= range) out.push({ ...c, distance })
      }
    }
    return out.sort((a, b) => a.distance - b.distance || a.node - b.node || a.source.id.localeCompare(b.source.id)).slice(0, maxCrossings)
  }

  /** Stable geometry shared by nearby paint, signal heads and traffic stops. */
  junctionCrossings(junction: StreetJunction): readonly StreetCrossing[] {
    const cached = this.crossingCache.get(junction.node)
    if (cached) return cached
    const { network } = this, radius = network.radius, out: StreetCrossing[] = []
    for (const arm of junction.arms) {
      const source = network.streets[arm.street], profile = getStreetProfile(source.kind, radius)
      if (!profile.sidewalk) continue
      const end = this.crossingExtent(junction, arm)
      if (end === null) continue
      const station = this.distanceAt(arm.street, arm.t), start = end - CROSSWALK_LENGTH_METERS
      const next = arm.sign === 1 ? this.stations[arm.street].find(s => s > station + 1e-5)
        : this.stations[arm.street].filter(s => s < station - 1e-5).at(-1)
      if (next === undefined) continue
      const span = Math.abs(next - station)
      let limit = span / 2
      const neighbor = this.stationJunctions[arm.street].get(next)
      const opposite = neighbor?.arms.find(a => a.street === arm.street && a.sign === -arm.sign)
      const otherEnd = opposite ? this.crossingExtent(neighbor!, opposite) : null
      // Unequal junction angles need unequal shares of a short block. Split
      // only the spare gap between both crossings, including both stop lines.
      if (otherEnd !== null && (end > limit || otherEnd > limit) &&
        span - end - otherEnd >= 2 * (STOP_LINE_GAP_METERS + .15))
        limit = (span + end - otherEnd) / 2
      if (end > limit) continue
      const a = this.parameterAt(arm.street, station + start * arm.sign)
      const b = this.parameterAt(arm.street, station + end * arm.sign)
      const crossing: StreetCrossing = { node: junction.node, source, street: arm.street, sign: arm.sign, station, limit, start: Math.min(a, b), end: Math.max(a, b), distance: 0 }
      if (this.clearOfOtherRoads(crossing)) out.push(crossing)
    }
    this.crossingCache.set(junction.node, out)
    return out
  }

  private crossingExtent(junction: StreetJunction, arm: Arm): number | null {
    const source = this.network.streets[arm.street]
    let setback = 0, hasCrossing = false
    for (const other of junction.arms) {
      const sine = Math.abs(arm.dx * other.dy - arm.dy * other.dx)
      if (sine < 1e-5) continue
      const road = this.network.streets[other.street]
      if (!getStreetProfile(road.kind, this.network.radius).sidewalk) continue
      const cosine = arm.dx * other.dx + arm.dy * other.dy
      // Arms are outgoing half-roads. For an obtuse continuation its end
      // cap is furthest forward; an infinite line invents a road ahead.
      const extent = cosine < 0 ? road.width / 2 * sine
        : (road.width / 2 + source.width / 2 * cosine) / sine
      setback = Math.max(setback, extent); hasCrossing = true
    }
    return hasCrossing && setback <= MAX_SETBACK ? setback + CROSSWALK_SETBACK_METERS + CROSSWALK_LENGTH_METERS : null
  }

  clearOfOtherRoads(crossing: Pick<StreetCrossing, 'source' | 'start' | 'end'>, margin = 0) {
    const { source, start, end } = crossing, radius = this.network.radius
    const surface: StreetSurface = { source, polygon: positivePolygon(streetRibbon(source, start, end, -source.width / 2 - margin, source.width / 2 + margin)
      .map(p => ({ x: p.x, y: p.y, u: 0, v: 0 }))), junction: false, lift: 0 }
    const e = streetSurfaceEnvelope(surface, radius), heading = sampleStreetPath(source, (start + end) / 2).heading
    for (const s of this.network.query(e.azimuth, e.axial, e.tangentWidth, e.axialLength)) {
      const other = this.network.streets[s.street]
      if (other === source || other.level !== source.level) continue
      // Coalesced copies of the same physical straight run share its markings.
      // Parallel adjacent roads still participate in the actual polygon check.
      const p = sampleStreetPath(source, (start + end) / 2), q = sampleStreetPath(other, s.start.t)
      const dx = wrap(other.azimuth - source.azimuth) * radius + q.x - p.x, dy = other.axial - source.axial + q.y - p.y
      if (Math.abs(Math.sin(heading - q.heading)) < 1e-5 && Math.abs(dx * Math.sin(heading) - dy * Math.cos(heading)) < 1e-5) continue
      const polygon = positivePolygon(streetRibbon(other, s.start.t, s.end.t, -other.width / 2, other.width / 2).map(p => ({ x: p.x, y: p.y, u: 0, v: 0 })))
      const obstacle = relativeStreetPolygon({ source: other, polygon, junction: false, lift: 0 }, source, radius)
      if (polygonArea(intersectStreetPolygons(surface.polygon, obstacle)) > 1e-5) return false
    }
    return true
  }

  paint(crossings: readonly StreetCrossing[]): StreetPaint[] {
    const out: StreetPaint[] = []
    for (const crossing of crossings) {
      const { source, start, end } = crossing
      const street = this.network.streets.indexOf(source)
      const splits = [start, ...this.segments[street].map(s => s.end.t).filter(t => t > start && t < end), end]
      const half = source.width / 2
      for (let i = 1; i < splits.length; i++) {
        const add = (low: number, high: number) => {
          const polygon = positivePolygon(streetRibbon(source, splits[i - 1], splits[i], low, high).map(p => ({ x: p.x, y: p.y, u: 0, v: 0 })))
          out.push({ source, polygon, junction: false, lift: Math.max(.2, source.groundHeight) + .05 })
        }
        const count = Math.max(2, Math.floor(source.width - .6)), first = -(count - 1) / 2
        for (let stripe = 0; stripe < count; stripe++) {
          const offset = first + stripe
          add(Math.max(-half, offset - .25), Math.min(half, offset + .25))
        }
      }
    }
    return out
  }
}
