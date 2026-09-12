import { expect, test } from 'bun:test'
import * as THREE from 'three'
import { planCity, getCityGroundHeight, resolveCitySurfaceCollision } from './cityLayout'
import { planSidewalkSegments } from './sidewalks'
import { CivicDetails } from './civicDetails'
import { PlayerFootSurface } from './playerFootSurface'
import { planPublicUnderpass, UNDERPASS_HEIGHT } from './publicUnderpass'

const R = 3200, wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a))

test('covered links join actual sidewalks, remain clear and preserve the city across three budgets', () => {
  for (const maxBuildings of [64000, 18000, 16000]) {
    const city = planCity({ radius: R, length: 40000, maxBuildings }), before = JSON.stringify(city)
    const p = planPublicUnderpass(city, R)!
    expect(p).not.toBeNull()
    expect(JSON.stringify(city)).toBe(before)
    expect(planPublicUnderpass(city, R)).toEqual(p)
    for (let i = 0; i < p.paths.length; i++) for (let j = i + 1; j < p.paths.length; j++) {
      const a = p.paths[i], b = p.paths[j]
      expect(Math.abs(a.x - b.x) >= (a.width + b.width) / 2 - 1e-6 ||
        Math.abs(a.y - b.y) >= (a.depth + b.depth) / 2 - 1e-6).toBe(true)
    }
    const sidewalks = planSidewalkSegments(city.roads, city.intersections, R, 3, () => false)
    for (const sign of [-1, 1]) {
      const a = p.azimuth + sign * p.length / (2 * R)
      for (const y of [-1.3, 0, 1.3]) expect(sidewalks.some(s =>
        Math.abs(wrap(a - s.azimuth)) * R <= s.tangentExtent / 2 + 1e-6 &&
        Math.abs(p.axial + y - s.axial) <= s.axialExtent / 2 + 1e-6)).toBe(true)
    }
    for (const tile of p.paths) {
      expect(Math.abs(p.axial + tile.y - city.expressway!.axial) + tile.depth / 2).toBeLessThan(city.expressway!.deckWidth / 2)
      expect(Math.abs(p.axial + tile.y - city.expressway!.axial) - tile.depth / 2).toBeGreaterThan(1.7 + .5)
      for (const road of city.roads) expect(Math.abs(wrap(road.azimuth - p.azimuth) * R - tile.x) >= (road.tangentWidth + tile.width) / 2 - 1e-6 ||
        Math.abs(road.axial - p.axial - tile.y) >= (road.axialLength + tile.depth) / 2 - 1e-6).toBe(true)
    }
  }
})

test('unsupported, disconnected and occupied underpasses are omitted', () => {
  const city = planCity({ radius: R, length: 40000 }), p = planPublicUnderpass(city, R)!
  const local = { ...city, roads: p.roads }
  expect(planPublicUnderpass({ ...local, expressway: null }, R)).toBeNull()
  expect(planPublicUnderpass(local, 18)).toBeNull()
  expect(planPublicUnderpass({ ...local, roads: [p.roads[0]] }, R)).toBeNull()
  const blocker = { azimuth: p.azimuth, axial: p.axial, width: 2, depth: 2, height: 8, tone: .5, kind: 'block' as const }
  expect(planPublicUnderpass({ ...local, buildings: [blocker] }, R)).toBeNull()
  expect(planPublicUnderpass({ ...local, trees: [{ ...blocker, height: 4 }] }, R)).toBeNull()
  expect(planPublicUnderpass({ ...local, roads: [...p.roads, { azimuth: p.azimuth, axial: p.axial, tangentWidth: 5, axialLength: 30, kind: 'alley' }] }, R)).toBeNull()
})

test('rendered paving, rails, seated exits and lamp supports share physical placement within a fixed budget', () => {
  const city = planCity({ radius: R, length: 40000, maxBuildings: 64000 }), p = planPublicUnderpass(city, R)!
  const details = new CivicDetails(new THREE.Group()), feet = new PlayerFootSurface()
  try {
    details.rebuild({ ...city, buildings: [] }, R, null, p)
    details.group.updateMatrixWorld(true)
    expect(details.group.userData.underpassTriangles).toBeLessThanOrEqual(4096)
    expect(details.group.children.filter(o => o instanceof THREE.Mesh).length).toBeLessThanOrEqual(6)
    feet.setPlan(city, [], R)
    const rayHeight = (a: number, ax: number, above = .8) => {
      const radial = new THREE.Vector3(Math.cos(a), 0, Math.sin(a))
      const origin = radial.clone().multiplyScalar(R - above).setY(ax)
      const hit = new THREE.Raycaster(origin, radial, 0, above).intersectObject(details.group, true)[0]
      expect(hit).toBeDefined()
      return R - Math.hypot(hit.point.x, hit.point.z)
    }
    // Sample the full open corridor, including both mouths; simulate the body
    // envelope and feet instead of only checking the decorative centre line.
    for (let x = -p.length / 2 + .2; x < p.length / 2; x += .71) for (const y of [-.8, 0, .8]) {
      const azimuth = p.azimuth + x / R, axialPosition = p.axial + y
      const height = getCityGroundHeight(details.colliders, R, azimuth, axialPosition, UNDERPASS_HEIGHT)
      expect(height).toBeCloseTo(UNDERPASS_HEIGHT)
      expect(feet.sample(azimuth, axialPosition, height, false)).toBeCloseTo(UNDERPASS_HEIGHT)
      expect(resolveCitySurfaceCollision({ azimuth, axialPosition }, details.colliders, R, .4, height)).toBe(false)
    }
    for (const x of [-30.14, -9.19, 9.27, 30.31]) expect(rayHeight(p.azimuth + x / R, p.axial)).toBeCloseTo(UNDERPASS_HEIGHT, 2)
    const railPosition = { azimuth: p.azimuth, axialPosition: p.axial + p.rail.y }
    expect(resolveCitySurfaceCollision(railPosition, details.colliders, R, .4, UNDERPASS_HEIGHT)).toBe(true)
    const seats = details.seats.filter(s => s.id.startsWith('underpass-'))
    expect(seats).toHaveLength(2)
    for (const seat of seats) {
      expect(rayHeight(seat.azimuth, seat.axialPosition - .18, 1.1)).toBeCloseTo(seat.seatHeight!, 2)
      expect(resolveCitySurfaceCollision({ ...seat.exit }, details.colliders, R, .4, UNDERPASS_HEIGHT)).toBe(false)
      expect(getCityGroundHeight(details.colliders, R, seat.exit.azimuth, seat.exit.axialPosition, UNDERPASS_HEIGHT)).toBeCloseTo(UNDERPASS_HEIGHT)
    }
    expect(details.lamps).toHaveLength(4)
    for (const l of p.lamps) {
      const a = p.azimuth + l.x / R, ax = p.axial + l.y
      expect(getCityGroundHeight(details.colliders, R, a, ax, UNDERPASS_HEIGHT)).toBeGreaterThanOrEqual(UNDERPASS_HEIGHT)
      expect(rayHeight(a, ax + .16)).toBeCloseTo(UNDERPASS_HEIGHT, 2)
    }
    details.rebuild({ ...city, expressway: null }, 18)
    expect(details.underpass).toBeNull()
    expect(details.lamps).toHaveLength(0)
  } finally { details.dispose() }
})
