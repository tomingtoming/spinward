import { expect, test } from 'bun:test'
import { planCity, type CityBuilding } from './cityLayout'
import { FRONTAGES, frontageKind, frontageLayout } from './groundFloorFrontages'

const building: CityBuilding = { azimuth: 0.02, axial: 30, width: 8, depth: 72, height: 24, kind: 'block', tone: 0.5 }

test('elongated lots keep separate whole bay counts on their narrow and long walls', () => {
  for (const kind of Object.keys(FRONTAGES) as (keyof typeof FRONTAGES)[]) {
    const layout = frontageLayout(building, kind)
    expect(layout.widthBays).toBe(1)
    expect(layout.depthBays).toBeGreaterThanOrEqual(6)
    expect(Number.isInteger(layout.depthBays)).toBe(true)
    const turned = frontageLayout({ ...building, width: building.depth, depth: building.width }, kind)
    expect(turned.widthBays).toBe(layout.depthBays)
    expect(turned.depthBays).toBe(layout.widthBays)
    expect(layout.height).toBeLessThan(5)
  }
})

test('arrival streets have multiple uses and buildings retain their use after LOD reordering', () => {
  const buildings = planCity({ radius: 3200, length: 40000, maxBuildings: 64000 }).buildings
    .filter(b => b.kind !== 'house' && b.height >= 8 && Math.hypot(b.azimuth * 3200, b.axial) < 300)
  const kinds = buildings.map(frontageKind)
  expect(new Set(kinds).size).toBeGreaterThanOrEqual(3)
  expect([...buildings].reverse().map(b => frontageKind({ ...b })).reverse()).toEqual(kinds)
  expect(frontageKind({ ...building, industrial: true, urban: 1 })).toBe('workshop')
})
