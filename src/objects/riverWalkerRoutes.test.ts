import { expect, test } from 'bun:test'
import * as THREE from 'three'
import { planCity } from './cityLayout'
import { planRiverDistrict, riverCentre } from './riverDistrictPlan'
import { planRiverWalkerRoutes } from './riverWalkerRoutes'
import { sampleStreetWalker, walkerWouldApproach, walkerDistance } from './streetWalkerRoutes'
import { sampleCitySurface } from './citySurfaceMesh'
import { collideSphereWithBuildings } from '../sim/cityCollision'

const radius = 3200
for (const maxBuildings of [16000, 18000, 64000]) test(`river residents stay on supported upper paths, ramps and lower banks at ${maxBuildings}`, () => {
  const p = planRiverDistrict(planCity({ radius, length: 40000, maxBuildings }), radius)!
  const started = performance.now(), routes = planRiverWalkerRoutes(p, radius)
  expect(routes).toHaveLength(2)
  expect(routes.reduce((n, r) => n + r.path!.length, 0)).toBeLessThan(1800)
  for (const route of routes) {
    const duration = route.length / route.speed, period = 2 * (duration + 1.8)
    let low = Infinity, high = 0
    for (let t = 0; t < period; t += .5) {
      const a = sampleStreetWalker(route, radius, t), b = sampleStreetWalker(route, radius, t + .01)
      expect(Math.hypot(walkerDistance(a, b, radius), a.height - b.height)).toBeLessThanOrEqual(route.speed * .010001)
      const supported = p.surfaces.filter(s => s.material === 'stone' || s.material === 'earth').reduce((h, s) => {
        const c = s.collider
        return Math.max(h, sampleCitySurface(c.surfaceMesh!, (a.azimuth - c.azimuth) * radius, a.axial - c.axial, a.height + .3))
      }, 0)
      expect(Math.abs(supported - a.height)).toBeLessThan(.012)
      const near = p.colliders.filter(c => Math.abs(c.azimuth - a.azimuth) * radius < Math.max(c.width, c.depth) / 2 + 1 && Math.abs(c.axial - a.axial) < Math.max(c.width, c.depth) / 2 + 1)
      for (const h of [.4, 1.45]) {
        const point = new THREE.Vector3(Math.cos(a.azimuth) * (radius - supported - h), a.axial, Math.sin(a.azimuth) * (radius - supported - h))
        expect(collideSphereWithBuildings(point, new THREE.Vector3(), near, { habitatRadius: radius, sphereRadius: .32, restitution: 0 })).toBe(false)
      }
      expect(Math.abs((a.azimuth - p.azimuth) * radius - riverCentre(a.axial - p.axial))).toBeGreaterThan(10)
      low = Math.min(low, a.height); high = Math.max(high, a.height)
    }
    expect(low).toBeCloseTo(1.2); expect(high).toBeCloseTo(5.14)
    expect(walkerDistance(sampleStreetWalker(route, radius, period - .001), sampleStreetWalker(route, radius, period + .001), radius)).toBeLessThan(.003)
  }
  console.log('river resident route check', maxBuildings, routes.map(r => [r.id, r.length, r.path!.length]), performance.now() - started)
})
test('residents distinguish bridge and bank when yielding to players or vehicles', () => {
  const current = { azimuth: 0, axial: 0, height: 1.2 }, next = { ...current, axial: .1 }
  expect(walkerWouldApproach(current, next, { ...current, axial: 1 }, radius, 1.65)).toBe(true)
  expect(walkerWouldApproach(current, next, { ...current, axial: 1, height: 5.34 }, radius, 1.65)).toBe(false)
  expect(walkerWouldApproach(current, next, { ...current, axial: 1, height: 5.2 }, radius, 3.5)).toBe(false)
  expect(walkerWouldApproach(current, next, { ...current, axial: -1 }, radius, 1.65)).toBe(false)
  expect(planRiverWalkerRoutes(null, radius)).toEqual([])
})
