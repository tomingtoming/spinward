import { expect, test } from 'bun:test'
import { createHash } from 'node:crypto'
import { Group } from 'three'
import raw from './generated/izmaColony.json'
import plan from '../../assets/blender/izma-neighbourhood-plan.json'
import parcels from '../../assets/blender/izma-neighbourhood-parcels.json'
import publicSpaces from '../../assets/blender/izma-public-spaces.json'
import { colonyColliders, decodeColonyMesh, readColonyManifest } from './authoredColony'
import { AuthoredLandscape, landscapeColliders, LANDSCAPE_LIGHT_BUDGET } from './authoredLandscape'
import { unpackLandscapeLibrary } from './landscapeData'
import worldRaw from './generated/worldLandscapes.json'
import { buildCityCollisionIndex, collectCityCollidersNear, getCityGroundHeight, type CityBuilding } from '../objects/cityLayout'

const manifest = readColonyManifest(raw)
const physics = buildCityCollisionIndex(colonyColliders(manifest), 3200, 40000)
function drawingIndex() {
  const positions = Object.values(decodeColonyMesh(manifest.neighbourhoods!.fixed, false).meshes).flat()
  const groups = new Map<string, number[]>()
  for (let i = 0; i < positions.length; i += 9) {
    const key = `${Math.floor(positions[i] / 64)}:${Math.floor(positions[i + 1] / 64)}`
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key)!.push(...positions.slice(i, i + 9))
  }
  const surfaces = [...groups.values()].map(vertices => {
    const xs = vertices.filter((_, i) => i % 3 === 0), ys = vertices.filter((_, i) => i % 3 === 1)
    return { vertices, bounds: [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)] as [number, number, number, number] }
  })
  return buildCityCollisionIndex(landscapeColliders({ surfaces, solids: [] }, 3200), 3200, 40000)
}

test('every public-place catchment has its authored mixed-use infill and current reservation sources', async () => {
  for (const [name, digest] of Object.entries(parcels.dependencies)) {
    const bytes = await Bun.file(new URL('../../assets/blender/' + name, import.meta.url)).arrayBuffer()
    expect(createHash('sha256').update(new Uint8Array(bytes)).digest('hex'), name).toBe(digest)
  }
  expect(parcels.neighbourhoods.map(n => n.id).sort()).toEqual(publicSpaces.places.map(p => p.id).sort())
  expect(manifest.neighbourhoods!.counts.buildings).toBe(parcels.parcels.length)
  expect(new Set(parcels.parcels.map(p => p.id)).size).toBe(parcels.parcels.length)
  for (const n of parcels.neighbourhoods) {
    const spec = plan.districts[n.id as keyof typeof plan.districts]
    expect(n.parcels.length, n.id).toBeGreaterThanOrEqual(spec.minimum)
    const members = parcels.parcels.filter(p => p.district === n.id)
    expect(new Set(members.map(p => p.family)).size, n.id).toBeGreaterThanOrEqual(3)
    expect(members.every(p => p.lot.distance <= spec.radius), n.id).toBe(true)
    expect(n.footprintArea / n.lotArea, n.id).toBeLessThan(.6)
    expect(manifest.visits['neighbourhood-' + n.id], n.id).toBeDefined()
  }
})

test('new frontages and lot grounds agree with drawn support and preserve the local collision budget', () => {
  const drawn = drawingIndex(), near = new Set<CityBuilding>()
  for (const p of parcels.parcels) {
    expect(p.access.maximumStep, p.id).toBeLessThan(.15)
    expect(Math.abs(p.access.end[2] - p.floor), p.id).toBeLessThan(.003)
    for (const t of [.05, .25, .5, .75, .95]) {
      const q = p.access.start.map((v, i) => v + (p.access.end[i] - v) * t)
      const h = getCityGroundHeight(drawn, 3200, q[0] / 3200, q[1], 400)
      expect(h, p.id).toBeGreaterThan(0)
      expect(Math.abs(getCityGroundHeight(physics, 3200, q[0] / 3200, q[1], h + .03) - h), p.id).toBeLessThan(.02)
      collectCityCollidersNear(physics, q[0] / 3200, q[1], 1, near)
      expect(near.size, p.id).toBeLessThanOrEqual(32)
      expect([...near].reduce((sum, b) => sum + (b.surfaceMesh?.length ?? 0) / 9, 0), p.id).toBeLessThanOrEqual(4096)
    }
    const u = 0, v = p.size[1] / 2 + p.lot.rearGarden / 2
    const x = p.position[0] + Math.cos(p.yaw) * u - Math.sin(p.yaw) * v
    const y = p.position[1] + Math.sin(p.yaw) * u + Math.cos(p.yaw) * v
    const h = getCityGroundHeight(drawn, 3200, x / 3200, y, 400)
    expect(h, p.id).toBeGreaterThan(0)
    expect(Math.abs(getCityGroundHeight(physics, 3200, x / 3200, y, h + .03) - h), p.id).toBeLessThan(.02)
  }
})

test('collision cost stays bounded between the roads, including the outer edges of dense housing', () => {
  const near = new Set<CityBuilding>()
  for (const n of parcels.neighbourhoods) {
    const points = parcels.parcels.filter(p => p.district === n.id).flatMap(p => p.lot.polygon)
    const xs = points.map(p => p[0]), ys = points.map(p => p[1])
    for (let x = Math.min(...xs) - 64; x <= Math.max(...xs) + 64; x += 16)
      for (let y = Math.min(...ys) - 64; y <= Math.max(...ys) + 64; y += 16) {
        collectCityCollidersNear(physics, x / 3200, y, 1, near)
        expect(near.size, n.id).toBeLessThanOrEqual(32)
        expect([...near].reduce((sum, b) => sum + (b.surfaceMesh?.length ?? 0) / 9, 0), `${n.id} at ${x},${y}`).toBeLessThanOrEqual(4096)
      }
  }
})

test('street lamps have visible support and share the bounded near-light pool on all strips', () => {
  const lights = manifest.neighbourhoods!.lights!, layer = new AuthoredLandscape(new Group())
  const poles = parcels.parcels.flatMap(p => p.proxyParts.filter(part => part[3] === .16 && part[4] === .16).map(part => ({
    x: p.position[0] + Math.cos(p.yaw) * Number(part[0]) - Math.sin(p.yaw) * Number(part[1]),
    y: p.position[1] + Math.sin(p.yaw) * Number(part[0]) + Math.cos(p.yaw) * Number(part[1]),
    h: p.floor + Number(part[2]) + Number(part[5])
  })))
  expect(lights.length).toBeGreaterThan(200)
  expect(lights).toHaveLength(poles.length)
  for (const light of lights) expect(poles.some(p => Math.hypot(p.x - light.position[0], p.y - light.position[1]) < .5
    && Math.abs(p.h - light.position[2] - .21) < .01)).toBe(true)
  layer.rebuild('izma', unpackLandscapeLibrary(worldRaw).izma, 3200, [...manifest.publicRealm!.lights!, ...lights])
  try {
    expect(layer.group.children.filter(o => o.type === 'PointLight')).toHaveLength(LANDSCAPE_LIGHT_BUDGET)
    for (const daylight of [0, 1]) {
      layer.setDaylight(daylight)
      for (let i = 0; i < lights.length; i += 13) {
        const [x, y, h] = lights[i].position
        layer.update(x / 3200 - Math.PI * 2, y, h - 2.1)
        expect(layer.group.userData.activeLights).toBeLessThanOrEqual(LANDSCAPE_LIGHT_BUDGET)
        if (daylight === 0) expect(layer.group.userData.activeLights).toBeGreaterThan(0)
        else expect(layer.group.userData.activeLights).toBe(0)
      }
    }
  } finally { layer.dispose() }
})
