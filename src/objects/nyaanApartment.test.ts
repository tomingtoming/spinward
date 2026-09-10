import { expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import * as THREE from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { NYAAN_APARTMENT as contract, planNyaanApartment, apartmentShelter } from './nyaanApartment'
import { planCity, type CityBuilding } from './cityLayout'
import { planBuildingInteriors } from './buildingInteriors'

const radius = contract.habitat.radius
const building = contract.interior.building as CityBuilding
const interior = planNyaanApartment([building], radius)!
const front = interior.depth / 2

test('Nyaan occupies exactly one existing desktop lot without replacing a public interior', () => {
  const plan = planCity(contract.habitat)
  const room = planNyaanApartment(plan.buildings, radius)!
  expect(room).not.toBeNull()
  expect(room.building).toBe(plan.buildings.find(b => b === room.building))
  expect(planBuildingInteriors(plan.buildings, radius).has(room.building)).toBe(false)
  expect(room.building.access?.width).toBeGreaterThanOrEqual(1.52)
  for (const key of ['azimuth', 'axial', 'width', 'depth', 'height'] as const) {
    expect(planNyaanApartment([{ ...building, [key]: building[key] + .01 }], radius)).toBeNull()
  }
  expect(planNyaanApartment([building], 1600)).toBeNull()
  expect(planNyaanApartment([{ ...building, front: { axis: 'axial', side: 1 } }], radius)).toBeNull()
})

test('a player capsule clears the street, room doorway, desk approach and bathroom route', () => {
  const route = [[0, front + 2.5], [0, contract.room.doorZ], [-1.85, contract.room.doorZ],
    [-1.85, front - 2], [-1.85, contract.room.doorZ], [-2.05, contract.room.doorZ],
    [-2.05, front - 5.95], [-3, front - 5.95]]
  // Sweep the entire standing capsule's horizontal footprint, including low furniture.
  const obstacles = interior.parts.filter(p => p.solid && p.y + p.height / 2 > .32 && p.y - p.height / 2 < 2)
  for (let i = 1; i < route.length; i++) for (let step = 0; step <= 100; step++) {
    const t = step / 100, x = route[i - 1][0] * (1 - t) + route[i][0] * t
    const z = route[i - 1][1] * (1 - t) + route[i][1] * t
    for (const p of obstacles) {
      const dx = Math.max(0, Math.abs(x - p.x) - p.width / 2)
      const dz = Math.max(0, Math.abs(z - p.z) - p.depth / 2)
      expect(Math.hypot(dx, dz), `${p.name} at ${x}, ${z}`).toBeGreaterThan(.33)
    }
  }
})

test('shelter follows the room and entrance, excluding street, side wall and roof', () => {
  const sample = (x: number, z: number, altitude = 1.8, wrap = 0) =>
    apartmentShelter(interior, radius, building.azimuth + x / radius + wrap, building.axial - z, altitude)
  expect(sample(-2, contract.room.doorZ)).toBe(1)
  expect(sample(-2, contract.room.doorZ, 1.8, Math.PI * 2)).toBe(1)
  expect(sample(0, front)).toBeCloseTo(.75)
  expect(sample(0, front + .6)).toBeCloseTo(0)
  expect(sample(-2, front)).toBe(0)
  expect(sample(interior.frontage, 0)).toBe(0)
  expect(sample(0, 0, building.height + 1)).toBe(0)
})

test('the exported apartment preserves traversable portals, a transparent solid window and three bounded LODs', async () => {
  const data = readFileSync(new URL('../../public/assets/buildings/nyaan-apartment.glb', import.meta.url))
  expect(data.byteLength).toBeLessThan(1_000_000)
  const gltf = await new GLTFLoader().parseAsync(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength), '')
  gltf.scene.updateMatrixWorld(true)
  const budgets = [11500, 1100, 800]
  for (let level = 0; level < 3; level++) {
    const model = gltf.scene.getObjectByName(`nyaan_runtime_lod${level}`)!
    expect(model).toBeDefined()
    const bounds = new THREE.Box3().setFromObject(model)
    expect(bounds.min.x).toBeGreaterThan(-interior.frontage / 2 - .5)
    expect(bounds.max.x).toBeLessThan(interior.frontage / 2 + .5)
    expect(bounds.max.y).toBeLessThan(building.height + .5)
    expect(bounds.max.y).toBeGreaterThanOrEqual(building.height)
    let triangles = 0
    model.traverse(o => { if (o instanceof THREE.Mesh) triangles += (o.geometry.index?.count ?? o.geometry.attributes.position.count) / 3 })
    expect(triangles).toBeLessThanOrEqual(budgets[level])
    const ray = new THREE.Raycaster(new THREE.Vector3(0, 1.6, front + 2), new THREE.Vector3(0, 0, -1))
    expect(ray.intersectObject(model, true)[0]?.distance ?? Infinity).toBeGreaterThan(10)
    ray.set(new THREE.Vector3(0, 1.6, contract.room.doorZ), new THREE.Vector3(-1, 0, 0))
    expect(ray.intersectObject(model, true)[0]?.distance ?? Infinity).toBeGreaterThan(3)
  }
  const pane = interior.parts.find(p => p.name === 'window-pane')!
  expect(pane.solid).toBe(true)
  let transparentGlass = false
  gltf.scene.getObjectByName('nyaan_runtime_lod0')!.traverse(o => {
    if (!(o instanceof THREE.Mesh)) return
    for (const m of Array.isArray(o.material) ? o.material : [o.material])
      if (m.name === 'SWNY_glass') transparentGlass ||= m.transparent && m.opacity < .3
  })
  expect(transparentGlass).toBe(true)
})

test('real Rapier bathroom passage stays open under the city vehicle inflation setting', async () => {
  const { initRapier } = await import('../physics/rapierContext')
  const { createRotatingCityColliders } = await import('../physics/rotatingCityColliders')
  const { applyWorldLengthUnit, PLAYER_COLLISION_GROUPS } = await import('../physics/rapierBoundary')
  const { createUnitsContext } = await import('../units/units')
  const { buildCityCollisionIndex } = await import('./cityLayout')
  const { interiorCollisionBuildings } = await import('./buildingInteriors')
  const rapier = await initRapier(), scale = .02, units = createUnitsContext(scale)
  const cross = (exact: boolean) => {
    const world = new rapier.World({ x: 0, y: 0, z: 0 })
    applyWorldLengthUnit(world, units)
    const boxes = interiorCollisionBuildings(interior, radius).map(b => exact ? b : { ...b, collisionMargin: undefined })
    const city = createRotatingCityColliders(rapier, world, {
      radius, index: buildCityCollisionIndex(boxes, radius, 40000), units, omega: 0, margin: .25
    })
    try {
      city.update(building.azimuth, building.axial)
      const az = building.azimuth - 2.05 / radius, radial = radius - .6
      const body = world.createRigidBody(rapier.RigidBodyDesc.dynamic()
        .setTranslation(Math.cos(az) * radial * scale, (building.axial - front + 5.95) * scale, Math.sin(az) * radial * scale)
        .setLinvel(Math.sin(az) * scale, 0, -Math.cos(az) * scale).setCcdEnabled(true))
      world.createCollider(rapier.ColliderDesc.ball(.32 * scale).setCollisionGroups(PLAYER_COLLISION_GROUPS), body)
      for (let i = 0; i < 54; i++) { world.timestep = 1 / 60; world.step() }
      const p = body.translation()
      return (Math.atan2(p.z, p.x) - building.azimuth) * radius
    } finally { city.dispose(); world.free() }
  }
  expect(cross(true)).toBeLessThan(-2.8)
  expect(cross(false)).toBeGreaterThan(-2.5)
})
