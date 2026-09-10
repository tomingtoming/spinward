import { expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import * as THREE from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import contract from '../../assets/blender/cafe-pilot.json'
import { cafePilotDistance, cafePilotPoint, matchesCafePilot, selectCafeLod } from './cafePilot'
import { createBuildingInterior, interiorPartBuilding } from './buildingInteriors'
import type { CityBuilding } from './cityLayout'

const radius = contract.habitat.radius
const building = contract.interior.building as CityBuilding
const interior = createBuildingInterior(building, 'cafe')

test('authored pilot only replaces its original lot and dimensions', () => {
  expect(matchesCafePilot(interior, radius)).toBe(true)
  expect(contract.interior.parts).toEqual(interior.parts)
  for (const key of ['azimuth', 'axial', 'width', 'depth', 'height'] as const) {
    expect(matchesCafePilot(createBuildingInterior({ ...building, [key]: building[key] + 0.01 }, 'cafe'), radius)).toBe(false)
  }
  expect(matchesCafePilot(interior, 1600)).toBe(false)
  expect(matchesCafePilot(createBuildingInterior(building, 'passage'), radius)).toBe(false)
})

test('pilot distance includes the roof, wraps azimuth, and measures beyond the envelope', () => {
  expect(cafePilotDistance(interior, radius, building.azimuth, building.axial, building.height)).toBe(0)
  expect(cafePilotDistance(interior, radius, building.azimuth + Math.PI * 2, building.axial, 2)).toBe(0)
  expect(cafePilotDistance(interior, radius, building.azimuth, building.axial, building.height + 130)).toBeCloseTo(130)
  expect(cafePilotDistance(interior, radius, building.azimuth, building.axial - building.depth / 2 - 130, 2)).toBeCloseTo(130)
})

test('curved GLB coordinates agree with existing collision centres for every front direction', () => {
  for (const axis of ['axial', 'tangent'] as const) for (const side of [-1, 1] as const) {
    const sample = createBuildingInterior({ ...building, front: { axis, side } }, 'cafe')
    for (const part of sample.parts) {
      const box = interiorPartBuilding(sample, part, radius)
      const expected = new THREE.Vector3(Math.cos(box.azimuth) * (radius - part.y), box.axial, Math.sin(box.azimuth) * (radius - part.y))
      expect(cafePilotPoint(sample, radius, new THREE.Vector3(part.x, part.y, part.z)).distanceTo(expected)).toBeLessThan(1e-9)
    }
  }
})

test('exported GLB contains only the metre-scale pilot and preserves its walk-through portal', async () => {
  const data = readFileSync(new URL('../../public/assets/buildings/cafe-pilot.glb', import.meta.url))
  const jsonLength = data.readUInt32LE(12)
  const json = JSON.parse(data.subarray(20, 20 + jsonLength).toString())
  expect(json.images).toHaveLength(1)
  const imageView = json.bufferViews[json.images[0].bufferView]
  const imageOffset = 28 + jsonLength + (imageView.byteOffset ?? 0)
  expect(data.subarray(imageOffset, imageOffset + imageView.byteLength).equals(
    readFileSync(new URL('../../assets/blender/cafe-pilot-ao.png', import.meta.url)))).toBe(true)
  expect(json.materials.every((material: { occlusionTexture?: unknown }) => material.occlusionTexture)).toBe(true)
  // Geometry assertions run without browser image decoding. Keep the original
  // binary geometry chunk; remove only texture references from this test copy.
  for (const material of json.materials) delete material.occlusionTexture
  data.fill(32, 20, 20 + jsonLength)
  data.write(JSON.stringify(json), 20)
  const gltf = await new GLTFLoader().parseAsync(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength), '')
  gltf.scene.updateMatrixWorld(true)
  const bounds = new THREE.Box3().setFromObject(gltf.scene)
  expect(bounds.min.y).toBeCloseTo(0, 3)
  expect(bounds.max.y).toBeCloseTo(building.height, 3)
  expect(bounds.getSize(new THREE.Vector3()).x).toBeLessThan(building.width + 0.2)
  expect(bounds.min.z).toBeGreaterThan(-building.depth / 2 - 0.1)
  expect(bounds.max.z).toBeLessThan(building.depth / 2 + 0.75)
  let primitives = 0
  gltf.scene.traverse(object => { if (object instanceof THREE.Mesh) primitives++ })
  expect(primitives).toBe(8)
  const ray = new THREE.Raycaster()
  const hitDistance = (x: number, y: number) => {
    ray.set(new THREE.Vector3(x, y, interior.depth / 2 + 2), new THREE.Vector3(0, 0, -1))
    return ray.intersectObject(gltf.scene, true)[0]?.distance ?? Infinity
  }
  for (const x of [-1.5, 0, 1.5]) expect(hitDistance(x, 1.6)).toBeGreaterThan(5)
  expect(hitDistance(1.7, 1.6)).toBeLessThan(3)
  expect(hitDistance(0, 3.15)).toBeLessThan(3)
})


test('LOD selection is stable across approach/retreat and includes altitude', () => {
  expect(selectCafeLod(24, 2)).toBe(0)
  expect(selectCafeLod(29, 0)).toBe(0)
  expect(selectCafeLod(31, 0)).toBe(1)
  expect(selectCafeLod(26, 1)).toBe(1)
  expect(selectCafeLod(121, 1)).toBe(1)
  expect(selectCafeLod(145, 1)).toBe(2)
  expect(selectCafeLod(121, 2)).toBe(2)
  expect(selectCafeLod(119, 2)).toBe(1)
  expect(selectCafeLod(cafePilotDistance(interior, radius, building.azimuth, building.axial, building.height + 10))).toBe(0)
  expect(selectCafeLod(cafePilotDistance(interior, radius, building.azimuth, building.axial, building.height + 200))).toBe(2)
})

test('Blender LODs reduce actual exported geometry while preserving the portal and roof', async () => {
  const data = readFileSync(new URL('../../public/assets/buildings/cafe-pilot-lods.glb', import.meta.url))
  const length = data.readUInt32LE(12), json = JSON.parse(data.subarray(20, 20 + length).toString())
  // A stale packed image once survived a rebake: verify actual embedded bytes.
  for (const channel of ['albedo', 'orm', 'emission']) {
    const expected = readFileSync(new URL(`../../assets/blender/cafe-lod-${channel}.png`, import.meta.url))
    expect(json.images.some((image: { bufferView: number }) => {
      const view = json.bufferViews[image.bufferView], start = 28 + length + (view.byteOffset ?? 0)
      return data.subarray(start, start + view.byteLength).equals(expected)
    })).toBe(true)
  }
  const stripTextures = (object: Record<string, unknown>) => {
    for (const key of Object.keys(object)) {
      if (key.endsWith('Texture')) delete object[key]
      else if (object[key] && typeof object[key] === 'object') stripTextures(object[key] as Record<string, unknown>)
    }
  }
  const facade = json.materials.find((material: { name: string }) => material.name === 'SWCP_BAKED_LIGHT')
  expect(facade.pbrMetallicRoughness.metallicRoughnessTexture).toBeDefined()
  expect(json.textures[facade.pbrMetallicRoughness.metallicRoughnessTexture.index].source).toBe(
    json.textures[facade.occlusionTexture.index].source)
  json.materials.forEach(stripTextures)
  data.fill(32, 20, 20 + length); data.write(JSON.stringify(json), 20)
  const gltf = await new GLTFLoader().parseAsync(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength), '')
  gltf.scene.updateMatrixWorld(true)
  for (const [level, maximum] of [[1, 3000], [2, 400]]) {
    const model = gltf.scene.getObjectByName(`cafe_pilot_lod${level}`)!
    expect(model).toBeDefined()
    const bounds = new THREE.Box3().setFromObject(model)
    expect(bounds.min.y).toBeCloseTo(0, 3)
    expect(bounds.max.y).toBeCloseTo(building.height, 3)
    expect(bounds.max.z).toBeCloseTo(interior.depth / 2 + 0.66, 3)
    let triangles = 0
    model.traverse(object => {
      if (object instanceof THREE.Mesh) triangles += (object.geometry.index?.count ?? object.geometry.getAttribute('position').count) / 3
    })
    expect(triangles).toBeLessThanOrEqual(maximum)
    const ray = new THREE.Raycaster()
    for (const x of [-1.5, 0, 1.5]) {
      ray.set(new THREE.Vector3(x, 1.6, interior.depth / 2 + 2), new THREE.Vector3(0, 0, -1))
      expect(ray.intersectObject(model, true)[0]?.distance ?? Infinity).toBeGreaterThan(5)
    }
    ray.set(new THREE.Vector3(0, building.height + 1, 0), new THREE.Vector3(0, -1, 0))
    expect(ray.intersectObject(model, true)[0]?.distance).toBeLessThan(1.3)
  }
})
