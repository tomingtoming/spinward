import { expect, test } from 'bun:test'
import * as THREE from 'three'
import raw from '../../qa/neighborhood-life/colony-source'
import studyRaw from './generated/worldLandscapes.json'
import { unpackLandscapeLibrary } from './landscapeData'
import { landscapeColliders } from './authoredLandscape'
import { AuthoredColony, colonyTileDistance, decodeColonyMesh, readColonyManifest, COLONY_TILE_CACHE, COLONY_LOAD_CONCURRENCY, type ColonyManifest, type ColonyPackedMesh } from './authoredColony'
import { buildCityCollisionIndex, collectCityBuildingsInWindow, getCityGroundHeight } from '../objects/cityLayout'

const manifest = readColonyManifest(raw)
const tick = () => new Promise(resolve => setTimeout(resolve, 0))
const small: ColonyPackedMesh = { vertices: [-10, -10, 2, 10, -10, 2, 10, 10, 2], meshes: { earth: [0, 1, 2] }, surfaces: [] }
const fixture = (count = 1): ColonyManifest => ({ version: 1, radius: 3200, span: 40000, palette: { earth: '#778866', housing: '#ccccbb' }, base: small,
  visits: {}, tiles: Array.from({ length: count }, (_, i) => ({ id: `tile-${i}`, url: `/tile-${i}`, band: 0, districts: ['test'],
    bounds: [-20, i * 300 - 20, 20, i * 300 + 20], boxes: [[0, i * 300, 2, 10, 10, 10, 0, 'housing']] })) })

test('native frontage pavement is drawn and physically supports the same height on each band', () => {
  for (let band = 0; band < 3; band++) {
    const f = fixture(0), x = band * Math.PI * 2 * 3200 / 3
    const fixed: ColonyPackedMesh = { vertices: [x-2,-2,3,x+2,-2,3,x+2,2,3],
      meshes: { earth: [0,1,2] }, surfaces: [{ indices: [0,1,2], bounds: [x-2,-2,x+2,2] }] }
    f.streetFrontages = { version: 1, fixed,
      counts: { streets: 1, districts: 1, fixedTriangles: 1, collisionTriangles: 1, surfaceGroups: 1 } }
    const layer = new AuthoredColony(new THREE.Group(), async () => small)
    layer.rebuild(f); layer.group.updateMatrixWorld(true)
    const a = (x+.5)/3200, out = new THREE.Vector3(Math.cos(a),0,Math.sin(a)), origin = out.clone().multiplyScalar(2800)
    const hits = new THREE.Raycaster(origin,out,0,600).intersectObject(layer.group.getObjectByName('colony-street-frontages')!,true)
    expect(hits.length).toBeGreaterThan(0)
    const height = 3200-Math.hypot(hits[0].point.x,hits[0].point.z)
    const index = buildCityCollisionIndex(layer.getColliders(),3200,40000)
    expect(Math.abs(getCityGroundHeight(index,3200,a,0,3)-height)).toBeLessThan(.001)
    expect(layer.group.userData.pavedUrbanStreets).toBe(1)
    layer.rebuild(fixture(0))
    expect(layer.group.getObjectByName('colony-street-frontages')).toBeUndefined()
    expect(layer.getColliders()).toHaveLength(0)
    layer.dispose()
  }
})

test('saved urban pavement has matching native floor support across the three inhabited strips', () => {
  const packed = manifest.streetFrontages!.fixed, ids = packed.meshes['frontage-paving']
  const layer = new AuthoredColony(new THREE.Group(), async () => small)
  layer.rebuild({ ...fixture(0), base: { vertices: [], meshes: {}, surfaces: [] },
    palette: manifest.palette, streetFrontages: manifest.streetFrontages })
  layer.group.updateMatrixWorld(true)
  const index = buildCityCollisionIndex(layer.getColliders(),3200,40000), bands = new Set<number>()
  let probes = 0
  for (let i = 0; i < ids.length; i += Math.max(3,Math.floor(ids.length/20/3)*3)) {
    // Clipping produces millimetre-wide boundary slivers. Place the walking
    // probe inside a usable floor triangle, clear of float32 edge rounding.
    let selected = i
    for (; selected < ids.length; selected += 3) {
      const points = ids.slice(selected,selected+3).map(id=>packed.vertices.slice(id*3,id*3+2))
      const [a,b,c] = points, twiceArea = Math.abs((b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]))
      if (points.every((p,j)=>twiceArea/(3*Math.hypot(p[0]-points[(j+1)%3][0],p[1]-points[(j+1)%3][1]))>.05)) break
    }
    if (selected >= ids.length) continue
    const centre = new THREE.Vector3()
    for (const id of ids.slice(selected,selected+3)) {
      const [x,y,h] = packed.vertices.slice(id*3,id*3+3), a = x/3200
      centre.add(new THREE.Vector3(Math.cos(a)*(3200-h),y,Math.sin(a)*(3200-h)).multiplyScalar(1/3))
      bands.add(Math.round(x/(Math.PI*6400/3)))
    }
    const a = Math.atan2(centre.z,centre.x), h = 3200-Math.hypot(centre.x,centre.z)
    const outward = new THREE.Vector3(Math.cos(a),0,Math.sin(a)), origin = centre.clone().addScaledVector(outward,-.3)
    const hits = new THREE.Raycaster(origin,outward,0,.6).intersectObject(layer.group,true)
    expect(hits.length).toBeGreaterThan(0)
    expect(Math.abs(3200-Math.hypot(hits[0].point.x,hits[0].point.z)-h)).toBeLessThan(.01)
    expect(Math.abs(getCityGroundHeight(index,3200,a,centre.y,h)-h)).toBeLessThan(.01)
    probes++
  }
  expect(bands.size).toBe(3); expect(probes).toBeGreaterThanOrEqual(20)
  layer.dispose()
})

test('whole-colony floor drawing and collision agree across all bands and the preserved study boundary', () => {
  const layer = new AuthoredColony(new THREE.Group(), async () => small)
  layer.rebuild(manifest); layer.group.updateMatrixWorld(true)
  const study = unpackLandscapeLibrary(studyRaw).izma
  const buildings = [...landscapeColliders(study, 3200), ...layer.getColliders()]
  const index = buildCityCollisionIndex(buildings, 3200, 40000)
  const base = layer.group.getObjectByName('colony-base')!
  let probes = 0
  for (let band = 0; band < 3; band++) for (const axial of [-19500, -15500, -8600, 1800, 10500, 17700, 19500]) {
    for (const x of [-1200, 650, 1450]) {
      const a = band * Math.PI * 2 / 3 + x / 3200, out = new THREE.Vector3(Math.cos(a), 0, Math.sin(a))
      const origin = out.clone().multiplyScalar(2800); origin.y = axial
      const hits = new THREE.Raycaster(origin, out, 0, 600).intersectObject(base, true).filter(h => !h.object.name.endsWith('-water') && !h.object.name.endsWith('-rail'))
      expect(hits.length).toBeGreaterThan(0)
      const h = 3200 - Math.hypot(hits[0].point.x, hits[0].point.z)
      const sampled = getCityGroundHeight(index, 3200, a, axial, h)
      expect(Math.abs(sampled - h)).toBeLessThan(.01)
      // The original layers used fewer than 45 descriptors here. Street-edge
      // floors add at most 18 per window (checked over all occupied cells in
      // colonyCollisionCache.test.ts); keep the combined query below 64.
      expect(collectCityBuildingsInWindow(index, a, axial, 1, new Set()).size).toBeLessThan(64)
      probes++
    }
  }
  expect(probes).toBe(63)
  // The old 640x800 footprint must not acquire a second terrain above it.
  for (const [x, y] of [[0, 0], [-200, 180], [120, -80]]) {
    const a = x / 3200, out = new THREE.Vector3(Math.cos(a), 0, Math.sin(a)), origin = out.clone().multiplyScalar(2800)
    origin.y = y
    expect(new THREE.Raycaster(origin, out, 0, 600).intersectObject(base, true).length).toBe(0)
  }
  for (const [x, y] of [[320.01, 0], [-320.01, 180], [130, 400.01], [-150, -400.01]]) {
    expect(getCityGroundHeight(index, 3200, x / 3200, y, 3)).toBeLessThan(.12)
  }
  expect(manifest.visits['b-campus']).toBeDefined(); expect(manifest.visits['c-market']).toBeDefined()
  expect(layer.visit('b-campus', index)?.azimuth).toBeGreaterThan(1.5)
  expect(layer.visit('does-not-exist', index)).toBeNull()
  layer.dispose()
})

test('tile selection wraps the circumference and asynchronous detail stays within both budgets', async () => {
  const tile = fixture().tiles[0]
  expect(colonyTileDistance(tile, 3200, Math.PI * 2 - .001, 0)).toBe(0)
  let active = 0, maxActive = 0
  const layer = new AuthoredColony(new THREE.Group(), async () => {
    active++; maxActive = Math.max(active, maxActive)
    await tick(); active--; return small
  })
  layer.rebuild(fixture(36))
  for (let axial = 0; axial < 10500; axial += 600) {
    layer.update(0, axial, 2)
    for (let i = 0; i < 6; i++) await tick()
    expect(layer.group.userData.loaded).toBeLessThanOrEqual(COLONY_TILE_CACHE)
    expect(layer.group.userData.pending).toBeLessThanOrEqual(COLONY_LOAD_CONCURRENCY)
  }
  expect(maxActive).toBe(COLONY_LOAD_CONCURRENCY)
  expect(layer.group.userData.loaded).toBe(COLONY_TILE_CACHE)
  layer.dispose()
})

test('late results from another world are discarded and failures leave the proxy and floor in place', async () => {
  let finish: (p: ColonyPackedMesh) => void = () => {}
  let signal: AbortSignal | undefined
  const layer = new AuthoredColony(new THREE.Group(), (_url, s) => { signal = s; return new Promise(resolve => { finish = resolve }) })
  layer.rebuild(fixture()); layer.update(0, 0, 2)
  expect(layer.group.userData.pending).toBe(1)
  layer.clear(); expect(signal!.aborted).toBe(true)
  finish(small); await tick()
  expect(layer.group.children.length).toBe(0)
  expect(layer.group.userData).toEqual({})
  layer.dispose()
  let attempts = 0
  const failed = new AuthoredColony(new THREE.Group(), async () => { attempts++; throw Error('offline fixture') })
  failed.rebuild(fixture()); const original = failed.getColliders()
  failed.update(0, 0, 2); await tick()
  for (let i = 0; i < 30; i++) failed.update(0, 0, 2)
  expect(attempts).toBe(1)
  expect(failed.group.userData.failed[0].message).toContain('offline fixture')
  expect(failed.getColliders()).toEqual(original)
  const proxy = failed.group.getObjectByName('colony-proxy-housing') as THREE.InstancedMesh
  const matrix = new THREE.Matrix4(); proxy.getMatrixAt(0, matrix)
  expect(matrix.determinant()).toBeGreaterThan(0)
  failed.dispose()
})

test('invalid streamed geometry fails before allocating render objects', () => {
  expect(() => decodeColonyMesh({ ...small, meshes: { earth: [0, 1, 999] } })).toThrow('out of bounds')
  expect(() => decodeColonyMesh({ ...small, meshes: { earth: [0, 1] } })).toThrow('Incomplete')
  expect(() => decodeColonyMesh({ ...small, vertices: [NaN, 0, 0] })).toThrow('Invalid')
})

test('architecture keeps a roof silhouette while loading and changes facade LOD without a gap', async () => {
  const f = fixture(), tile = f.tiles[0]
  tile.architecture = true; tile.proxyParts = [[0, 0, 12, 10, 10, 3, 0, 'housing', 'gable']]
  const layer = new AuthoredColony(new THREE.Group(), async () => ({ ...small, mid: small }))
  layer.rebuild(f); layer.update(0, 1200, 2)
  const roof = layer.group.getObjectByName('colony-proxy-housing-gable') as THREE.InstancedMesh
  const matrix = new THREE.Matrix4(); roof.getMatrixAt(0, matrix)
  expect(matrix.determinant()).toBeGreaterThan(0)
  await tick()
  const near = layer.group.getObjectByName('colony-tile-tile-0-near')!
  const mid = layer.group.getObjectByName('colony-tile-tile-0-mid')!
  expect(near.visible).toBe(false); expect(mid.visible).toBe(true)
  roof.getMatrixAt(0, matrix); expect(matrix.determinant()).toBe(0)
  layer.update(0, 300, 2)
  expect(near.visible).toBe(false); expect(mid.visible).toBe(true)
  layer.update(0, 100, 2)
  expect(near.visible).toBe(true); expect(mid.visible).toBe(false)
  layer.update(0, 210, 2)
  expect(near.visible).toBe(true) // stay near inside the outward hysteresis band
  layer.update(0, 250, 2)
  expect(near.visible).toBe(false); expect(mid.visible).toBe(true)
  layer.update(0, 190, 2)
  expect(near.visible).toBe(false) // stay middle on the return through the same band
  layer.update(0, 150, 2)
  expect(near.visible).toBe(true)
  layer.update(0, 2800, 2)
  expect(near.parent!.visible).toBe(false)
  roof.getMatrixAt(0, matrix); expect(matrix.determinant()).toBeGreaterThan(0)
  layer.dispose()
})

test('station, public-space and land detail keep their existing range beside close facade LODs', async () => {
  for (const kind of ['railway', 'publicRealm', 'landUse'] as const) {
    const f = fixture(); f.tiles[0].architecture = true; f.tiles[0][kind] = true
    const layer = new AuthoredColony(new THREE.Group(), async () => ({ ...small, mid: small }))
    layer.rebuild(f); layer.update(0, 600, 2); await tick()
    expect(layer.group.getObjectByName('colony-tile-tile-0-near')!.visible).toBe(true)
    layer.update(0, 1200, 2)
    expect(layer.group.getObjectByName('colony-tile-tile-0-mid')!.visible).toBe(true)
    layer.dispose()
  }
})

test('malformed middle detail keeps the roof fallback and creates no partial tile', async () => {
  const f = fixture(); f.tiles[0].architecture = true
  const layer = new AuthoredColony(new THREE.Group(), async () => ({ ...small, mid: { ...small, meshes: { earth: [0, 1, 999] } } }))
  layer.rebuild(f); layer.update(0, 1200, 2); await tick()
  expect(layer.group.userData.failed[0].message).toContain('out of bounds')
  expect(layer.group.getObjectByName('colony-tile-tile-0-near')).toBeUndefined()
  const proxy = layer.group.getObjectByName('colony-proxy-housing') as THREE.InstancedMesh
  const matrix = new THREE.Matrix4(); proxy.getMatrixAt(0, matrix)
  expect(matrix.determinant()).toBeGreaterThan(0)
  layer.dispose()
})
