import { expect, test } from 'bun:test'
import { planStreetWalkerRoutes, sampleStreetWalker, walkerWouldApproach } from './streetWalkerRoutes'
import type { SidewalkSegment } from './sidewalks'
import { planSidewalkSegments } from './sidewalks'
import { planCity } from './cityLayout'
import { SurfaceIndex } from './streetAccess'

test('walks stay within actual pavement with room to turn before each end', () => {
  for (const radius of [180, 3200, 10000]) for (const isAvenue of [true, false]) {
    const segment: SidewalkSegment = { azimuth: Math.PI - 1 / radius, axial: 100,
      tangentExtent: isAvenue ? 2 : 210, axialExtent: isAvenue ? 210 : 2, isAvenue, roadSide: 1 }
    const routes = planStreetWalkerRoutes([segment], radius)
    expect(routes.length).toBeGreaterThan(1)
    for (const route of routes) for (let t = 0; t < 200; t += .2) {
      const point = sampleStreetWalker(route, radius, t)
      const tangent = Math.abs(Math.atan2(Math.sin(point.azimuth - segment.azimuth), Math.cos(point.azimuth - segment.azimuth)) * radius)
      const axial = Math.abs(point.axial - segment.axial)
      expect(tangent).toBeLessThan(segment.tangentExtent / 2 - .4)
      expect(axial).toBeLessThan(segment.axialExtent / 2 - .4)
    }
    expect(planStreetWalkerRoutes([segment], 18)).toEqual([])
  }
})

test('residents pause and turn continuously at both ends, with no cycle teleport', () => {
  const route = planStreetWalkerRoutes([{ azimuth: 0, axial: 0, tangentExtent: 3, axialExtent: 50, isAvenue: true, roadSide: -1 }], 3200)[0]
  const duration = route.length / route.speed
  const arrive = sampleStreetWalker(route, 3200, duration)
  const turn = sampleStreetWalker(route, 3200, duration + .9)
  const leave = sampleStreetWalker(route, 3200, duration + 1.8)
  expect(arrive.walking).toBe(false); expect(turn.walking).toBe(false); expect(leave.walking).toBe(true)
  expect(turn.axial).toBe(arrive.axial); expect(turn.heading).toBeCloseTo(Math.PI / 2)
  expect(leave.axial).toBeCloseTo(arrive.axial)
  const period = 2 * (duration + 1.8)
  const before = sampleStreetWalker(route, 3200, period - .001), after = sampleStreetWalker(route, 3200, period + .001)
  expect(Math.abs(before.axial - after.axial)).toBeLessThan(.002)
  expect(Math.cos(before.heading)).toBeCloseTo(Math.cos(after.heading), 5)
})

test('a resident yields to someone ahead but can move away from someone behind, including the seam', () => {
  const radius = 3200, current = { azimuth: Math.PI - .1 / radius, axial: 0 }, next = { azimuth: -Math.PI + .01 / radius, axial: 0 }
  expect(walkerWouldApproach(current, next, { azimuth: -Math.PI + .5 / radius, axial: 0 }, radius, 1.15)).toBe(true)
  expect(walkerWouldApproach(current, next, { azimuth: Math.PI - .5 / radius, axial: 0 }, radius, 1.15)).toBe(false)
})

test('nearby generation preserves route identity without splitting an entire long avenue', () => {
  const s: SidewalkSegment = { azimuth: 0, axial: 0, tangentExtent: 3, axialExtent: 40000, isAvenue: true, roadSide: 1 }
  const all = planStreetWalkerRoutes([s], 3200, 42)
  const near = planStreetWalkerRoutes([s], 3200, 42, { azimuth: 0, axial: 1200, range: 110 })
  expect(near.length).toBeLessThan(6)
  expect(near.length).toBeGreaterThan(1)
  for (const route of near) expect(route).toEqual(all.find(r => r.id === route.id))
})

test('sampled walks throughout the generated city avoid carriageways and building footprints', () => {
  const radius = 3200, plan = planCity({ radius, length: 40000, maxBuildings: 18000 })
  const segments = planSidewalkSegments(plan.roads, plan.intersections, radius, 3, () => false)
  const blocks = [...plan.roads, ...plan.buildings.map(b => ({ ...b, tangentWidth: b.width, axialLength: b.depth }))]
  const index = new SurfaceIndex(radius)
  blocks.forEach((b, i) => index.insert(b, i))
  let sampled = 0
  for (let i = 0; i < segments.length; i += 97) {
    const s = segments[i]
    for (const r of planStreetWalkerRoutes([s], radius, i, { azimuth: s.azimuth, axial: s.axial, range: 60 })) {
      for (const t of [0, r.length / r.speed / 2, r.length / r.speed]) {
        const point = sampleStreetWalker(r, radius, t)
        for (const id of index.query({ ...point, tangentWidth: .7, axialLength: .7 })) {
          const b = blocks[id]
          const intersects = Math.abs(Math.atan2(Math.sin(point.azimuth - b.azimuth), Math.cos(point.azimuth - b.azimuth))) * radius < b.tangentWidth / 2 + .35 &&
            Math.abs(point.axial - b.axial) < b.axialLength / 2 + .35
          expect(intersects).toBe(false)
        }
        sampled++
      }
    }
  }
  expect(sampled).toBeGreaterThan(1000)
})
