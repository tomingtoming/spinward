import { expect, test } from 'bun:test'
import { buildCityCollisionIndex, collectCityBuildingsInWindow, collectCityCollidersNear, type CityBuilding } from './cityLayout'

test('distance refinement preserves the travel buffer at grid edges, rotated bounds and the cylinder seam without expanding meshes', () => {
  for (const radius of [18, 3200]) {
    const bodies: CityBuilding[] = Array.from({ length: 160 }, (_, i) => ({
      azimuth: ((i % 20) - 10) * 17 / radius, axial: Math.floor(i / 20) * 19 - 76,
      width: 12 + i % 5 * 8, depth: 8 + i % 4 * 12, yaw: i % 7 * Math.PI / 7,
      height: 10, tone: .5, kind: 'block',
      get surfaceMesh(): readonly number[] { throw Error('broad phase expanded geometry') }
    }))
    const index = buildCityCollisionIndex(bodies, radius, 40000), near = new Set<CityBuilding>()
    const range = Math.min(2 * Math.PI * radius / index.azimuthCellCount, index.axialCellSize)
    let discarded = 0
    for (const x of [-128.001, -64.001, -.001, 0, 32, 63.999, 64.001, 128]) for (const y of [-64.001, -.001, 0, 63.999]) {
      const a = x / radius
      const broad = collectCityBuildingsInWindow(index, a, y, 1, new Set()).size
      collectCityCollidersNear(index, a, y, 1, near)
      discarded += broad - near.size
      for (const b of bodies) {
        const c = Math.abs(Math.cos(b.yaw!)), s = Math.abs(Math.sin(b.yaw!))
        const dx = Math.max(0, Math.abs(Math.atan2(Math.sin(a - b.azimuth), Math.cos(a - b.azimuth))) * radius - (b.width * c + b.depth * s) / 2 - 8)
        const dy = Math.max(0, Math.abs(y - b.axial) - (b.depth * c + b.width * s) / 2 - 8)
        expect(near.has(b)).toBe(Math.hypot(dx, dy) <= range)
      }
    }
    expect(discarded).toBeGreaterThan(0)
  }
})
