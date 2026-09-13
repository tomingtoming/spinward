import { expect, test } from 'bun:test'
import * as THREE from 'three'
import { planCity } from './cityLayout'
import { planCurvedNeighborhood } from './curvedNeighborhood'
import { planCurvedWalkerRoutes } from './curvedWalkerRoutes'
import { sampleCitySurface } from './citySurfaceMesh'
import { sampleStreetWalker, walkerDistance } from './streetWalkerRoutes'
import { collideSphereWithBuildings } from '../sim/cityCollision'

const radius = 3200, city = planCity({ radius, length: 40000, maxBuildings: 64000 })
const district = planCurvedNeighborhood(city, radius)!
const routes = planCurvedWalkerRoutes(district, radius)

test('curved resident routes keep bodies on the footways for the full outbound, turn and return cycle', () => {
  expect(routes).toHaveLength(2)
  expect(routes.reduce((n, r) => n + r.path!.length, 0)).toBeLessThan(1200)
  for (const route of routes) {
    const duration = route.length / route.speed, period = 2 * (duration + 1.8)
    expect(route.length).toBeGreaterThan(210)
    let minHeading = Infinity, maxHeading = -Infinity
    for (let time = 0; time <= period; time += .5) {
      const a = sampleStreetWalker(route, radius, time), b = sampleStreetWalker(route, radius, time + .01)
      expect(walkerDistance(a, b, radius)).toBeLessThanOrEqual(route.speed * .010001)
      // Centre and both shoulders must have walk support, not just road or
      // grass support. This also catches shortcuts between curved samples.
      for (const offset of [-.4, 0, .4]) {
        const azimuth = a.azimuth + Math.cos(a.heading) * offset / radius
        const axial = a.axial - Math.sin(a.heading) * offset
        let support = -Infinity
        for (const { kind, collider: c } of district.surfaces) {
          if (kind !== 'walk') continue
          const x = (azimuth - c.azimuth) * radius, y = axial - c.axial
          if (Math.abs(x) > c.width / 2 + 1e-6 || Math.abs(y) > c.depth / 2 + 1e-6) continue
          support = Math.max(support, sampleCitySurface(c.surfaceMesh!, x, y, .5))
        }
        expect(support).toBeCloseTo(a.height, 5)
      }
      const point = new THREE.Vector3(Math.cos(a.azimuth) * (radius - a.height - .9), a.axial, Math.sin(a.azimuth) * (radius - a.height - .9))
      expect(collideSphereWithBuildings(point, new THREE.Vector3(), district.colliders,
        { habitatRadius: radius, sphereRadius: .4, restitution: 0 })).toBe(false)
      if (time < duration) { minHeading = Math.min(minHeading, a.heading); maxHeading = Math.max(maxHeading, a.heading) }
    }
    expect(maxHeading - minHeading).toBeGreaterThan(.5)
    expect(sampleStreetWalker(route, radius, duration + .9).walking).toBe(false)
    expect(walkerDistance(sampleStreetWalker(route, radius, period - .001), sampleStreetWalker(route, radius, period + .001), radius)).toBeLessThan(.003)
    for (const endpoint of [route.path![0], route.path!.at(-1)!]) {
      // At least five metres inside both arterial boundaries; no unsignalled
      // crossing is smuggled in by a resident turning at the junction.
      const x = (endpoint.azimuth - district.azimuth) * radius
      expect(x - district.knots[0].point[0]).toBeGreaterThan(5)
      expect(district.knots[2].point[0] - x).toBeGreaterThan(5)
    }
  }
})

test('curved resident routes are identical across budgets and absent without a supported district', () => {
  for (const maxBuildings of [16000, 18000]) {
    const p = planCurvedNeighborhood(planCity({ radius, length: 40000, maxBuildings }), radius)
    expect(planCurvedWalkerRoutes(p, radius)).toEqual(routes)
  }
  expect(planCurvedWalkerRoutes(null, radius)).toEqual([])
  expect(planCurvedWalkerRoutes(district, 250)).toEqual([])
})

test('curved resident motion wraps the cylinder seam without a long interpolated jump', () => {
  const seam = planCurvedWalkerRoutes({ ...district, azimuth: Math.PI }, radius)
  for (const route of seam) for (let time = 0; time < route.length / route.speed; time += .5) {
    const a = sampleStreetWalker(route, radius, time), b = sampleStreetWalker(route, radius, time + .01)
    expect(walkerDistance(a, b, radius)).toBeCloseTo(route.speed * .01, 5)
  }
})
