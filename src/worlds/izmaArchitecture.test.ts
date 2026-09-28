import { expect, test } from 'bun:test'
import { createHash } from 'node:crypto'
import raw from '../../qa/neighborhood-life/colony-source'
import parcels from '../../assets/blender/izma-parcels.json'
import { colonyColliders, decodeColonyMesh, readColonyManifest } from './authoredColony'
import { landscapeColliders } from './authoredLandscape'
import { buildCityCollisionIndex, getCityGroundHeight } from '../objects/cityLayout'

function drawnIndex(positions: number[]) {
  const groups = new Map<string, number[]>()
  for (let i = 0; i < positions.length; i += 9) {
    const key = `${Math.floor((positions[i] + positions[i + 3] + positions[i + 6]) / 384)}:${Math.floor((positions[i + 1] + positions[i + 4] + positions[i + 7]) / 384)}`
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key)!.push(...positions.slice(i, i + 9))
  }
  const surfaces = [...groups.values()].map(vertices => {
    const xs = vertices.filter((_, i) => i % 3 === 0), ys = vertices.filter((_, i) => i % 3 === 1)
    return { vertices, bounds: [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)] as [number, number, number, number] }
  })
  return buildCityCollisionIndex(landscapeColliders({ surfaces, solids: [] }, 3200), 3200, 40000)
}

test('every authored entrance walk has matching drawn and physical support', () => {
  const manifest = readColonyManifest(raw), fixed = decodeColonyMesh(manifest.architecture!.fixed)
  const physics = buildCityCollisionIndex(colonyColliders(manifest), 3200, 40000)
  const drawn = drawnIndex(fixed.meshes['arch-paving'])
  for (const p of parcels.parcels) {
    const { start, end } = p.access
    for (const t of [.02, .25, .5, .75, .98]) {
      const x = start[0] + (end[0] - start[0]) * t, y = start[1] + (end[1] - start[1]) * t
      const h = getCityGroundHeight(drawn, 3200, x / 3200, y, 400)
      expect(h, p.id).toBeGreaterThan(0)
      const actual = getCityGroundHeight(physics, 3200, x / 3200, y, h + .05, .025)
      expect(Math.abs(h - actual), `${p.id} at ${t}: drawn ${h}, physical ${actual}`).toBeLessThan(.025)
    }
  }
})

test('all streamed district tiles exist under the hash named by the manifest', async () => {
  const manifest = readColonyManifest(raw)
  for (const tile of manifest.tiles) {
    const bytes = await Bun.file(new URL('../../public' + tile.url, import.meta.url)).arrayBuffer()
    const digest = createHash('sha256').update(new Uint8Array(bytes)).digest('hex').slice(0, 12)
    expect(tile.url.endsWith('-' + digest + '.json'), tile.id).toBe(true)
    expect(bytes.byteLength, tile.id).toBeLessThan(4 * 1024 * 1024)
  }
}, 30_000) // Hashes every streamed tile; slow under a parallel full-suite run.

test('entrances use feasible grades and foundations support the whole footprint', () => {
  for (const p of parcels.parcels) {
    const { start, end, length, maximumStep } = p.access
    expect(Math.abs(start[2] - end[2]) / length, p.id).toBeLessThanOrEqual(.301)
    expect(maximumStep, p.id).toBeLessThan(.15)
    expect(Math.abs(end[2] - p.floor), p.id).toBeLessThan(.003)
    expect(length, p.id).toBeGreaterThan(2)
    expect(length, p.id).toBeLessThanOrEqual(40)
    expect(p.foundationBottom, p.id).toBeLessThan(Math.min(...p.groundSamples))
    expect(p.floor, p.id).toBeGreaterThan(Math.max(...p.groundSamples))
  }
})

test('exposed foundation aprons support feet outside the closed building walls', () => {
  const manifest = readColonyManifest(raw)
  const physics = buildCityCollisionIndex(colonyColliders(manifest), 3200, 40000)
  const paving = drawnIndex(decodeColonyMesh(manifest.architecture!.fixed).meshes['arch-paving'])
  for (const p of parcels.parcels) {
    // Front lip away from the doorway: the access paving can legitimately
    // cover the centre of this apron, especially on descending approaches.
    const u = p.size[0] * (p.family === 'civic' ? -.38 : .38), v = -p.size[1] / 2 - .125
    const x = p.position[0] + Math.cos(p.yaw) * u - Math.sin(p.yaw) * v, y = p.position[1] + Math.sin(p.yaw) * u + Math.cos(p.yaw) * v
    const expected = Math.max(p.floor, getCityGroundHeight(paving, 3200, x / 3200, y, 400))
    const h = getCityGroundHeight(physics, 3200, x / 3200, y, expected + .03, .02)
    expect(Math.abs(h - expected), p.id).toBeLessThan(.015)
  }
})


test('every frontage pavement reaches the actual street or its paved sidewalk', () => {
  const manifest = readColonyManifest(raw), base = decodeColonyMesh(manifest.base)
  const replacement = manifest.motorway ? decodeColonyMesh(manifest.motorway.fixed) : null
  const streets = drawnIndex([
    ...['local', 'arterial', 'walk'].flatMap(name => base.meshes[name] ?? []),
    ...['local', 'arterial', 'walk', 'motorway-road', 'motorway-walk'].flatMap(name => replacement?.meshes[name] ?? [])
  ])
  for (const p of parcels.parcels) {
    const [x, y, h] = p.access.start
    const street = getCityGroundHeight(streets, 3200, x / 3200, y, 400)
    expect(street, p.id).toBeGreaterThan(0)
    expect(h - street, p.id).toBeGreaterThan(-.02)
    expect(h - street, p.id).toBeLessThan(.2)
  }
})
