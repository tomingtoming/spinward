import { SurfaceIndex } from './streetAccess'
import { streetPathSamples, type StreetPath, type StreetPathSample } from './streetPath'

type Point = { x: number; y: number }
export type StreetSegment = {
  street: number; a: Point; b: Point; start: StreetPathSample; end: StreetPathSample
  distanceStart: number; distanceEnd: number
  azimuth: number; axial: number; tangentWidth: number; axialLength: number
}
export type StreetNode = { azimuth: number; axial: number; level: number; edges: number[] }
export type StreetEdge = { street: number; from: number; to: number; start: number; end: number; length: number }
const cross = (a: Point, b: Point) => a.x * b.y - a.y * b.x
const delta = (a: Point, b: Point): Point => ({ x: a.x - b.x, y: a.y - b.y })
const mix = (a: Point, b: Point, t: number): Point => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t })
const EPS = 1e-7

/** Static, cylindrical road graph. Indexing uses envelopes only; connections
 * use centreline intersections and keep different decks separate. No frame
 * loop builds or searches the full city. */
export class StreetNetwork {
  readonly segments: StreetSegment[] = []
  readonly nodes: StreetNode[] = []
  readonly edges: StreetEdge[] = []
  readonly components: Int32Array
  readonly closedEnds: [boolean, boolean][]
  readonly streetLengths: number[]
  private readonly index: SurfaceIndex
  constructor(readonly streets: readonly StreetPath[], readonly radius: number) {
    if (!(radius > 0)) throw Error('A street network needs a positive radius')
    if (new Set(streets.map(p => p.id)).size !== streets.length) throw Error('Duplicate street identity')
    this.index = new SurfaceIndex(radius)
    this.streetLengths = streets.map(()=>0)
    const cuts: number[][] = [], period = Math.PI * 2 * radius
    const parents = streets.map((_, i) => i)
    const root = (i: number): number => {
      while (parents[i] !== i) { parents[i] = parents[parents[i]]; i = parents[i] }
      return i
    }
    streets.forEach((path, street) => {
      const samples = streetPathSamples(path)
      for (let i = 1; i < samples.length; i++) {
        const start = samples[i - 1], end = samples[i]
        const a = { x: path.azimuth * radius + start.x, y: path.axial + start.y }
        const b = { x: path.azimuth * radius + end.x, y: path.axial + end.y }
        const length=Math.hypot(b.x-a.x,b.y-a.y)
        if (length < EPS) throw Error('Zero length street segment')
        const distanceStart=this.streetLengths[street],distanceEnd=distanceStart+length
        this.streetLengths[street]=distanceEnd
        const segment = { street, a, b, start, end, distanceStart,distanceEnd,azimuth: (a.x + b.x) / (2 * radius),
          axial: (a.y + b.y) / 2, tangentWidth: Math.abs(b.x - a.x) + path.width,
          axialLength: Math.abs(b.y - a.y) + path.width }
        const id = this.segments.length
        this.segments.push(segment); cuts.push([0, 1])
        for (const j of this.index.query(segment)) {
          const other = this.segments[j]
          if (other.street === street || streets[other.street].level !== path.level) continue
          const shift = Math.round(((a.x + b.x) - (other.a.x + other.b.x)) / (2 * period)) * period
          const c = { x: other.a.x + shift, y: other.a.y }, d = { x: other.b.x + shift, y: other.b.y }
          const u = delta(b, a), v = delta(d, c), w = delta(c, a), denominator = cross(u, v)
          const add = (s: number, t: number) => {
            cuts[id].push(Math.max(0, Math.min(1, s))); cuts[j].push(Math.max(0, Math.min(1, t)))
            parents[root(street)] = root(other.street)
          }
          if (Math.abs(denominator) > EPS) {
            const s = cross(w, v) / denominator, t = cross(w, u) / denominator
            if (s >= -EPS && s <= 1 + EPS && t >= -EPS && t <= 1 + EPS) add(s, t)
          } else if (Math.abs(cross(w, u)) <= EPS * Math.hypot(u.x, u.y)) {
            const uu = u.x * u.x + u.y * u.y, vv = v.x * v.x + v.y * v.y
            for (const s of [0, 1, (w.x * u.x + w.y * u.y) / uu,
              ((d.x - a.x) * u.x + (d.y - a.y) * u.y) / uu]) {
              const p = mix(a, b, s), t = ((p.x - c.x) * v.x + (p.y - c.y) * v.y) / vv
              if (s >= -EPS && s <= 1 + EPS && t >= -EPS && t <= 1 + EPS) add(s, t)
            }
          }
        }
        this.index.insert(segment, id)
      }
    })
    const nodeIds = new Map<string, number>()
    const node = (p: Point, level: number) => {
      const x = ((p.x % period) + period) % period
      const rounded = Math.round(x * 1e5) % Math.round(period * 1e5)
      const key = `${level}:${rounded}:${Math.round(p.y * 1e5)}`
      let id = nodeIds.get(key)
      if (id === undefined) {
        id = this.nodes.length; nodeIds.set(key, id)
        this.nodes.push({ azimuth: Math.atan2(Math.sin(x / radius), Math.cos(x / radius)), axial: p.y, level, edges: [] })
      }
      return id
    }
    this.segments.forEach((segment, i) => {
      const values = [...new Set(cuts[i].map(t => Math.round(t * 1e10) / 1e10))].sort((a, b) => a - b)
      for (let j = 1; j < values.length; j++) {
        const a = mix(segment.a, segment.b, values[j - 1]), b = mix(segment.a, segment.b, values[j])
        const from = node(a, streets[segment.street].level), to = node(b, streets[segment.street].level)
        if (from === to) continue
        const parameter = (t: number) => segment.start.t + (segment.end.t - segment.start.t) * t
        const edge = { street: segment.street, from, to, start: parameter(values[j - 1]), end: parameter(values[j]), length: Math.hypot(b.x - a.x, b.y - a.y) }
        const id = this.edges.length; this.edges.push(edge)
        this.nodes[from].edges.push(id); this.nodes[to].edges.push(id)
      }
    })
    this.components = Int32Array.from(parents.map((_, i) => root(i)))
    this.closedEnds = streets.map(()=>[true,true])
    // Duplicate source roads may own the same physical edge. They do not turn
    // a dead end into a junction or remove the vehicle's end clearance.
    const closed=(id:number)=>new Set(this.nodes[id].edges.map(i=>{
      const e=this.edges[i];return e.from===id?e.to:e.from
    })).size===1
    for(const edge of this.edges){
      if(edge.start===0)this.closedEnds[edge.street][0]=closed(edge.from)
      if(edge.end===1)this.closedEnds[edge.street][1]=closed(edge.to)
    }
  }
  query(azimuth: number, axial: number, tangentWidth: number, axialLength: number) {
    return [...this.index.query({ azimuth, axial, tangentWidth, axialLength })].map(i => this.segments[i])
  }
}
