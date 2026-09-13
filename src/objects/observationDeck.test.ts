import { expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import * as THREE from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { getCityGroundHeight, getOverlookTower } from './cityLayout'
import { hasObservationDeck, observationDeckColliders, observationDeckPoint, ObservationDeck } from './observationDeck'
import { collideSphereWithBuildings } from '../sim/cityCollision'
import { CivicDetails } from './civicDetails'
import data from './observationDeckGeometry.json'

async function load() {
  const b = readFileSync(new URL('../../public/assets/observation-deck.glb', import.meta.url))
  return (await new GLTFLoader().parseAsync(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength), '')).scene
}
const vector = (p: ReturnType<typeof observationDeckPoint>, radius: number) =>
  new THREE.Vector3(Math.cos(p.azimuth) * (radius - p.height), p.axial, Math.sin(p.azimuth) * (radius - p.height))

test('Blender landmark retains its metric deck at three bounded, texture-free LODs', async () => {
  const scene = await load(); scene.updateMatrixWorld(true)
  expect(scene.children).toHaveLength(3)
  for (let i = 0; i < 3; i++) {
    const node = scene.getObjectByName(`observation_deck_lod${i}`) as THREE.Mesh
    expect(node.isMesh).toBe(true)
    expect((node.material as THREE.MeshStandardMaterial).map).toBeNull()
    expect(node.geometry.hasAttribute('color')).toBe(true)
    expect((node.geometry.index!.count / 3)).toBe([4864, 1120, 160][i])
    const bounds = new THREE.Box3().setFromObject(node)
    expect(bounds.min.y).toBeCloseTo(0, 5)
    expect(bounds.max.x).toBeCloseTo(12, 5)
    expect(bounds.min.x).toBeCloseTo(-12, 5)
    expect(bounds.max.y).toBeCloseTo(i === 2 ? 58.5 : 59.715, 3)
  }
})

test('upper rail corners have no open wedge at either detailed LOD', async () => {
  const scene = await load(); scene.updateMatrixWorld(true)
  for (let lod = 0; lod < 2; lod++) {
    const mesh = scene.getObjectByName(`observation_deck_lod${lod}`) as THREE.Mesh
    const joints = lod === 0 ? 48 : 24
    for (let i = 0; i < joints; i++) for (const radius of [11.41, 11.45, 11.49]) {
      const angle = i * Math.PI * 2 / joints
      const ray = new THREE.Raycaster(new THREE.Vector3(radius * Math.cos(angle), 60, radius * Math.sin(angle)), new THREE.Vector3(0, -1, 0), 0, 1)
      const hit = ray.intersectObject(mesh)[0]
      expect(hit).toBeDefined()
      expect(hit.point.y).toBeCloseTo(59.715, 3)
    }
  }
})

test('authored floor rays and the physical support agree around the deck across colony radii', async () => {
  const scene = await load(), node = scene.getObjectByName('observation_deck_lod0') as THREE.Mesh
  node.updateWorldMatrix(true, false)
  const geometry = node.geometry.clone().applyMatrix4(node.matrixWorld)
  for (const radius of [3200, 5700, 30000]) {
    const tower = getOverlookTower(radius), colliders = observationDeckColliders(tower, radius)
    expect(colliders).toHaveLength(52)
    expect(colliders.filter(c => c.groundSurface)).toHaveLength(1)
    const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }))
    const c = Math.cos(tower.azimuth), s = Math.sin(tower.azimuth)
    mesh.position.set(c * radius, tower.axial, s * radius)
    mesh.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(new THREE.Vector3(-s, 0, c), new THREE.Vector3(-c, 0, -s), new THREE.Vector3(0, -1, 0)))
    mesh.updateMatrixWorld(true)
    for (const x of [-10, -6, 0, 6, 10]) for (const z of [-9, -4, 0, 4, 9]) {
      if (Math.hypot(x, z) > 10.8) continue
      const p = observationDeckPoint(tower, radius, x, tower.height, z)
      const out = new THREE.Vector3(Math.cos(p.azimuth), 0, Math.sin(p.azimuth))
      const origin = vector(p, radius).addScaledVector(out, -1)
      const hit = new THREE.Raycaster(origin, out, 0, 1.1).intersectObject(mesh)[0]
      expect(hit).toBeDefined()
      const height = getCityGroundHeight(colliders, radius, p.azimuth, p.axial, p.height, .1)
      expect(Math.abs(height - (radius - Math.hypot(hit.point.x, hit.point.z)))).toBeLessThan(.003)
      expect(height).toBeGreaterThan(58.48)
      expect(getCityGroundHeight(colliders, radius, p.azimuth, p.axial, 0)).toBe(0)
    }
    const outside = observationDeckPoint(tower, radius, 12.6, tower.height, 0)
    expect(getCityGroundHeight(colliders, radius, outside.azimuth, outside.axial, tower.height)).toBe(0)
    mesh.material.dispose()
  }
  geometry.dispose()
})

test('guardrail blocks a walking body around its full circumference while the interior and underside stay distinct', () => {
  const radius = 3200, tower = getOverlookTower(radius), colliders = observationDeckColliders(tower, radius)
  const blocked = (x: number, h: number, z: number) => collideSphereWithBuildings(
    vector(observationDeckPoint(tower, radius, x, h, z), radius), new THREE.Vector3(), colliders,
    { habitatRadius: radius, sphereRadius: .32, restitution: 0 })
  for (let i = 0; i < 96; i++) {
    const a = i * Math.PI * 2 / 96
    expect(blocked(11.3 * Math.cos(a), 59.1, 11.3 * Math.sin(a))).toBe(true)
    expect(blocked(10.8 * Math.cos(a), 59.1, 10.8 * Math.sin(a))).toBe(false)
  }
  expect(blocked(8, 56.06, 0)).toBe(true)
  expect(blocked(8, 40, 0)).toBe(false)
})

test('observation bench uses the deck floor and a clear standing exit', () => {
  for (const radius of [3200, 5700, 30000]) {
    const tower = getOverlookTower(radius), details = new CivicDetails(new THREE.Group())
    details.rebuild({ buildings: [], roads: [], patches: [], trees: [], intersections: [], tower, expressway: null }, radius)
    const seat = details.seats.find(s => s.id === 'observation-bench')!
    expect(seat).toBeDefined()
    const colliders = [...observationDeckColliders(tower, radius), ...details.colliders]
    expect(getCityGroundHeight(colliders, radius, seat.exit.azimuth, seat.exit.axialPosition, seat.groundHeight!)).toBeCloseTo(seat.groundHeight!, 3)
    const centre = vector({ azimuth: seat.exit.azimuth, axial: seat.exit.axialPosition, height: seat.groundHeight! + .4 }, radius)
    expect(collideSphereWithBuildings(centre, new THREE.Vector3(), colliders, { habitatRadius: radius, sphereRadius: .32, restitution: 0 })).toBe(false)
    expect(seat.seatHeight! - seat.groundHeight!).toBeCloseTo(.53)
    details.dispose()
  }
})

test('missing-asset fallback retains support and habitat changes hide it without changing tiny playgrounds', () => {
  const parent = new THREE.Group(), deck = new ObservationDeck(parent)
  deck.setPlan(getOverlookTower(3200), 3200)
  expect(deck.group.visible).toBe(true); expect(deck.group.userData.asset).toBe('fallback')
  const lod = deck.group.children[0] as THREE.LOD
  expect(lod.levels).toHaveLength(3)
  expect(lod.levels[0].object).toBeInstanceOf(THREE.Mesh)
  expect(data.colliders.some(c => c.ground)).toBe(true)
  deck.setPlan(getOverlookTower(18), 18)
  expect(deck.group.visible).toBe(false)
  expect(hasObservationDeck(null, 3200)).toBe(false)
  expect(observationDeckColliders(getOverlookTower(18), 18)).toEqual([])
  deck.dispose(); expect(parent.children).toHaveLength(0)
})
