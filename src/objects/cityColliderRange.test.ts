import { expect, test } from 'bun:test'
import { buildCityCollisionIndex, collectCityBuildingsInWindow, collectCityCollidersNear, CITY_COLLIDER_TRAVEL_BUFFER, type CityBuilding } from './cityLayout'
import { GameLoop } from '../app/gameLoop'
import { VEHICLE_TUNING } from '../gameplay/vehicle'
import type { WebGLRenderer } from 'three'

test('the streamed lead-in covers three maximum-speed steps at the actual frame cap', () => {
  let frame!: (time: number) => void
  const deltas: number[] = []
  const renderer = { xr: { addEventListener() {} }, setAnimationLoop(callback: typeof frame) { frame = callback } }
  new GameLoop(renderer as unknown as WebGLRenderer, s => deltas.push(s.deltaSeconds)).start()
  frame(0); frame(1000)
  expect(CITY_COLLIDER_TRAVEL_BUFFER).toBeGreaterThan(3 * VEHICLE_TUNING.maxSpeed * Math.max(...deltas))
})

test('distance refinement preserves the travel buffer at grid edges, rotated bounds and the cylinder seam without expanding meshes', () => {
  for (const radius of [18, 3200]) {
    const bodies: CityBuilding[] = Array.from({ length: 160 }, (_, i) => ({
      azimuth: ((i % 20) - 10) * 17 / radius, axial: Math.floor(i / 20) * 19 - 76,
      width: 12 + i % 5 * 8, depth: 8 + i % 4 * 12, yaw: i % 7 * Math.PI / 7,
      height: 10, tone: .5, kind: 'block',
      get surfaceMesh(): readonly number[] { throw Error('broad phase expanded geometry') }
    }))
    const index = buildCityCollisionIndex(bodies, radius, 40000), near = new Set<CityBuilding>()
    const range = Math.min(CITY_COLLIDER_TRAVEL_BUFFER, 2 * Math.PI * radius / index.azimuthCellCount, index.axialCellSize)
    let discarded = 0
    for (const margin of [0, .8]) for (const x of [-128.001, -64.001, -.001, 0, 32, 63.999, 64.001, 128]) for (const y of [-64.001, -.001, 0, 63.999]) {
      const a = x / radius
      const broad = collectCityBuildingsInWindow(index, a, y, 1, new Set()).size
      collectCityCollidersNear(index, a, y, 1, near, margin)
      discarded += broad - near.size
      for (const b of bodies) {
        const c = Math.abs(Math.cos(b.yaw!)), s = Math.abs(Math.sin(b.yaw!))
        const dx = Math.max(0, Math.abs(Math.atan2(Math.sin(a - b.azimuth), Math.cos(a - b.azimuth))) * radius - ((b.width + 2 * margin) * c + (b.depth + 2 * margin) * s) / 2)
        const dy = Math.max(0, Math.abs(y - b.axial) - ((b.depth + 2 * margin) * c + (b.width + 2 * margin) * s) / 2)
        expect(near.has(b)).toBe(Math.hypot(dx, dy) <= range)
      }
    }
    expect(discarded).toBeGreaterThan(0)
  }
})
