import { expect, test } from 'bun:test'
import { BufferAttribute, BufferGeometry, DoubleSide, Group, Mesh, MeshBasicMaterial, Raycaster, Vector3 } from 'three'
import raw from './generated/izmaColony.json'
import plan from '../../assets/blender/izma-public-spaces.json'
import { IZMA_MASTER_PLAN } from './izmaMasterPlan'
import { AuthoredColony, colonyColliders, decodeColonyMesh, readColonyManifest } from './authoredColony'
import { buildCityCollisionIndex, collectCityBuildingsInWindow, getCityGroundHeight, type CityBuilding } from '../objects/cityLayout'
import { citySurfaceVertices } from '../objects/citySurfaceMesh'
import { AuthoredLandscape, LANDSCAPE_LIGHT_BUDGET } from './authoredLandscape'
import { unpackLandscapeLibrary } from './landscapeData'
import worldRaw from './generated/worldLandscapes.json'

const manifest = readColonyManifest(raw)
const physics = buildCityCollisionIndex(colonyColliders(manifest), 3200, 40000)
function mesh(positions: number[]) {
  const geometry = new BufferGeometry().setAttribute('position', new BufferAttribute(citySurfaceVertices(positions, 3200), 3))
  geometry.translate(3200, 0, 0)
  return new Mesh(geometry, new MeshBasicMaterial({ side: DoubleSide }))
}
function height(drawing: Mesh, x: number, y: number, ceiling = 400) {
  const outward = new Vector3(Math.cos(x / 3200), 0, Math.sin(x / 3200))
  const origin = outward.clone().multiplyScalar(3200 - ceiling); origin.y = y
  const hit = new Raycaster(origin, outward, 0, ceiling + 20).intersectObject(drawing)[0]
  expect(hit, `drawn support at ${x},${y}`).toBeDefined()
  return 3200 - Math.hypot(hit.point.x, hit.point.z)
}
function dispose(drawing: Mesh) { drawing.geometry.dispose(); (drawing.material as MeshBasicMaterial).dispose() }

test('every district has a distinct named public place and a continuous road-to-square walk', () => {
  expect(plan.places.map(p => p.id).sort()).toEqual(IZMA_MASTER_PLAN.districts.map(d => d.id).sort())
  expect(new Set(plan.places.map(p => p.layout)).size).toBe(7)
  const ground = mesh(Object.values(decodeColonyMesh(manifest.publicRealm!.fixed).meshes).flat())
  const base = decodeColonyMesh(manifest.base, false)
  const roads = mesh(['local', 'arterial', 'walk'].flatMap(name => base.meshes[name] ?? []))
  const near = new Set<CityBuilding>()
  try {
    for (const p of plan.places) {
      expect(p.centreDistance, p.id).toBeLessThan(750)
      const roadHeight = height(roads, p.entry[0], p.entry[1])
      expect(p.entry[2] - roadHeight, p.id).toBeGreaterThan(-.015)
      expect(p.entry[2] - roadHeight, p.id).toBeLessThan(.11)
      const path = [...p.walkSamples, p.target]
      for (let i = 1; i < path.length; i++) for (const t of [.01, .25, .5, .75, .99]) {
        const a = path[i - 1], b = path[i]
        const x = a[0] + (b[0] - a[0]) * t, y = a[1] + (b[1] - a[1]) * t
        const drawn = height(ground, x, y)
        const actual = getCityGroundHeight(physics, 3200, x / 3200, y, drawn + .1)
        expect(Math.abs(actual - drawn), `${p.id} walk ${i}`).toBeLessThan(.015)
        expect(Math.abs(b[2] - a[2]) / Math.hypot(b[0] - a[0], b[1] - a[1]), p.id).toBeLessThan(.085)
        near.clear(); collectCityBuildingsInWindow(physics, x / 3200, y, 1, near)
        expect(near.size, p.id).toBeLessThanOrEqual(32)
        expect([...near].reduce((n, b) => n + (b.surfaceMesh?.length ?? 0) / 9, 0), p.id).toBeLessThanOrEqual(4096)
      }
      // Both sides of the threshold have the same drawing, not only its axis.
      for (const u of [-1.9, 0, 1.9]) {
        const heights = [-.02, .02].map(offset => {
          const v = -p.size[1] / 2 + offset
          return height(ground, p.position[0] + Math.cos(p.yaw) * u - Math.sin(p.yaw) * v,
            p.position[1] + Math.sin(p.yaw) * u + Math.cos(p.yaw) * v)
        })
        expect(Math.abs(heights[0] - heights[1]), p.id).toBeLessThan(.018)
      }
    }
  } finally { dispose(ground); dispose(roads) }
})

test('nearby-square resolves on each strip, faces into its plaza and stays below the shelter', () => {
  const colony = new AuthoredColony(new Group(), async () => ({ vertices: [], meshes: {}, surfaces: [] }))
  colony.rebuild(manifest)
  try {
    for (const p of plan.places) {
      colony.update(p.entry[0] / 3200, p.entry[1], p.entry[2])
      const visit = colony.visit('public', physics)!
      expect(visit).not.toBeNull()
      expect(visit.azimuth * 3200).toBeCloseTo(p.entry[0], 4)
      expect(visit.axial).toBeCloseTo(p.entry[1], 4)
      expect(visit.groundHeight).toBeCloseTo(p.entry[2], 1)
      const forward = new Vector3(0, 0, -1).applyQuaternion(visit.orientation)
      const a = p.entry[0] / 3200, du = p.target[0] - p.entry[0], dy = p.target[1] - p.entry[1]
      expect(forward.dot(new Vector3(-Math.sin(a) * du, dy, Math.cos(a) * du).normalize())).toBeGreaterThan(.99)
    }
    expect(colony.group.userData.publicPlaces).toBe(18)
    expect(colony.group.getObjectByName('colony-public-ground')).toBeDefined()
    expect(manifest.tiles.filter(t => t.publicRealm)).toHaveLength(18)
  } finally { colony.dispose() }
})

test('public fixtures share the six-light pool and illuminate all strips across azimuth wrapping', () => {
  const layer = new AuthoredLandscape(new Group()), library = unpackLandscapeLibrary(worldRaw)
  const lights = manifest.publicRealm!.lights!
  expect(lights).toHaveLength(54)
  layer.rebuild('izma', library.izma, 3200, lights)
  try {
    const pool = layer.group.children.filter(o => o.type === 'PointLight')
    expect(pool).toHaveLength(LANDSCAPE_LIGHT_BUDGET)
    layer.setDaylight(0)
    for (const p of plan.places) for (const revolution of [-1, 0, 1]) {
      layer.update(p.entry[0] / 3200 + revolution * Math.PI * 2, p.entry[1], p.entry[2] + 1.8)
      expect(layer.group.userData.activeLights, p.id).toBeGreaterThan(0)
      expect(layer.group.userData.activeLights).toBeLessThanOrEqual(LANDSCAPE_LIGHT_BUDGET)
    }
    layer.setDaylight(1)
    expect(layer.group.userData.activeLights).toBe(0)
    layer.rebuild('cooper', library.cooper, 3200)
    expect(layer.group.children.filter(o => o.type === 'PointLight')).toHaveLength(0)
  } finally { layer.dispose() }
})
