import { expect, test } from 'bun:test'
import { ColonyCollisionCache, COLONY_COLLISION_CACHE_BYTES, COLONY_COLLISION_CACHE_ENTRIES } from './colonyCollisionCache'
import { colonyColliders, readColonyManifest, type ColonyPackedMesh } from './authoredColony'
import { buildCityCollisionIndex, collectCityBuildingsInWindow, collectCityCollidersNear, getCityGroundHeight } from '../objects/cityLayout'
import raw from '../../qa/neighborhood-life/colony-source'
import parcels from '../../assets/blender/izma-parcels.json'
import landUse from '../../assets/blender/izma-city-land-use.json'

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

test('empty corners are excluded while long triangle edges stay within the same bounded cold cache', () => {
  const packed: ColonyPackedMesh = { vertices: [0,0,2,60,0,2,0,1,2, 0,0,2,1,0,2,0,60,2],
    meshes: {}, surfaces: [{ indices: [0,1,2,3,4,5], bounds: [0,0,60,60] }] }
  const cache = new ColonyCollisionCache(2, 200), bodies = cache.colliders(packed, 3200)
  const index = buildCityCollisionIndex(bodies, 3200, 40000)
  expect(collectCityBuildingsInWindow(index, 55/3200, 55, 1, new Set()).has(bodies[0])).toBe(true)
  expect(collectCityCollidersNear(index, 55/3200, 55, 1, new Set()).has(bodies[0])).toBe(false)
  // Only two bounding rectangles (64 bytes) were expanded, not the 144-byte mesh.
  expect(cache.stats.bytes).toBe(64)
  expect(collectCityCollidersNear(index, 59/3200, 20, 1, new Set()).has(bodies[0])).toBe(true)
  const bounds = bodies[0].collisionRegions!
  void bodies[0].surfaceMesh // Mesh and regions together exceed this tiny cache.
  expect(cache.stats.bytes).toBe(144)
  expect(bodies[0].collisionRegions).not.toBe(bounds)
  expect(cache.stats.peakBytes).toBeLessThanOrEqual(200)
})

test('street-edge floors keep every local collision window bounded without decoding distant meshes', () => {
  const manifest = readColonyManifest(raw), cache = new ColonyCollisionCache()
  const index = buildCityCollisionIndex(cache.colliders(manifest.streetFrontages!.fixed, 3200), 3200, 40000)
  const sites = new Set<number>(), n = index.azimuthCellCount
  // A 3x3 query can intersect pavement only in an occupied cell or its
  // neighbours. Cover all such windows, including the circumference seam.
  for (const key of index.cells.keys()) for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
    sites.add((Math.floor(key / n) + dy) * n + (key % n + dx + n) % n)
  }
  const scratch = new Set<number>()
  let maximum = 0
  for (const key of sites) {
    const a = (key % n + .5) / n * Math.PI * 2
    const y = index.axialMin + (Math.floor(key / n) + .5) * index.axialCellSize
    maximum = Math.max(maximum, collectCityBuildingsInWindow(index, a, y, 1, scratch).size)
  }
  expect(maximum).toBeGreaterThan(0)
  // Cell descriptors are only the broad phase. Dense new frontages put more
  // descriptors in a cell without adding that many bodies near the player.
  expect(cache.stats.entries).toBe(0)
  const nearby = new Set<ReturnType<typeof colonyColliders>[number]>()
  for (const key of sites) {
    const a = (key % n + .5) / n * Math.PI * 2
    const y = index.axialMin + (Math.floor(key / n) + .5) * index.axialCellSize
    collectCityCollidersNear(index, a, y, 1, nearby)
    expect(nearby.size).toBeLessThanOrEqual(32)
    expect([...nearby].reduce((n, body) => n + (body.surfaceMesh?.length ?? 0) / 9, 0)).toBeLessThanOrEqual(4096)
    expect(cache.stats.entries).toBeLessThanOrEqual(COLONY_COLLISION_CACHE_ENTRIES)
    expect(cache.stats.bytes).toBeLessThanOrEqual(COLONY_COLLISION_CACHE_BYTES)
  }
})

test('cold and evicted building and land-use approaches retain the whole-colony support heights', () => {
  const manifest = readColonyManifest(raw), cache = new ColonyCollisionCache()
  const reference = buildCityCollisionIndex(colonyColliders(manifest), 3200, 40000)
  const cached = buildCityCollisionIndex([...cache.colliders(manifest.base, 3200),
    ...cache.colliders(manifest.architecture!.fixed, 3200),
    ...cache.colliders(manifest.publicRealm!.fixed, 3200),
    ...cache.colliders(manifest.neighbourhoods!.fixed, 3200),
    ...cache.colliders(manifest.railways!.fixed, 3200),
    ...cache.colliders(manifest.landUse!.fixed, 3200),
    ...(manifest.streetFrontages ? cache.colliders(manifest.streetFrontages.fixed, 3200) : []),
    ...(manifest.cornerBlocks ? cache.colliders(manifest.cornerBlocks.fixed, 3200) : []),
    ...(manifest.cityBlocks ? cache.colliders(manifest.cityBlocks.fixed, 3200) : []),
    ...(manifest.waterworks ? cache.colliders(manifest.waterworks.fixed, 3200) : []),
    ...(manifest.interband ? cache.colliders(manifest.interband.fixed, 3200) : []),
    ...(manifest.motorway ? cache.colliders(manifest.motorway.fixed, 3200) : []),
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
  const approaches = landUse.zones.filter(zone => zone.access)
  for (const collection of [approaches, [...approaches].reverse()]) for (const zone of collection) {
    for (const p of zone.access!.profile) {
      const expected = getCityGroundHeight(reference, 3200, p[0] / 3200, p[1], p[2] + .3)
      const actual = getCityGroundHeight(cached, 3200, p[0] / 3200, p[1], p[2] + .3)
      expect(actual, zone.id).toBe(expected)
      expect(cache.stats.entries).toBeLessThanOrEqual(COLONY_COLLISION_CACHE_ENTRIES)
      expect(cache.stats.bytes).toBeLessThanOrEqual(COLONY_COLLISION_CACHE_BYTES)
    }
  }
  expect(cache.stats.misses).toBeGreaterThan(COLONY_COLLISION_CACHE_ENTRIES * 2)
})
