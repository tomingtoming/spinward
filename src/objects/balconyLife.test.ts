import {test, expect} from 'bun:test'
import {readFileSync} from 'node:fs'
import {planCity} from './cityLayout'
import {colonyBuildingSpec} from './colonyBuildingPlan'
import {colonyBuildingDesign} from './colonyBuildingDesign'
import {colonyBalconies} from './colonyBalconies'
import {planBalconyLife, balconyLifeLod, BALCONY_LIFE_PER_BUILDING} from './balconyLife'

test('household furniture stays on existing balconies and keeps door and facade access clear', () => {
  let populated = 0, empty = 0
  const kinds = new Set<string>(), tints = new Set<number>()
  for (const maxBuildings of [16000, 18000, 64000]) {
    const city = planCity({radius: 3200, length: 40000, maxBuildings})
    // Cover residential forms and orientations without tying the check to one hand-picked facade.
    for (const b of city.buildings.filter(b => Math.abs(b.axial) < 700 && Math.abs(b.azimuth) < .3)) {
      const spec = colonyBuildingSpec(b), design = colonyBuildingDesign(b), balconies = colonyBalconies(spec, design)
      const life = planBalconyLife(spec, balconies)
      expect(life.length).toBeLessThanOrEqual(BALCONY_LIFE_PER_BUILDING)
      expect(planBalconyLife(spec, balconies)).toEqual(life)
      if (design.use.primary !== 'apartments') expect(life).toEqual([])
      const allBays = balconies.sections.reduce((n, s) => n + s.last - s.first + 1, 0)
      populated += life.length; empty += allBays - life.length
      for (const bay of life) {
        const section = balconies.sections[bay.section]
        const center = section.volume.x + (bay.column + .5) * section.pitch - section.volume.w / 2
        for (const p of bay.props) {
          kinds.add(p.kind); tints.add(p.tint)
          expect(p.y).toBe(section.y)
          expect(p.z - p.depth / 2 - section.z).toBeGreaterThanOrEqual(.6 - 1e-8)
          expect(p.z + p.depth / 2).toBeLessThanOrEqual(section.z + .96 * section.depth - .069)
          expect(Math.abs(p.x - center) - p.width / 2).toBeGreaterThanOrEqual(.55 - 1e-8)
          expect(Math.abs(p.x - center) + p.width / 2).toBeLessThanOrEqual(section.pitch / 2 - .35)
          if (p.kind === 'chair') expect(section.depth).toBeGreaterThanOrEqual(1.12)
        }
      }
    }
  }
  expect(populated).toBeGreaterThan(100)
  expect(empty).toBeGreaterThan(populated)
  expect([...kinds].sort()).toEqual(['chair', 'plant', 'table'])
  expect(tints.size).toBe(3)
})

test('balcony furnishing detail has bounded near/far transitions with hysteresis', () => {
  expect(balconyLifeLod(19, 2)).toBe(0)
  expect(balconyLifeLod(22, 0)).toBe(0)
  expect(balconyLifeLod(22, 1)).toBe(1)
  expect(balconyLifeLod(45, 1)).toBe(1)
  expect(balconyLifeLod(45, 2)).toBe(2)
  expect(balconyLifeLod(49, 0)).toBe(2)
})

test('Blender furniture keeps native foot height and metric bounds across both LODs', () => {
  const bytes = readFileSync(new URL('../../public/assets/buildings/balcony-life.glb', import.meta.url))
  expect(bytes.length).toBeLessThan(24000)
  const gltf = JSON.parse(bytes.subarray(20, 20 + bytes.readUInt32LE(12)).toString())
  expect(gltf.scenes).toHaveLength(1); expect(gltf.meshes).toHaveLength(4)
  for (const kind of ['chair', 'table']) for (const lod of [0, 1]) {
    const node = gltf.nodes.find((n: {name: string}) => n.name === `balcony_${kind}_lod${lod}`)
    const mesh = gltf.meshes[node.mesh].primitives[0]
    const a = gltf.accessors[mesh.attributes.POSITION]
    // The exporter writes glTF Y-up coordinates directly into these primitives.
    expect(a.min[1]).toBeCloseTo(0, 6)
    expect(a.max[1]).toBeCloseTo(kind === 'chair' ? .82 : .6, 6)
    expect(a.max[0] - a.min[0]).toBeCloseTo(kind === 'chair' ? .46 : .32, 6)
    expect(a.max[2] - a.min[2]).toBeCloseTo(kind === 'chair' ? .38 : .3, 6)
    expect(gltf.accessors[mesh.indices].count / 3).toBeLessThanOrEqual(kind === 'chair' ? 120 : 60)
  }
})
