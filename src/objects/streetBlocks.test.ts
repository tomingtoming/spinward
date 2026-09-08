import { expect, test } from 'bun:test'
import * as THREE from 'three'
import { planStreetBlock } from './streetBlocks'
import { STREET_PROFILES, FOOTPATH_WIDTH } from './streetProfile'
import { getArterialRoadWidth, getLocalRoadWidth, getCityCellSize, planCity } from './cityLayout'
import { StreetAccessLayer } from './streetAccessLayer'

test('street profiles stay human-sized across habitat scales', () => {
  for (const radius of [18, 800, 3200, 30000]) {
    expect(getArterialRoadWidth(radius)).toBe(radius < 300 ? 6 : 19.5)
    expect(getLocalRoadWidth(radius)).toBe(6)
    expect(getCityCellSize(radius)).toBeLessThanOrEqual(80)
  }
  expect(STREET_PROFILES.arterial.sidewalk).toBe(3)
  expect(STREET_PROFILES.collector.carriageway).toBe(12)
  expect(STREET_PROFILES.local.sidewalk).toBe(2)
  expect(STREET_PROFILES.alley).toMatchObject({ carriageway: 4, sidewalk: 0 })
  expect(FOOTPATH_WIDTH).toBe(2)
})

test('rendered sidewalk bands extend to the specified total road width', () => {
  const radius = 3200
  for (const kind of ['arterial', 'local', 'alley'] as const) {
    const profile = STREET_PROFILES[kind]
    const layer = new StreetAccessLayer(new THREE.Group())
    layer.rebuild({ roads: [{ azimuth: 0, axial: 0, tangentWidth: profile.carriageway,
      axialLength: 100, kind }], buildings: [], intersections: [], patches: [], trees: [],
      tower: null, expressway: null }, radius, 0, 0)
    if (kind === 'alley') {
      expect(layer.group.children).toHaveLength(0)
    } else {
      expect(layer.group.children).toHaveLength(1)
      const geometry = (layer.group.children[0] as THREE.Mesh).geometry
      const positions = geometry.getAttribute('position')
      let outer = 0, inner = Infinity
      for (let i = 0; i < positions.count; i++) {
        const t = Math.abs(Math.atan2(positions.getZ(i), positions.getX(i)) * radius)
        outer = Math.max(outer, t); inner = Math.min(inner, t)
      }
      expect(inner).toBeCloseTo(profile.carriageway / 2, 3)
      expect(outer).toBeCloseTo(profile.carriageway / 2 + profile.sidewalk, 3)
    }
    layer.dispose()
  }
})

for (const residential of [true, false]) {
  test(`roads precede parcels without cutting their footprints (${residential ? 'residential' : 'urban'})`, () => {
    const bounds = { t0: 0, t1: 280, a0: 0, a1: 350 }
    const result = planStreetBlock(bounds, residential, 80)
    expect(result.roads.length).toBeGreaterThan(0)
    for (const road of result.roads) {
      // Each lane independently reaches both opposite perimeter streets;
      // connectivity does not depend on an after-the-fact connector.
      expect((road.t0 < 0 && road.t1 > 280) || (road.a0 < 0 && road.a1 > 350)).toBe(true)
      expect(Math.min(road.t1 - road.t0, road.a1 - road.a0)).toBeCloseTo(residential ? 4 : 6)
    }
    for (const row of result.frontages) {
      const low = Math.min(row.edge, row.edge + row.side * row.depth)
      const high = Math.max(row.edge, row.edge + row.side * row.depth)
      const box = row.facing === 'avenue'
        ? { t0: low, t1: high, a0: row.start, a1: row.end }
        : { t0: row.start, t1: row.end, a0: low, a1: high }
      for (const road of result.roads) {
        const overlap = Math.min(box.t1, road.t1) - Math.max(box.t0, road.t0) > 1e-5 &&
          Math.min(box.a1, road.a1) - Math.max(box.a0, road.a0) > 1e-5
        expect(overlap).toBe(false)
      }
      expect(box.t0).toBeGreaterThanOrEqual(-1e-5)
      expect(box.t1).toBeLessThanOrEqual(280 + 1e-5)
      expect(box.a0).toBeGreaterThanOrEqual(-1e-5)
      expect(box.a1).toBeLessThanOrEqual(350 + 1e-5)
    }
  })
}

test('road-first cities need no building removal to open streets', () => {
  for (const [radius, length] of [[18, 120], [3200, 40000], [30000, 2000]]) {
    for (const seed of [42, 73]) {
      const plan = planCity({ radius, length, seed })
      expect(plan.buildings.length).toBeGreaterThan(0)
      expect(plan.accessRejected).toEqual([])
    }
  }
})

test('dense core fills short frontages and retains substantial ground coverage', () => {
  for (const seed of [42, 73]) {
    const plan = planCity({ radius: 3200, length: 40000, seed })
    const core = plan.buildings.filter(b => Math.abs(b.azimuth) * 3200 < 400 && Math.abs(b.axial) < 400)
    // Same centre-selected 800 m square as the density audit. This is summed
    // footprint area, not a cadastral coverage ratio or a rendered pixel test.
    expect(core.reduce((sum, b) => sum + b.width * b.depth, 0)).toBeGreaterThan(180000)
    expect(core.filter(b => b.front?.axis === 'axial').length).toBeGreaterThan(30)
    const shortFronts = core.filter(b => b.parcel && b.front?.axis === 'axial' &&
      b.parcel.tangentExtent < 49.6)
    expect(shortFronts.length).toBeGreaterThan(10)
    expect(plan.buildings.some(b => b.kind === 'tower')).toBe(false)
    for (const b of plan.buildings.filter(b => b.height > 16)) {
      expect(b.height / Math.min(b.width, b.depth)).toBeLessThanOrEqual((b.kind === 'slab' ? 3 : 2) + 1e-6)
    }
  }
})
