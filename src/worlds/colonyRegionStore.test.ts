import { test, expect } from 'bun:test'
import * as THREE from 'three'
import { AuthoredColony, type ColonyManifest } from './authoredColony'
import { ColonyRegionStore, colonyRegionDistance, readColonyRegions, type ColonyRegions, type RegionalMesh, type ColonyFocus } from './colonyRegionStore'
import { ColonyCollisionCache } from './colonyCollisionCache'
import { buildCityCollisionIndex, getCityGroundHeight } from '../objects/cityLayout'
import { collideSphereWithBuildings } from '../sim/cityCollision'

const radius = 3200, palette = { earth: '#ffffff' }
const focus = (x = 0, distance = 30): ColonyFocus => ({ azimuth: x / radius, axial: 0, distance })
const tick = async () => { for (let i = 0; i < 8; i++) await new Promise(resolve => setTimeout(resolve, 0)) }

async function fixture(count = 1) {
  const catalog: ColonyRegions = { format: 'colony-regions-v1', sourceSha256: 'a'.repeat(64), cellSize: 512, regions: [], farRanges: {} }
  const buffers = new Map<string, ArrayBuffer>(), packed: RegionalMesh[] = []
  for (let i = 0; i < count; i++) {
    const x = i * 512, bounds: [number, number, number, number] = [x - 20, -20, x + 20, 20]
    const mesh: RegionalMesh = { vertices: [x - 20, -20, 10, x + 20, -20, 10, x + 20, 20, 10, x - 20, 20, 10],
      meshes: { earth: [0, 1, 2, 0, 2, 3] }, surfaces: [{ id: 'base:' + i, bounds, indices: [0, 1, 2, 0, 2, 3] }] }
    const data = new TextEncoder().encode(JSON.stringify(mesh)).buffer
    const sha = new Bun.CryptoHasher('sha256').update(data).digest('hex'), url = `/landscapes/izma/data-${sha}.json`
    buffers.set(url, data); packed.push(mesh)
    catalog.regions.push({ id: 'region-' + i, bounds, maxHeight: 10, url, bytes: data.byteLength,
      surfaces: [{ id: 'base:' + i, bounds, height: 10 }] })
    catalog.farRanges['region-' + i] = { earth: [i * 6, 6] }
  }
  return { catalog, buffers, packed, load: async (url: string) => buffers.get(url)! }
}

test('all requested regions become ready together; unloaded and evicted collision cannot pretend to be empty floor', async () => {
  const f = await fixture(2), store = new ColonyRegionStore(f.catalog, radius, palette, { load: f.load })
  const cache = new ColonyCollisionCache(), colliders = cache.regionalColliders(f.catalog.regions, radius, id => store.get(id))
  const index = buildCityCollisionIndex(colliders, radius, 40000)
  expect(store.request([focus()])).toBe(false)
  expect(() => colliders[0].surfaceMesh).toThrow('not ready')
  await tick()
  expect(store.readyAt(focus())).toBe(true)
  expect(store.readyAt(focus(512))).toBe(false)
  const originalIndex = buildCityCollisionIndex(cache.colliders(f.packed[0], radius), radius, 40000)
  expect(getCityGroundHeight(index, radius, 0, 0, 50)).toBeCloseTo(getCityGroundHeight(originalIndex, radius, 0, 0, 50), 10)
  const expanded = colliders[0].surfaceMesh
  store.request([focus(512)]); await tick()
  expect(store.stats.entries).toBe(1)
  expect(() => colliders[0].surfaceMesh).toThrow('not ready')
  expect(() => colliders[0].collisionRegions).toThrow('not ready')
  store.request([focus()]); await tick()
  expect(colliders[0].surfaceMesh).toBe(expanded)
  expect(store.stats.peakEntries).toBe(1)
  store.dispose()
})

test('request concurrency is bounded; abandoned late results and disposed loads never publish geometry', async () => {
  const f = await fixture(4), callbacks: string[] = [], evicted: string[] = []
  const resolves = new Map<string, () => void>(), signals: AbortSignal[] = []
  const store = new ColonyRegionStore(f.catalog, radius, palette, { concurrency: 2,
    load: (url, signal) => new Promise(resolve => { signals.push(signal); resolves.set(url, () => resolve(f.buffers.get(url)!)) }),
    onLoad: r => { callbacks.push(r.id) }, onEvict: r => { evicted.push(r.id) } })
  store.request([focus(512, 2000)])
  expect(signals.length).toBe(2); expect(store.stats.pending).toBe(2)
  store.request([focus(1536)])
  expect(signals.every(s => s.aborted)).toBe(true)
  for (const resolve of [...resolves.values()]) resolve()
  await tick()
  expect(callbacks).toEqual([]); expect(signals.length).toBe(3)
  resolves.get(f.catalog.regions[3].url)!(); await tick()
  expect(callbacks).toEqual(['region-3']); expect(store.stats.ready).toBe(true)
  store.request([focus()]); store.dispose()
  for (const resolve of resolves.values()) resolve()
  await tick()
  expect(callbacks).toEqual(['region-3']); expect(evicted).toEqual(['region-3'])
  expect(store.stats.entries).toBe(0); expect(store.stats.pending).toBe(0); expect(store.stats.ready).toBe(false)
})

test('truncated or corrupt responses retain the far surface and stop after three attempts', async () => {
  const f = await fixture(), callbacks: string[] = []; let now = 0, calls = 0
  const store = new ColonyRegionStore(f.catalog, radius, palette, { now: () => now,
    load: async url => { calls++; const data = f.buffers.get(url)!.slice(0); new Uint8Array(data)[15] ^= 1; return data },
    onLoad: r => { callbacks.push(r.id) } })
  for (let i = 0; i < 6; i++) { store.request([focus()]); await tick(); now += 5001 }
  expect(calls).toBe(3); expect(callbacks).toEqual([]); expect(store.stats.ready).toBe(false)
  expect(store.stats.failed[0].attempts).toBe(3); expect(store.stats.failed[0].message).toContain('Corrupt colony data')
  expect(() => store.get('region-0')).toThrow('not ready')
  store.dispose()
})

test('oversized arrival and resident geometry are rejected before rendering or readiness', async () => {
  const f = await fixture(2); let published = 0, requests = 0
  const store = new ColonyRegionStore(f.catalog, radius, palette, { maxEntries: 1, maxNumbers: 4,
    load: async url => { requests++; return f.load(url) }, onLoad: () => { published++ } })
  expect(() => store.request([focus(0, 1000)])).toThrow('arrival exceeds')
  expect(requests).toBe(0)
  store.request([focus()]); await tick()
  expect(published).toBe(0); expect(store.stats.ready).toBe(false)
  expect(store.stats.failed[0].message).toContain('resident budget')
  store.dispose()
})

test('rejecting a new oversized arrival cannot make a pending request pump that rejected set later', async () => {
  const f = await fixture(2); let finish!: () => void, requests = 0
  const store = new ColonyRegionStore(f.catalog, radius, palette, { maxEntries: 1,
    load: url => new Promise(resolve => { requests++; finish = () => resolve(f.buffers.get(url)!) }) })
  store.request([focus()])
  expect(() => store.request([focus(0, 1000)])).toThrow('arrival exceeds')
  finish(); await tick()
  expect(requests).toBe(1); expect(store.stats.entries).toBe(1); expect(store.stats.ready).toBe(true)
  expect(store.readyAt(focus(512))).toBe(false)
  store.dispose()
})

test('complete bounds cross ownership cells and the cylinder seam; catalog refuses missing or overlapping far ranges', async () => {
  const f = await fixture(2), far = { vertices: [], meshes: { earth: new Array(12).fill(0) }, surfaces: [] }
  expect(readColonyRegions(f.catalog, palette, far)).toBe(f.catalog)
  const bad = structuredClone(f.catalog); bad.farRanges['region-1'].earth[0] = 3
  expect(() => readColonyRegions(bad, palette, far)).toThrow('Overlapping')
  const missing = structuredClone(f.catalog); delete missing.farRanges['region-1']
  expect(() => readColonyRegions(missing, palette, far)).toThrow('Missing')
  expect(colonyRegionDistance(f.catalog.regions[0], radius, { azimuth: Math.PI * 2 - .001, axial: 0 })).toBe(0)
  const crossing = { bounds: [-25, -1000, 25, 1000] as [number, number, number, number] }
  expect(colonyRegionDistance(crossing, radius, { azimuth: 0, axial: 900 })).toBe(0)
})

test('valid content hashes do not bypass collision completeness and descriptor checks', async () => {
  const f = await fixture(), bad = structuredClone(f.packed[0]); bad.surfaces[0].id = 'unexpected'
  const data = new TextEncoder().encode(JSON.stringify(bad)).buffer
  const url = `/landscapes/izma/data-${new Bun.CryptoHasher('sha256').update(data).digest('hex')}.json`
  f.catalog.regions[0].url = url; f.catalog.regions[0].bytes = data.byteLength
  let published = false
  const store = new ColonyRegionStore(f.catalog, radius, palette, { load: async () => data, onLoad: () => { published = true } })
  store.request([focus()]); await tick()
  expect(published).toBe(false); expect(store.stats.failed[0].message).toContain('descriptor mismatch')
  store.dispose()
})

test('regional rendering replaces only the ready far ranges and restores floor before eviction', async () => {
  const f = await fixture(2), resolves = new Map<string, () => void>()
  const manifest: ColonyManifest = { version: 1, radius, span: 40000, palette, visits: {}, tiles: [], streaming: f.catalog,
    base: { vertices: f.packed.flatMap(p => p.vertices),
      meshes: { earth: f.packed.flatMap((p, i) => p.meshes.earth.map(v => v + i * 4)) }, surfaces: [] } }
  const layer = new AuthoredColony(new THREE.Group(), undefined,
    url => new Promise(resolve => { resolves.set(url, () => resolve(f.buffers.get(url)!)) }))
  layer.rebuild(manifest)
  const originalColliders = layer.getColliders(), far = layer.group.getObjectByName('colony-base-earth') as THREE.Mesh
  const drawnHeight = (x: number) => {
    layer.group.updateMatrixWorld(true)
    const a = x / radius, direction = new THREE.Vector3(Math.cos(a), 0, Math.sin(a))
    const hits = new THREE.Raycaster(direction.clone().multiplyScalar(2800), direction, 0, 600).intersectObject(layer.group, true)
    expect(hits.length).toBeGreaterThan(0)
    return radius - Math.hypot(hits[0].point.x, hits[0].point.z)
  }
  const farHeight = drawnHeight(0)
  expect(layer.prepareRegions([focus()])).toBe(false)
  expect(Array.from(far.geometry.index!.array)).toEqual(Array.from({ length: 12 }, (_, i) => i))
  resolves.get(f.catalog.regions[0].url)!(); await tick()
  expect(layer.regionsReady(focus())).toBe(true)
  expect(Array.from(far.geometry.index!.array).slice(0, 6)).toEqual([0, 0, 0, 0, 0, 0])
  expect(Array.from(far.geometry.index!.array).slice(6)).toEqual([6, 7, 8, 9, 10, 11])
  expect(drawnHeight(0)).toBeCloseTo(farHeight, 6)
  expect(layer.getColliders()).toBe(originalColliders)
  let disposed = 0
  layer.group.getObjectByName('colony-region-region-0')!.traverse(object => {
    if (object instanceof THREE.Mesh) object.geometry.addEventListener('dispose', () => { disposed++ })
  })
  layer.prepareRegions([focus(512)])
  expect(disposed).toBe(1)
  expect(Array.from(far.geometry.index!.array).slice(0, 6)).toEqual([0, 1, 2, 3, 4, 5])
  expect(drawnHeight(0)).toBeCloseTo(farHeight, 6)
  expect(() => originalColliders[0].surfaceMesh).toThrow('not ready')
  layer.clear()
  resolves.get(f.catalog.regions[1].url)!(); await tick()
  expect(layer.group.children).toHaveLength(0)
  expect(layer.getRegionalStatus()).toBeNull()
  expect(manifest.base.meshes.earth).toEqual([0, 1, 2, 0, 2, 3, 4, 5, 6, 4, 6, 7])
  layer.dispose()
})

test('destination listing does not read unloaded floors, while arrival resolution requires them', async () => {
  const f = await fixture(), layer = new AuthoredColony(new THREE.Group(), undefined, f.load)
  const manifest: ColonyManifest = { version: 1, radius, span: 40000, palette,
    visits: { home: { band: 0, position: [0, 0] } }, tiles: [], streaming: f.catalog,
    base: { ...f.packed[0], surfaces: [] } }
  layer.rebuild(manifest)
  const index = buildCityCollisionIndex(layer.getColliders(), radius, 40000)
  expect(layer.visit('home', null)?.axial).toBe(0)
  expect(layer.getRegionalStatus()?.pending).toBe(0)
  expect(() => layer.visit('home', index)).toThrow('not ready')
  layer.prepareRegions([focus()]); await tick()
  const original = buildCityCollisionIndex(new ColonyCollisionCache().colliders(f.packed[0], radius), radius, 40000)
  expect(layer.visit('home', index)?.groundHeight).toBe(getCityGroundHeight(original, radius, 0, 0, 400))
  layer.dispose()
})

test('broad-phase false positives outside regional bounds do not decode an unavailable floor', () => {
  let reads = 0
  const absent = { azimuth: 0, axial: 0, width: 20, depth: 20, height: 10,
    kind: 'block' as const, tone: .5, get surfaceMesh(): number[] { reads++; throw Error('unloaded') } }
  expect(getCityGroundHeight([absent], radius, 0, 100, 20)).toBe(0)
  expect(collideSphereWithBuildings(new THREE.Vector3(radius - 5, 100, 0), new THREE.Vector3(), [absent],
    { habitatRadius: radius, sphereRadius: .18, restitution: .5 })).toBe(false)
  expect(reads).toBe(0)
  expect(() => getCityGroundHeight([absent], radius, 0, 0, 20)).toThrow('unloaded')
})

test('explicit retry recovers a terminal failure without a timer or abandoning the area', async () => {
  const f = await fixture(); let broken = true, now = 0, requests = 0
  const store = new ColonyRegionStore(f.catalog, radius, palette, { now: () => now,
    load: async url => { requests++; if (broken) throw Error('offline'); return f.load(url) } })
  for (let i = 0; i < 3; i++) { store.request([focus()]); await tick(); now += 5001 }
  expect(store.stats.failed[0].attempts).toBe(3)
  broken = false
  store.request([focus()]); await tick(); expect(requests).toBe(3)
  store.retry(); await tick()
  expect(store.readyAt(focus())).toBe(true); expect(requests).toBe(4)
  expect(store.stats.failed).toEqual([])
  store.dispose()
})
