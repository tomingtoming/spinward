import type { CityBuilding } from '../objects/cityLayout'
import type { ColonyPackedMesh } from './authoredColony'
import { citySurfaceRegions } from '../objects/citySurfaceMesh'
import type { ColonyRegion, RegionalMesh } from './colonyRegionStore'

export const COLONY_COLLISION_CACHE_ENTRIES = 128
export const COLONY_COLLISION_CACHE_BYTES = 4 * 1024 * 1024

/** Keep the global height-query index, but expand only recently used surfaces.
 * Stable descriptors let Rapier retain its local bodies. Evicting an expanded
 * mesh also allows its WeakMap projected-ray cache to be collected. */
export class ColonyCollisionCache {
  private entries = new Map<object, Float64Array>()
  readonly stats = { entries: 0, bytes: 0, peakEntries: 0, peakBytes: 0, hits: 0, misses: 0 }

  constructor(private maxEntries = COLONY_COLLISION_CACHE_ENTRIES,
    private maxBytes = COLONY_COLLISION_CACHE_BYTES) {
    if (!Number.isInteger(maxEntries) || maxEntries < 1 || !Number.isInteger(maxBytes) || maxBytes < 1) throw Error('Invalid colony collision cache budget')
  }

  colliders(packed: ColonyPackedMesh, radius: number): CityBuilding[] {
    const { vertices } = packed
    if (vertices.length % 3 || !vertices.every(Number.isFinite)) throw Error('Invalid colony collision vertices')
    return packed.surfaces.map(({ indices, bounds, groundSurface }) => {
      if (!indices.length || indices.length % 3 || bounds.length !== 4 || !bounds.every(Number.isFinite)
        || bounds[0] > bounds[2] || bounds[1] > bounds[3]) throw Error('Invalid colony collision surface')
      if (indices.length * 3 * 8 > this.maxBytes) throw Error('Colony collision surface exceeds cache byte budget')
      let height = 0
      for (const i of indices) {
        if (!Number.isInteger(i) || i < 0 || i * 3 + 2 >= vertices.length) throw Error('Colony collision index out of bounds')
        height = Math.max(height, vertices[i * 3 + 2])
      }
      const x = (bounds[0] + bounds[2]) / 2, y = (bounds[1] + bounds[3]) / 2, cache = this, regionKey = {}
      return { azimuth: x / radius, axial: y, width: bounds[2] - bounds[0], depth: bounds[3] - bounds[1],
        height, groundSurface: groundSurface !== false, collisionMargin: 0, groundMargin: 0, kind: 'block', tone: .5,
        get collisionRegions() { return cache.cached(regionKey, () => citySurfaceRegions(vertices, indices, x, y)) },
        get surfaceMesh() { return cache.read(vertices, indices, x, y) } }
    })
  }

  regionalColliders(regions: readonly ColonyRegion[], radius: number, read: (id: string) => RegionalMesh): CityBuilding[] {
    return regions.flatMap(region => region.surfaces.map((descriptor, index) => {
      const { bounds, height, groundSurface } = descriptor
      const x = (bounds[0] + bounds[2]) / 2, y = (bounds[1] + bounds[3]) / 2, cache = this, regionKey = {}
      // Descriptors survive eviction, so Rapier's identity map is stable. Read
      // readiness before even a cache hit: stale expansion cannot mask an
      // unavailable source region or turn it into a missing floor.
      return { azimuth: x / radius, axial: y, width: bounds[2] - bounds[0], depth: bounds[3] - bounds[1],
        height, groundSurface: groundSurface !== false, collisionMargin: 0, groundMargin: 0, kind: 'block' as const, tone: .5,
        get collisionRegions() {
          const packed = read(region.id), surface = packed.surfaces[index]
          return cache.cached(regionKey, () => citySurfaceRegions(packed.vertices, surface.indices, x, y))
        },
        get surfaceMesh() {
          const packed = read(region.id), surface = packed.surfaces[index]
          return cache.read(packed.vertices, surface.indices, x, y, descriptor)
        } }
    }))
  }

  private read(vertices: readonly number[], indices: readonly number[], x: number, y: number, key: object = indices) {
    return this.cached(key, () => {
      const mesh = new Float64Array(indices.length * 3)
      for (let i = 0; i < indices.length; i++) {
        const v = indices[i] * 3
        mesh[i * 3] = vertices[v] - x; mesh[i * 3 + 1] = vertices[v + 1] - y; mesh[i * 3 + 2] = vertices[v + 2]
      }
      return mesh
    })
  }

  private cached(key: object, create: () => Float64Array) {
    let mesh = this.entries.get(key)
    if (mesh) {
      this.stats.hits++
      this.entries.delete(key); this.entries.set(key, mesh)
      return mesh
    }
    this.stats.misses++
    mesh = create()
    const bytes = mesh.byteLength
    if (bytes > this.maxBytes) throw Error('Colony collision data exceeds cache byte budget')
    while (this.entries.size >= this.maxEntries || this.stats.bytes + bytes > this.maxBytes) {
      const oldest = this.entries.keys().next().value!
      this.stats.bytes -= this.entries.get(oldest)!.byteLength
      this.entries.delete(oldest)
    }
    this.entries.set(key, mesh); this.stats.bytes += mesh.byteLength
    this.stats.entries = this.entries.size
    this.stats.peakEntries = Math.max(this.stats.peakEntries, this.stats.entries)
    this.stats.peakBytes = Math.max(this.stats.peakBytes, this.stats.bytes)
    return mesh
  }

  clear() {
    this.entries.clear()
    Object.assign(this.stats, { entries: 0, bytes: 0, peakEntries: 0, peakBytes: 0, hits: 0, misses: 0 })
  }
}
