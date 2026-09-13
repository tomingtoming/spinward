import type { CityIntersection } from './cityLayout'
import { StreetMarkingPlan, type StreetCrossing, type StreetJunction, type StreetPaint } from './streetMarkings'
import { sampleStreetPath, streetRibbon } from './streetPath'
import { positivePolygon } from './streetPolygon'
import { SurfaceIndex } from './surfaceIndex'
import { signalPhaseOffset, STOP_LINE_GAP_METERS, isSignalledIntersection, type SignalControl } from './intersectionSignals'

export type StreetSignalApproach = {
  crossing: StreetCrossing
  stop: number
  phase: number
  control: SignalControl
}

/** A junction is controlled as one unit. Never show a partial set of signals
 * when a short arm, authored floor or overlapping road lacks safe markings. */
export class StreetSignalPlan {
  private readonly candidates: StreetJunction[] = []
  private readonly index: SurfaceIndex
  private readonly byStreet = new Map<string, Set<StreetJunction>>()
  private readonly cache = new Map<number, readonly StreetSignalApproach[]>()

  readonly legacyFallbacks: readonly CityIntersection[]

  constructor(readonly markings: StreetMarkingPlan, legacy: readonly CityIntersection[] = []) {
    const { network } = markings
    this.index = new SurfaceIndex(network.radius)
    for (const junction of markings.junctions) {
      if (!junction.arms.some(a => network.streets[a.street].kind === 'arterial')) continue
      const node = network.nodes[junction.node]
      this.index.insert({ ...node, tangentWidth: 0, axialLength: 0 }, this.candidates.length)
      this.candidates.push(junction)
      // Include coalesced copies, so every legacy traffic route sees the same
      // physical stop even when the graph selected a wider coincident path.
      for (const id of node.edges) {
        const street = network.streets[network.edges[id].street].id
        const list = this.byStreet.get(street) ?? new Set<StreetJunction>()
        list.add(junction); this.byStreet.set(street, list)
      }
    }
    // Keep existing traffic protection where a legacy stub cannot yet support
    // a whole native junction. The road-layout migration owns these remnants.
    this.legacyFallbacks = legacy.filter(c => isSignalledIntersection(c) && !this.controlsJunction(c.azimuth, c.axial))
  }

  controlsJunction(azimuth: number, axial: number): boolean {
    const network = this.markings.network
    for (const id of this.index.query({ azimuth, axial, tangentWidth: .02, axialLength: .02 })) {
      const j = this.candidates[id], n = network.nodes[j.node]
      if (Math.hypot(Math.atan2(Math.sin(n.azimuth - azimuth), Math.cos(n.azimuth - azimuth)) * network.radius, n.axial - axial) < .01)
        return this.approaches(j).length > 0
    }
    return false
  }

  private approaches(junction: StreetJunction): readonly StreetSignalApproach[] {
    const cached = this.cache.get(junction.node)
    if (cached) return cached
    const crossings = this.markings.junctionCrossings(junction), out: StreetSignalApproach[] = []
    this.cache.set(junction.node, out)
    if (crossings.length !== junction.arms.length) return out
    // Stable phase order, retaining the axial-first 32-second cycle on the
    // existing grid. Oblique and extra arms need no avenue/street labels.
    const arms = [...junction.arms].sort((a, b) => Math.abs(b.dy) - Math.abs(a.dy) || a.street - b.street || a.sign - b.sign)
    const groups: typeof arms = []
    const assignments = new Map<typeof arms[number], number>()
    for (const arm of arms) {
      let group = groups.findIndex(g => Math.abs(g.dx * arm.dy - g.dy * arm.dx) < 1e-5)
      if (group < 0) { group = groups.length; groups.push(arm) }
      assignments.set(arm, group)
    }
    const phase = signalPhaseOffset(this.markings.network.nodes[junction.node])
    const pending: StreetSignalApproach[] = []
    for (const crossing of crossings) {
      const { street, sign, station, source } = crossing
      const edge = sign === 1 ? crossing.end : crossing.start
      const distance = Math.abs(this.markings.distanceAt(street, edge) - station) + STOP_LINE_GAP_METERS
      if (distance + .15 > crossing.limit) return out
      const stop = this.markings.parameterAt(street, station + sign * distance)
      const start = this.markings.parameterAt(street, station + sign * (distance - .15))
      const end = this.markings.parameterAt(street, station + sign * (distance + .15))
      if (!this.markings.clearOfOtherRoads({ source, start: Math.min(start, end), end: Math.max(start, end) }, 1.1)) return out
      const arm = arms.find(a => a.street === street && a.sign === sign)!
      pending.push({ crossing, stop, phase, control: { group: assignments.get(arm)!, groups: groups.length } })
    }
    out.push(...pending)
    return out
  }

  nearby(azimuth: number, axial: number, range: number, maxHeads = 512): StreetSignalApproach[] {
    if (!(range > 0) || maxHeads <= 0) return []
    const network = this.markings.network
    const junctions = [...this.index.query({ azimuth, axial, tangentWidth: range * 2, axialLength: range * 2 })]
      .map(i => { const junction = this.candidates[i], n = network.nodes[junction.node]
        return { junction, distance: Math.hypot(Math.atan2(Math.sin(n.azimuth - azimuth), Math.cos(n.azimuth - azimuth)) * network.radius, n.axial - axial) } })
      .filter(j => j.distance <= range).sort((a, b) => a.distance - b.distance || a.junction.node - b.junction.node)
    const out: StreetSignalApproach[] = []
    for (const { junction } of junctions) {
      const approaches = this.approaches(junction)
      if (out.length + approaches.length > maxHeads) continue
      out.push(...approaches)
    }
    return out
  }

  forStreet(id: string): StreetSignalApproach[] {
    const out: StreetSignalApproach[] = [], network = this.markings.network
    for (const j of this.byStreet.get(id) ?? []) {
      // Compare physical directions rather than path identity for duplicates.
      const node = network.nodes[j.node]
      const arms = node.edges.flatMap(eid => { const e = network.edges[eid]
        if (network.streets[e.street].id !== id) return []
        const sign = e.from === j.node ? 1 : -1, p = sampleStreetPath(network.streets[e.street], sign === 1 ? e.start : e.end)
        return [{ x: Math.cos(p.heading) * sign, y: Math.sin(p.heading) * sign }] })
      for (const a of this.approaches(j)) {
        const c = a.crossing, p = sampleStreetPath(c.source, this.markings.parameterAt(c.street, c.station))
        if (arms.some(v => (v.x * Math.cos(p.heading) + v.y * Math.sin(p.heading)) * c.sign > 1 - 1e-8)) out.push(a)
      }
    }
    return out
  }

  paint(approaches: readonly StreetSignalApproach[]): StreetPaint[] {
    return approaches.map(a => {
      const c = a.crossing, d = this.markings.distanceAt(c.street, a.stop)
      const start = this.markings.parameterAt(c.street, d - .15), end = this.markings.parameterAt(c.street, d + .15)
      // Left-hand traffic: only the inbound half of this approach receives a stop.
      const offsets = [-c.sign * .3, -c.sign * (c.source.width / 2 - .3)].sort((a, b) => a - b)
      return { source: c.source, junction: false, lift: Math.max(.2, c.source.groundHeight) + .05,
        polygon: positivePolygon(streetRibbon(c.source, start, end, offsets[0], offsets[1]).map(p => ({ x: p.x, y: p.y, u: 0, v: 0 }))) }
    })
  }
}
