import { expect, test } from 'bun:test'
import * as THREE from 'three'
import { compileRoadNetwork, coalesceRoads } from './roadNetwork'
import { planCity, type CityRoad } from './cityLayout'
import { SurfaceIndex } from './streetAccess'
import { fitTrafficCarBody, KENNEY_CAR_VARIANTS } from './buildingAssets'
import { planRoadTilePlacements } from './roadTiles'
import { buildRoadTileSurface } from './roadTileSurface'
import { buildRoadSurfaceGeometry } from './roadSurfaceGeometry'

const overlap = (a: CityRoad, b: CityRoad, r: number) =>
  Math.abs(Math.atan2(Math.sin(a.azimuth - b.azimuth), Math.cos(a.azimuth - b.azimuth))) * r < (a.tangentWidth + b.tangentWidth) / 2 - 1e-5 &&
  Math.abs(a.axial - b.axial) < (a.axialLength + b.axialLength) / 2 - 1e-5
const avenue: CityRoad = { azimuth: 0, axial: 0, tangentWidth: 6, axialLength: 100, kind: 'local' }
const street: CityRoad = { azimuth: 0, axial: 0, tangentWidth: 100, axialLength: 12, kind: 'collector' }

test('crossroads have one shared owner and conserve road union area', () => {
  const network = compileRoadNetwork([avenue, street], 3200)
  expect(network.junctions).toHaveLength(1)
  expect(network.junctions[0].roadIndices.slice().sort()).toEqual([0, 1])
  expect(network.surfaces.reduce((a, s) => a + s.tangentWidth * s.axialLength, 0)).toBeCloseTo(600 + 1200 - 72)
  for (let i = 0; i < network.surfaces.length; i++) for (let j = 0; j < i; j++)
    expect(overlap(network.surfaces[i], network.surfaces[j], 3200)).toBe(false)
  const geometry = buildRoadSurfaceGeometry(network.surfaces, 3200, 16)!
  const positions = geometry.getAttribute('position')
  for (let i = 0; i < positions.count; i++)
    expect(Math.hypot(positions.getX(i), positions.getZ(i))).toBeCloseTo(3199.8, 3)
  expect(Array.from(geometry.getAttribute('uv').array).every(Number.isFinite)).toBe(true)
  geometry.dispose()
})

test('duplicate streets and adjacent through-lane copies do not duplicate intersections', () => {
  const roads = coalesceRoads([avenue, { ...avenue, axial: 80 }, street, { ...street }], 3200)
  expect(roads).toHaveLength(2)
  expect(compileRoadNetwork(roads, 3200).junctions).toHaveLength(1)
})

test('T junctions and cylindrical seams have no overlapping pavement', () => {
  for (const roads of [[{ ...avenue, axial: 50 }, street],
    [{ ...avenue, azimuth: Math.PI - 0.001 }, { ...street, azimuth: -Math.PI + 0.001 }]]) {
    const network = compileRoadNetwork(roads, 3200)
    expect(network.junctions).toHaveLength(1)
    for (let i = 0; i < network.surfaces.length; i++) for (let j = 0; j < i; j++)
      expect(overlap(network.surfaces[i], network.surfaces[j], 3200)).toBe(false)
  }
})

test('entire Izma road surface is disjoint, and nearby junction tiles do not overlap', () => {
  const radius = 3200, plan = planCity({ radius, length: 40000 })
  expect(new Set(plan.roads.map(r => r.kind)).size).toBe(4)
  const surfaces = compileRoadNetwork(plan.roads, radius).surfaces
  const index = new SurfaceIndex(radius)
  let overlaps = 0
  surfaces.forEach((s, i) => {
    for (const j of index.query(s)) if (overlap(s, surfaces[j], radius)) overlaps++
    index.insert(s, i)
  })
  expect(overlaps).toBe(0)
  const tiles = planRoadTilePlacements({ roads: plan.roads, radius, focusAzimuth: 0, focusAxial: 0, rangeMeters: 400 })
  const rects = tiles.map(t => ({ azimuth: t.azimuth, axial: t.axial, kind: 'local' as const,
    tangentWidth: t.quarterTurns % 2 ? t.crossMeters : t.alongMeters,
    axialLength: t.quarterTurns % 2 ? t.alongMeters : t.crossMeters }))
  for (let i = 0; i < rects.length; i++) for (let j = 0; j < i; j++) expect(overlap(rects[i], rects[j], radius)).toBe(false)
})

test('junction base pavement triangles cover the footprint exactly once', () => {
  for (const kind of ['crossroad', 'tee', 'bend'] as const) {
    const g = buildRoadTileSurface({ kind, alongMeters: 25.5, crossMeters: 17,
      alongCarriagewayMeters: 19.5, crossCarriagewayMeters: 12,
      azimuth: 0, axial: 0, quarterTurns: 0, distance: 0 })
    const p = g.getAttribute('position')
    let area = 0
    for (let i = 0; i < p.count; i += 3) {
      if (p.getY(i) > 0.022) continue // Crosswalk paint overlays the pavement.
      area += Math.abs((p.getX(i + 1) - p.getX(i)) * (p.getZ(i + 2) - p.getZ(i)) -
        (p.getX(i + 2) - p.getX(i)) * (p.getZ(i + 1) - p.getZ(i))) / 2
    }
    expect(area).toBeCloseTo(1, 5)
    g.dispose()
  }
})

test('vehicle kits fit explicit real-world envelopes and leave clearance in a 3 m lane', () => {
  for (const car of KENNEY_CAR_VARIANTS) {
    const g = new THREE.BoxGeometry(1, 0.7, 1.7)
    g.translate(3, 2, -4)
    fitTrafficCarBody(g, car)
    const b = g.boundingBox!, size = b.getSize(new THREE.Vector3())
    expect(size.x).toBeCloseTo(car.width, 5)
    expect(size.y).toBeCloseTo(car.height, 5)
    expect(size.z).toBeCloseTo(car.length, 5)
    expect(b.min.y).toBeCloseTo(0, 5)
    expect(size.x * 1.03).toBeLessThan(2.3)
    g.dispose()
  }
})
