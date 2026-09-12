import { expect, test } from 'bun:test'
import * as THREE from 'three'
import { planCity } from '../objects/cityLayout'
import { planRiverDistrict, riverCentre } from '../objects/riverDistrictPlan'
import { riverWalkGraph, riverLocalRoute } from './riverWalkRoute'
import { NeighborhoodJourney, planNeighborhoodRoute, surfaceDistance } from './neighborhoodRoute'
import { collideSphereWithBuildings } from '../sim/cityCollision'
import { sampleCitySurface } from '../objects/citySurfaceMesh'

const radius = 3200
for (const maxBuildings of [16000, 18000, 64000]) test(`river paths use supported ramps and keep bridge layers separate at ${maxBuildings} buildings`, () => {
  const city = planCity({ radius, length: 40000, maxBuildings }), p = planRiverDistrict(city, radius)!
  const at = (x: number, y: number, h: number) => ({ azimuth: p.azimuth + x / radius, axial: p.axial + y, groundHeight: h })
  const graph = riverWalkGraph(p, radius)
  expect(graph.nodes.length).toBeLessThan(400); expect(graph.portals).toHaveLength(4)
  const routes = [
    riverLocalRoute(p, radius, at(0, 4.65, 5.34), at(18, 32, 1.2))!,
    riverLocalRoute(p, radius, at(-13.5, 0, 1.2), at(13.5, 0, 1.2))!,
    riverLocalRoute(p, radius, at(13.5, 0, 1.2), at(riverCentre(40) + 13.5, 40, 1.2))!,
  ]
  expect(routes.every(Boolean)).toBe(true)
  expect(routes[0].some(q => Math.abs(q.axial - p.axial) >= 99)).toBe(true)
  expect(routes[0].some(q => q.riverWalk === 'ramp')).toBe(true)
  expect(routes[1].some(q => q.groundHeight! > 5)).toBe(true)
  expect(routes[2].every(q => Math.abs(q.groundHeight! - 1.2) < .001)).toBe(true)
  const graphSegments = graph.edges.map(e => [graph.nodes[e.a], graph.nodes[e.b]].map(q => at(q.x, q.y, q.h)))
  for (const route of [...routes, ...graphSegments]) for (let i = 1; i < route.length; i++) {
    const a = route[i - 1], b = route[i], count = Math.max(1, Math.ceil(surfaceDistance(a, b, radius) / .5))
    for (let j = 0; j <= count; j++) {
      const t = j / count, azimuth = THREE.MathUtils.lerp(a.azimuth, b.azimuth, t), axial = THREE.MathUtils.lerp(a.axial, b.axial, t)
      const h = THREE.MathUtils.lerp(a.groundHeight!, b.groundHeight!, t)
      const near = p.colliders.filter(c => Math.abs(c.azimuth - azimuth) * radius < Math.max(c.width, c.depth) / 2 + 1 && Math.abs(c.axial - axial) < Math.max(c.width, c.depth) / 2 + 1)
      // The walker samples the floor continuously. A segment's interpolated
      // height is only its layer hint, especially at a ramp's change of grade.
      const supported = p.surfaces.filter(s => s.material === 'earth' || s.material === 'stone').reduce((height, s) => {
        const c = s.collider
        return Math.max(height, sampleCitySurface(c.surfaceMesh!, (azimuth - c.azimuth) * radius, axial - c.axial, h + .3))
      }, 0)
      expect(Math.abs(supported - h)).toBeLessThan(.3)
      const point = new THREE.Vector3(Math.cos(azimuth) * (radius - supported - .4), axial, Math.sin(azimuth) * (radius - supported - .4))
      const hit = collideSphereWithBuildings(point, new THREE.Vector3(), near, { habitatRadius: radius, sphereRadius: .32, restitution: 0 })
      if (hit) throw Error('Blocked river route ' + JSON.stringify({ x: (azimuth - p.azimuth) * radius, y: axial - p.axial, h, a, b }))
      const x = (azimuth - p.azimuth) * radius, y = axial - p.axial
      if (h < 3) expect(Math.abs(x - riverCentre(y))).toBeGreaterThan(10) // Never use water as a shortcut.
    }
  }
  for (const side of [-1, 1]) {
    const yaw = Math.atan(.25), x = -side * 5.94 * Math.sin(yaw), y = side * 5.94 * Math.cos(yaw)
    const a = p.azimuth + x / radius
    const point = new THREE.Vector3(Math.cos(a) * (radius - 5.6), p.axial + y, Math.sin(a) * (radius - 5.6))
    expect(collideSphereWithBuildings(point, new THREE.Vector3(), p.colliders, { habitatRadius: radius, sphereRadius: .32, restitution: 0 })).toBe(true)
  }
  for (const bank of [-1, 1]) for (const y of [-100, 100]) {
    const x = riverCentre(y) + bank * 18.5
    const paving = p.surfaces.filter(s => s.material === 'stone').reduce((h, s) => {
      const c = s.collider
      return Math.max(h, sampleCitySurface(c.surfaceMesh!, x - (c.azimuth - p.azimuth) * radius, p.axial + y - c.axial))
    }, 0)
    expect(paving).toBeCloseTo(5.07, 2)
  }
  const lower = at(13.5, 0, 1.2)
  expect(riverLocalRoute(p, radius, at(0, 0, .65), lower)).toBeNull()
  expect(riverLocalRoute(p, radius, at(0, 0, 5.2), lower)).toBeNull() // Carriageway, not its sidewalk.
  expect(riverLocalRoute(p, radius, at(0, 4.65, 20), lower)).toBeNull()
  // Vehicle planning does not acquire a route through the river's foot paths.
  expect(planNeighborhoodRoute(city, radius, at(0, 4.65, 5.34), lower, true, null, null, p))
    .toEqual(planNeighborhoodRoute(city, radius, at(0, 4.65, 5.34), lower, true))
})

test('river street connections start at the actual bridge sidewalk mouths', () => {
  const city = planCity({ radius, length: 40000, maxBuildings: 64000 }), p = planRiverDistrict(city, radius)!
  const goal = { azimuth: p.azimuth + 18 / radius, axial: p.axial + 32, groundHeight: 1.2 }
  for (const road of p.connections) {
    const direction = road.azimuth < p.azimuth ? 1 : -1
    const start = { azimuth: road.azimuth + direction * (road.tangentWidth / 2 + 1) / radius, axial: p.axial + 65, groundHeight: .34 }
    const route = planNeighborhoodRoute(city, radius, start, goal, false, null, null, p)
    expect(route).not.toBeNull(); expect(route!.some(q => q.riverWalk === 'bridge')).toBe(true)
    expect(route!.some(q => q.riverWalk === 'ramp')).toBe(true)
  }
})

test('journey progress and arrival reject the bridge above the same lower-bank coordinates', () => {
  const journey = new NeighborhoodJourney()
  const a = { azimuth: 0, axial: 0, groundHeight: 1.2, riverWalk: 'bank' as const }
  const b = { ...a, axial: 8 }, c = { ...a, axial: 16 }
  journey.setRoute([a, b, c], false, 'Riverside')
  journey.update({ ...b, groundHeight: 5.34 }, radius, 2)
  expect(journey.index).toBe(1); expect(journey.offRoute).toBe(2)
  journey.update(b, radius, .1); expect(journey.index).toBe(2)
  journey.update({ ...c, groundHeight: 5.34 }, radius, .1); expect(journey.status).toBe('active')
  journey.update(c, radius, .1); expect(journey.status).toBe('arrived')
})
