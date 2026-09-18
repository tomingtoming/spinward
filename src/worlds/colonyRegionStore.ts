import type { ColonyPackedMesh } from './authoredColony'
import { COLONY_DOCUMENT_FORMAT, COLONY_DOCUMENT_PART_BYTES, readColonyDocument } from './colonyManifestDocument'

type Bounds = [number, number, number, number]
export type ColonyRegion = {
  id: string; url: string; bytes: number; bounds: Bounds; maxHeight: number
  surfaces: { id: string; bounds: Bounds; height: number; groundSurface?: boolean }[]
}
export type ColonyRegions = {
  format: 'colony-regions-v1'; cellSize: number; sourceSha256: string; regions: ColonyRegion[]
  farRanges: Record<string, Record<string, [number, number]>>
}
export type RegionalMesh = Omit<ColonyPackedMesh, 'surfaces'> & {
  surfaces: (ColonyPackedMesh['surfaces'][number] & { id: string })[]
}
export type ColonyFocus = { azimuth: number; axial: number; distance: number }
type Load = (url: string, signal: AbortSignal) => Promise<ArrayBuffer>
type Options = {
  load?: Load; now?: () => number; maxEntries?: number; maxBytes?: number
  maxNumbers?: number; maxDrawIndices?: number; concurrency?: number; retryDelay?: number
  onLoad?: (region: ColonyRegion, packed: RegionalMesh) => void
  onEvict?: (region: ColonyRegion) => void
}
type Entry = { region: ColonyRegion; packed: RegionalMesh; numbers: number; drawIndices: number }
const partURL = /^\/landscapes\/izma\/data-([a-f0-9]{64})\.json$/
const finiteBounds = (value: unknown): value is Bounds => Array.isArray(value) && value.length === 4 &&
  value.every(Number.isFinite) && value[0] <= value[2] && value[1] <= value[3]

export function readColonyRegions(value: ColonyRegions, palette: Record<string, string>, far: ColonyPackedMesh) {
  if (value.format !== 'colony-regions-v1' || !Number.isFinite(value.cellSize) || value.cellSize <= 0 ||
      !/^[a-f0-9]{64}$/.test(value.sourceSha256) || !Array.isArray(value.regions) || !value.farRanges) throw Error('Invalid colony regions')
  const ids = new Set<string>(), surfaces = new Set<string>()
  const ranges = new Map<string, [number, number][]>()
  for (const region of value.regions) {
    if (typeof region.id !== 'string' || ids.has(region.id) || !partURL.test(region.url) ||
        !Number.isInteger(region.bytes) || region.bytes < 3 || region.bytes > COLONY_DOCUMENT_PART_BYTES ||
        !finiteBounds(region.bounds) || !Number.isFinite(region.maxHeight) || !Array.isArray(region.surfaces)) throw Error('Invalid colony region')
    ids.add(region.id)
    for (const surface of region.surfaces) {
      if (typeof surface.id !== 'string' || surfaces.has(surface.id) || !finiteBounds(surface.bounds) || !Number.isFinite(surface.height) ||
          (surface.groundSurface !== undefined && typeof surface.groundSurface !== 'boolean') ||
          surface.bounds[0] < region.bounds[0] || surface.bounds[1] < region.bounds[1] ||
          surface.bounds[2] > region.bounds[2] || surface.bounds[3] > region.bounds[3]) throw Error('Invalid colony regional surface')
      surfaces.add(surface.id)
    }
    const spans = value.farRanges[region.id]
    if (!spans || typeof spans !== 'object') throw Error('Missing colony far ranges')
    for (const [material, span] of Object.entries(spans)) {
      if (!palette[material] || !far.meshes[material] || !Array.isArray(span) || span.length !== 2 ||
          !span.every(n => Number.isInteger(n) && n >= 0 && n % 3 === 0) || !span[1] ||
          span[0] + span[1] > far.meshes[material].length) throw Error('Invalid colony far range')
      const list = ranges.get(material) ?? []; list.push(span); ranges.set(material, list)
    }
  }
  if (Object.keys(value.farRanges).length !== ids.size) throw Error('Unexpected colony far region')
  for (const [material, indices] of Object.entries(far.meshes)) {
    let end = 0
    for (const [start, count] of (ranges.get(material) ?? []).sort((a, b) => a[0] - b[0])) {
      if (start !== end) throw Error('Overlapping or incomplete colony far ranges')
      end += count
    }
    if (end !== indices.length) throw Error('Unassigned colony far geometry')
  }
  return value
}

/** Distance to the complete source bounds, including compounds crossing a
 * 512 m ownership cell and the cylinder's periodic seam. */
export function colonyRegionDistance(region: Pick<ColonyRegion, 'bounds'>, radius: number, focus: Pick<ColonyFocus, 'azimuth' | 'axial'>) {
  const [x0, y0, x1, y1] = region.bounds, x = (x0 + x1) / 2
  const dx = Math.abs(Math.atan2(Math.sin(focus.azimuth - x / radius), Math.cos(focus.azimuth - x / radius)) * radius)
  return Math.hypot(Math.max(0, dx - (x1 - x0) / 2), Math.max(0, y0 - focus.axial, focus.axial - y1))
}

function validateMesh(value: unknown, region: ColonyRegion, palette: Record<string, string>): Entry {
  const packed = value as RegionalMesh
  if (!packed || !Array.isArray(packed.vertices) || !packed.vertices.length || packed.vertices.length % 3 ||
      !packed.vertices.every(Number.isFinite) || !packed.meshes || !Array.isArray(packed.surfaces)) throw Error('Invalid regional geometry')
  const [x0, y0, x1, y1] = region.bounds
  for (let i = 0; i < packed.vertices.length; i += 3) {
    if (packed.vertices[i] < x0 || packed.vertices[i] > x1 || packed.vertices[i + 1] < y0 || packed.vertices[i + 1] > y1 ||
        packed.vertices[i + 2] > region.maxHeight) throw Error('Regional vertex outside catalog bounds')
  }
  let numbers = packed.vertices.length, drawIndices = 0
  const indices = (ids: number[]) => {
    if (!Array.isArray(ids) || !ids.length || ids.length % 3 || ids.some(i => !Number.isInteger(i) || i < 0 || i * 3 + 2 >= packed.vertices.length)) throw Error('Invalid regional triangle')
    numbers += ids.length
  }
  for (const [material, ids] of Object.entries(packed.meshes)) {
    if (!palette[material]) throw Error('Unknown regional material')
    indices(ids); drawIndices += ids.length
  }
  if (packed.surfaces.length !== region.surfaces.length) throw Error('Incomplete regional collision data')
  packed.surfaces.forEach((surface, i) => {
    const descriptor = region.surfaces[i]
    if (surface.id !== descriptor.id || !finiteBounds(surface.bounds) || surface.bounds.some((v, j) => v !== descriptor.bounds[j]) ||
        surface.groundSurface !== descriptor.groundSurface) throw Error('Regional collision descriptor mismatch')
    indices(surface.indices)
    let height = -Infinity
    for (const index of surface.indices) height = Math.max(height, packed.vertices[index * 3 + 2])
    if (height !== descriptor.height) throw Error('Regional collision height mismatch')
  })
  return { region, packed, numbers, drawIndices }
}

/** Holds only demanded complete regions. Collision callers must establish
 * readiness first: unavailable geometry is an explicit error, never empty floor.
 * Budgets cover serialized bytes, numeric elements and GPU input separately;
 * they are not claims about a browser's measured heap size. */
export class ColonyRegionStore {
  private loaded = new Map<string, Entry>()
  private pending = new Map<string, AbortController>()
  private failed = new Map<string, { attempts: number; retryAt: number; message: string }>()
  private wanted: ColonyRegion[] = []
  private disposed = false
  private generation = 0
  private options: Required<Pick<Options, 'maxEntries' | 'maxBytes' | 'maxNumbers' | 'maxDrawIndices' | 'concurrency' | 'retryDelay' | 'now'>> & Options
  readonly stats = { entries: 0, pending: 0, bytes: 0, numbers: 0, drawIndices: 0, peakEntries: 0, peakBytes: 0, ready: false, failed: [] as { id: string; attempts: number; message: string }[] }

  constructor(readonly catalog: ColonyRegions, private radius: number, private palette: Record<string, string>, options: Options = {}) {
    this.options = { maxEntries: 32, maxBytes: 24 * 1024 * 1024, maxNumbers: 4 * 1024 * 1024,
      maxDrawIndices: 1536 * 1024, concurrency: 3, retryDelay: 5000, now: Date.now, ...options }
    if (!Number.isFinite(radius) || radius <= 0) throw Error('Invalid colony radius')
    for (const n of [this.options.maxEntries, this.options.maxBytes, this.options.maxNumbers, this.options.maxDrawIndices, this.options.concurrency]) {
      if (!Number.isInteger(n) || n <= 0) throw Error('Invalid colony regional budget')
    }
  }

  request(foci: readonly ColonyFocus[]) {
    if (this.disposed) return false
    if (foci.some(f => ![f.azimuth, f.axial, f.distance].every(Number.isFinite) || f.distance < 0)) throw Error('Invalid colony regional focus')
    const candidates = this.catalog.regions.map(region => ({ region,
      distance: Math.min(...foci.map(f => colonyRegionDistance(region, this.radius, f) - f.distance)) }))
    const wanted = candidates.filter(c => c.distance <= 0).sort((a, b) => a.distance - b.distance).map(c => c.region)
    if (wanted.length > this.options.maxEntries || wanted.reduce((n, r) => n + r.bytes, 0) > this.options.maxBytes) throw Error('Colony arrival exceeds regional budget')
    this.wanted = wanted
    const ids = new Set(this.wanted.map(r => r.id))
    for (const [id, controller] of this.pending) if (!ids.has(id)) controller.abort()
    for (const [id, entry] of this.loaded) if (!ids.has(id)) this.evict(entry)
    // Failure records cannot grow with an entire tour of the colony.
    for (const id of this.failed.keys()) if (!ids.has(id)) this.failed.delete(id)
    this.pump(); this.refresh()
    return this.stats.ready
  }

  readyAt(focus: ColonyFocus) {
    return !this.disposed && this.catalog.regions.every(r => colonyRegionDistance(r, this.radius, focus) > focus.distance || this.loaded.has(r.id))
  }

  get(id: string): RegionalMesh {
    const entry = this.loaded.get(id)
    if (!entry) throw Error('Colony region is not ready: ' + id)
    return entry.packed
  }

  private pump() {
    if (this.disposed) return
    for (const region of this.wanted) {
      if (this.pending.size >= this.options.concurrency) break
      const failure = this.failed.get(region.id)
      if (this.loaded.has(region.id) || this.pending.has(region.id) || (failure && (failure.attempts >= 3 || failure.retryAt > this.options.now()))) continue
      const controller = new AbortController(), generation = this.generation
      this.pending.set(region.id, controller)
      // The document reader performs byte count and SHA-256 verification before
      // publishing JSON. One region consumes one store concurrency slot.
      const document = { storage: COLONY_DOCUMENT_FORMAT, sourceSha256: this.catalog.sourceSha256, parts: 1,
        partBytes: region.bytes, data: { packed: { $part: region.url, bytes: region.bytes } } }
      void readColonyDocument(document, { load: this.options.load, signal: controller.signal }).then(value => {
        if (generation !== this.generation || controller.signal.aborted || !this.wanted.some(r => r.id === region.id)) return
        const entry = validateMesh((value as { packed: unknown }).packed, region, this.palette)
        if (this.stats.numbers + entry.numbers > this.options.maxNumbers || this.stats.drawIndices + entry.drawIndices > this.options.maxDrawIndices) throw Error('Colony geometry exceeds resident budget')
        // Render geometry is prepared before readiness changes. A failure keeps
        // its far ground visible and makes the whole arrival remain unready.
        this.options.onLoad?.(region, entry.packed)
        this.loaded.set(region.id, entry); this.failed.delete(region.id); this.refresh()
      }).catch(error => {
        if (generation !== this.generation || controller.signal.aborted) return
        this.failed.set(region.id, { attempts: (failure?.attempts ?? 0) + 1,
          retryAt: this.options.now() + this.options.retryDelay, message: String(error) })
      }).finally(() => {
        if (generation !== this.generation) return
        this.pending.delete(region.id); this.refresh(); this.pump()
      })
    }
    this.refresh()
  }

  private evict(entry: Entry) {
    this.options.onEvict?.(entry.region)
    this.loaded.delete(entry.region.id)
    this.refresh()
  }

  private refresh() {
    this.stats.entries = this.loaded.size; this.stats.pending = this.pending.size
    this.stats.bytes = this.stats.numbers = this.stats.drawIndices = 0
    for (const entry of this.loaded.values()) {
      this.stats.bytes += entry.region.bytes; this.stats.numbers += entry.numbers; this.stats.drawIndices += entry.drawIndices
    }
    this.stats.peakEntries = Math.max(this.stats.peakEntries, this.stats.entries)
    this.stats.peakBytes = Math.max(this.stats.peakBytes, this.stats.bytes)
    this.stats.ready = !this.disposed && this.wanted.every(r => this.loaded.has(r.id))
    this.stats.failed = [...this.failed].map(([id, failure]) => ({ id, attempts: failure.attempts, message: failure.message }))
  }

  dispose() {
    this.disposed = true; this.generation++
    for (const controller of this.pending.values()) controller.abort()
    this.pending.clear()
    for (const entry of [...this.loaded.values()]) this.evict(entry)
    this.failed.clear(); this.wanted = []; this.refresh()
  }
}
