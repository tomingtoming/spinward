import { expect, test } from 'bun:test'
import * as THREE from 'three'
import { HABITAT_PRESETS } from '../presets/presets'
import { planCity, resolveCitySurfaceCollision, type CityPlan } from './cityLayout'
import { planPublicPark, parkPathTiles, PARK_PATH_HEIGHT } from './publicPark'
import { CivicDetails } from './civicDetails'
import { PlayerFootSurface } from './playerFootSurface'

const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a))
const empty: CityPlan = { roads: [], patches: [], buildings: [], trees: [], intersections: [], tower: null, expressway: null }

test('a park requires an existing green parcel and adjacent road, not a vacant arbitrary position', () => {
  expect(planPublicPark(empty, 3200)).toBeNull()
  const patch = { azimuth: 0, axial: 0, tangentExtent: 100, axialExtent: 100, kind: 'park' as const }
  expect(planPublicPark({ ...empty, patches: [patch] }, 3200)).toBeNull()
  expect(planPublicPark({ ...empty, patches: [patch], roads: [{ azimuth: 0, axial: -55, tangentWidth: 100, axialLength: 6, kind: 'local' }] }, 18)).toBeNull()
})

test('park path union has no duplicate coplanar coverage at corners, connector and seats', () => {
  const paths = [{ x: 0, y: 0, width: 4, depth: 2 }, { x: 1, y: 1, width: 2, depth: 4 }]
  const tiles = parkPathTiles(paths)
  expect(tiles.reduce((area, r) => area + r.width * r.depth, 0)).toBeCloseTo(12)
  for (let i = 0; i < tiles.length; i++) for (let j = i + 1; j < tiles.length; j++) {
    const a = tiles[i], b = tiles[j]
    expect(Math.abs(a.x - b.x) >= (a.width + b.width) / 2 - 1e-9 || Math.abs(a.y - b.y) >= (a.depth + b.depth) / 2 - 1e-9).toBe(true)
  }
})

test('inhabited presets retain a connected, clear garden across city budgets without changing the city plan', () => {
  for (const preset of HABITAT_PRESETS) for (const maxBuildings of [64000, 18000, 16000]) {
    const radius = preset.real.radius_m
    const plan = planCity({ radius, length: preset.real.length_m ?? preset.real.thickness_m!, maxBuildings, topology: preset.topology })
    const before = JSON.stringify(plan)
    const park = planPublicPark(plan, radius)
    expect(JSON.stringify(plan)).toBe(before)
    if (preset.id === 'playground') { expect(park).toBeNull(); continue }
    expect(park).not.toBeNull()
    if (!park) continue
    expect(park.trees.length).toBeGreaterThanOrEqual(6)
    expect(park.benches).toHaveLength(2)
    expect(park.lamps).toHaveLength(3)
    for (const lamp of park.lamps) for (const path of park.paths) expect(
      Math.abs(lamp.x - path.x) > path.width / 2 + .79 || Math.abs(lamp.y - path.y) > path.depth / 2 + .79
    ).toBe(true)
    const road = plan.roads[park.roadIndex]
    const entry = { azimuth: park.azimuth + park.entrance.x / radius, axial: park.axial + park.entrance.y }
    const dx = Math.max(0, Math.abs(wrap(entry.azimuth - road.azimuth)) * radius - road.tangentWidth / 2)
    const dy = Math.max(0, Math.abs(entry.axial - road.axial) - road.axialLength / 2)
    expect(Math.hypot(dx, dy)).toBeLessThanOrEqual(14.01)
    for (const path of park.paths) {
      expect(Math.abs(wrap(park.azimuth - park.patch.azimuth) * radius + path.x) + path.width / 2).toBeLessThanOrEqual(park.patch.tangentExtent / 2 + .001)
      expect(Math.abs(park.axial - park.patch.axial + path.y) + path.depth / 2).toBeLessThanOrEqual(park.patch.axialExtent / 2 + .001)
      for (const b of plan.buildings) expect(
        Math.abs(wrap(b.azimuth - park.azimuth) * radius - path.x) >= (b.width + path.width) / 2 + .59 ||
        Math.abs(b.axial - park.axial - path.y) >= (b.depth + path.depth) / 2 + .59
      ).toBe(true)
      for (const t of [...plan.trees, ...park.trees]) expect(
        Math.abs(wrap(t.azimuth - park.azimuth) * radius - path.x) > path.width / 2 + .7 ||
        Math.abs(t.axial - park.axial - path.y) > path.depth / 2 + .7
      ).toBe(true)
    }
    // Every path strip belongs to the same touching/overlapping component.
    const visited = new Set([0])
    for (let pass = 0; pass < park.paths.length; pass++) for (const [i, a] of park.paths.entries()) {
      if ([...visited].some(j => { const b = park.paths[j]; return Math.abs(a.x - b.x) <= (a.width + b.width) / 2 + .001 && Math.abs(a.y - b.y) <= (a.depth + b.depth) / 2 + .001 })) visited.add(i)
    }
    expect(visited.size).toBe(park.paths.length)
  }
})

test('park benches match rendered seat height and return feet to clear garden paving', () => {
  for (const preset of HABITAT_PRESETS.filter(p => p.id !== 'playground')) {
    const radius = preset.real.radius_m
    const plan = planCity({ radius, length: preset.real.length_m ?? preset.real.thickness_m!, maxBuildings: 12000, topology: preset.topology })
    const park = planPublicPark(plan, radius)!, details = new CivicDetails(new THREE.Group()), feet = new PlayerFootSurface()
    try {
      details.rebuild({ ...plan, buildings: [] }, radius, park)
      details.group.updateMatrixWorld(true)
      feet.setPlan(plan, [], radius, park)
      expect(details.group.children.length).toBeLessThanOrEqual(6)
      expect(details.lamps).toHaveLength(3)
      for (const lamp of details.lamps) {
        expect(Math.abs(radius - Math.hypot(lamp.position.x, lamp.position.z) - 3.56)).toBeLessThan(.001)
        expect(lamp.down.dot(lamp.position.clone().setY(0).normalize())).toBeCloseTo(1)
        const post = details.colliders.find(b => Math.abs(wrap(b.azimuth - Math.atan2(lamp.position.z, lamp.position.x))) < 1e-8 && Math.abs(b.axial - lamp.position.y) < .001)
        expect(post?.height).toBeGreaterThan(3.4)
      }
      const seats = details.seats.filter(s => s.id.startsWith('park-'))
      expect(seats).toHaveLength(2)
      for (const seat of seats) {
        const radial = new THREE.Vector3(Math.cos(seat.azimuth), 0, Math.sin(seat.azimuth))
        const above = radial.clone().multiplyScalar(radius - 1).setY(seat.axialPosition - .18)
        const hit = new THREE.Raycaster(above, radial, 0, 1).intersectObject(details.group, true)[0]
        expect(hit).toBeDefined()
        expect(Math.abs(radius - Math.hypot(hit.point.x, hit.point.z) - seat.seatHeight!)).toBeLessThan(.003)
        expect(resolveCitySurfaceCollision({ ...seat.exit }, details.colliders, radius)).toBe(false)
        expect(feet.sample(seat.exit.azimuth, seat.exit.axialPosition, 0, false)).toBeCloseTo(PARK_PATH_HEIGHT)
      }
      details.rebuild(empty, 18)
      expect(details.park).toBeNull()
      expect(details.seats).toHaveLength(0)
    } finally { details.dispose() }
  }
})
