import { expect, test } from 'bun:test'
import { createHash } from 'node:crypto'
import { Group } from 'three'
import raw from '../../qa/neighborhood-life/colony-source'
import plan from '../../assets/blender/izma-rail.json'
import { AuthoredColony, colonyColliders, readColonyManifest } from './authoredColony'
import { buildCityCollisionIndex, collectCityCollidersNear, getCityGroundHeight, type CityBuilding } from '../objects/cityLayout'

const manifest = readColonyManifest(raw), data = manifest.railways!
const physics = buildCityCollisionIndex(colonyColliders(manifest), 3200, 40000)
test('stations and vehicle exports retain current authored reservations and both detailed LODs', async () => {
  for (const [name, digest] of Object.entries(plan.dependencies)) {
    const bytes = await Bun.file(new URL('../../assets/blender/' + name, import.meta.url)).arrayBuffer()
    expect(createHash('sha256').update(new Uint8Array(bytes)).digest('hex'), name).toBe(digest)
  }
  expect(data.stations).toHaveLength(18); expect(data.lines).toHaveLength(3)
  expect(data.lights).toHaveLength(18); expect(data.vehicleLight.intensity).toBeGreaterThan(0)
  for (const part of Object.values(data.vehicle)) {
    expect(part.vertices.length).toBeGreaterThan(0); expect(part.mid!.vertices.length).toBeGreaterThan(0)
  }
  const colony = new AuthoredColony(new Group(), async () => ({ vertices: [], meshes: {}, surfaces: [] }))
  colony.rebuild(manifest)
  try {
    for (const station of data.stations) {
      colony.update(station.entry[0] / 3200, station.entry[1], station.entry[2])
      const visit = colony.visit('station', physics)!
      expect(visit.azimuth * 3200).toBeCloseTo(station.entry[0], 4)
      expect(visit.axial).toBeCloseTo(station.entry[1], 4)
      expect(visit.groundHeight).toBeCloseTo(station.entry[2], 1)
    }
  } finally { colony.dispose() }
})

test('station approaches and ramps are supported continuously within the existing local collision budget', () => {
  const near = new Set<CityBuilding>()
  for (const station of data.stations) {
    const path = station.approach
    for (let i = 1; i < path.length; i++) {
      const a = path[i - 1], b = path[i], length = Math.hypot(b[0] - a[0], b[1] - a[1])
      expect(Math.abs(b[2] - a[2]) / length, `${station.id} grade ${i}`).toBeLessThan(.085)
      for (const t of [.01, .5, .99]) {
        const p = a.map((n, j) => n + (b[j] - n) * t)
        const h = getCityGroundHeight(physics, 3200, p[0] / 3200, p[1], p[2] + .08)
        expect(Math.abs(h - p[2]), `${station.id} support ${i}`).toBeLessThan(.06)
        collectCityCollidersNear(physics, p[0] / 3200, p[1], 1, near)
        expect(near.size, station.id).toBeLessThanOrEqual(32)
        expect([...near].reduce((n, b) => n + (b.surfaceMesh?.length ?? 0) / 9, 0), station.id).toBeLessThanOrEqual(4096)
      }
    }
  }
})
