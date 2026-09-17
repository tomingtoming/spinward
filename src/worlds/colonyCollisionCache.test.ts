import { expect, test } from 'bun:test'
import { ColonyCollisionCache, COLONY_COLLISION_CACHE_BYTES, COLONY_COLLISION_CACHE_ENTRIES } from './colonyCollisionCache'
import { colonyColliders, readColonyManifest, type ColonyPackedMesh } from './authoredColony'
import { buildCityCollisionIndex, getCityGroundHeight } from '../objects/cityLayout'
import raw from './generated/izmaColony.json'
import parcels from '../../assets/blender/izma-parcels.json'

const fixture = (): ColonyPackedMesh => ({
  vertices: [0, 0, 2, 10, 0, 2, 0, 10, 2, 20, 0, 4, 30, 0, 4, 20, 10, 4, 40, 0, 6, 50, 0, 6, 40, 10, 6],
  meshes: {}, surfaces: [0, 1, 2].map(n => ({ indices: [n * 3, n * 3 + 1, n * 3 + 2], bounds: [n * 20, 0, n * 20 + 10, 10] }))
})

test('collision descriptors stay cold until queried, with stable local meshes until eviction', () => {
  const cache = new ColonyCollisionCache(2, 144), bodies = cache.colliders(fixture(), 3200)
  const index = buildCityCollisionIndex(bodies, 3200, 40000)
  expect(cache.stats.entries).toBe(0)
  expect(index.all).toBe(bodies)
  const first = bodies[0].surfaceMesh!
  expect([...first]).toEqual([-5, -5, 2, 5, -5, 2, -5, 5, 2])
  expect(bodies[0].surfaceMesh).toBe(first)
  const second = bodies[1].surfaceMesh!
  expect(bodies[0].surfaceMesh).toBe(first) // Touch it: the second is oldest.
  void bodies[2].surfaceMesh
  expect(cache.stats.entries).toBe(2); expect(cache.stats.bytes).toBe(144)
  expect(bodies[1].surfaceMesh).not.toBe(second)
  expect([...bodies[1].surfaceMesh!]).toEqual([...second])
  expect(cache.stats.peakEntries).toBe(2); expect(cache.stats.peakBytes).toBe(144)
})

test('the byte ceiling evicts surfaces even before the entry ceiling, and clear starts a new cache', () => {
  const cache = new ColonyCollisionCache(20, 72), bodies = cache.colliders(fixture(), 3200)
  const first = bodies[0].surfaceMesh!
  for (const body of bodies) void body.surfaceMesh
  expect(cache.stats.entries).toBe(1); expect(cache.stats.peakBytes).toBe(72)
  cache.clear()
  expect(cache.stats).toEqual({ entries: 0, bytes: 0, peakEntries: 0, peakBytes: 0, hits: 0, misses: 0 })
  expect(bodies[0].surfaceMesh).not.toBe(first)
  expect([...bodies[0].surfaceMesh!]).toEqual([...first])
})

test('invalid or individually oversized collision surfaces fail before a walking query', () => {
  const bad = fixture(); bad.surfaces[0].indices[0] = 1000
  expect(() => new ColonyCollisionCache().colliders(bad, 3200)).toThrow('out of bounds')
  expect(() => new ColonyCollisionCache(2, 71).colliders(fixture(), 3200)).toThrow('byte budget')
  const nonfinite = fixture(); nonfinite.vertices[2] = NaN
  expect(() => new ColonyCollisionCache().colliders(nonfinite, 3200)).toThrow('vertices')
})

test('cold and evicted parcel approaches retain the whole-colony support heights', () => {
  const manifest = readColonyManifest(raw), cache = new ColonyCollisionCache()
  const reference = buildCityCollisionIndex(colonyColliders(manifest), 3200, 40000)
  const cached = buildCityCollisionIndex([...cache.colliders(manifest.base, 3200),
    ...cache.colliders(manifest.architecture!.fixed, 3200),
    ...cache.colliders(manifest.publicRealm!.fixed, 3200),
    ...cache.colliders(manifest.neighbourhoods!.fixed, 3200),
    ...reference.all.filter(b => !b.surfaceMesh)], 3200, 40000)
  expect(cached.all.length).toBe(reference.all.length)
  expect(cache.stats.entries).toBe(0)
  // Traverse all three strips, then return in the opposite order. Every old
  // district is well beyond the LRU by the time it is visited again.
  for (const collection of [parcels.parcels, [...parcels.parcels].reverse()]) for (const parcel of collection) {
    for (const t of [.05, .5, .95]) {
      const p = parcel.access.start.map((n, axis) => n + (parcel.access.end[axis] - n) * t)
      const expected = getCityGroundHeight(reference, 3200, p[0] / 3200, p[1], p[2] + .3)
      const actual = getCityGroundHeight(cached, 3200, p[0] / 3200, p[1], p[2] + .3)
      expect(actual, parcel.id).toBe(expected)
      expect(cache.stats.entries).toBeLessThanOrEqual(COLONY_COLLISION_CACHE_ENTRIES)
      expect(cache.stats.bytes).toBeLessThanOrEqual(COLONY_COLLISION_CACHE_BYTES)
    }
  }
  expect(cache.stats.misses).toBeGreaterThan(COLONY_COLLISION_CACHE_ENTRIES * 2)
})
