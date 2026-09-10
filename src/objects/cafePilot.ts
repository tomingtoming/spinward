import * as THREE from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import contract from '../../assets/blender/cafe-pilot.json'
import type { BuildingInterior } from './buildingInteriors'
import { wrapBuildingAngleToPi } from './buildingLod'

// Stage 1 is one authored lot, not an asset stretched across the whole city.
export function matchesCafePilot(interior: BuildingInterior, radius: number) {
  const b = interior.building, target = contract.interior.building
  return radius === contract.habitat.radius && interior.kind === 'cafe' &&
    b.front?.axis === target.front.axis && b.front.side === target.front.side &&
    (['azimuth', 'axial', 'width', 'depth', 'height'] as const).every(key => Math.abs(b[key] - target[key]) < 1e-6)
}

export function cafePilotDistance(interior: BuildingInterior, radius: number, azimuth: number, axial: number, altitude: number) {
  const b = interior.building
  return Math.hypot(
    Math.max(0, Math.abs(wrapBuildingAngleToPi(azimuth - b.azimuth) * radius) - b.width / 2),
    Math.max(0, Math.abs(axial - b.axial) - b.depth / 2),
    Math.max(0, altitude - b.height, -altitude))
}

// Same front-local convention as interiorPartBuilding, including cylinder curvature.
export function cafePilotPoint(interior: BuildingInterior, radius: number, point: THREE.Vector3) {
  const b = interior.building, front = b.front!
  const tangent = front.axis === 'tangent' ? front.side * point.z : -front.side * point.x
  const axial = front.axis === 'tangent' ? front.side * point.x : front.side * point.z
  const azimuth = b.azimuth + tangent / radius
  return point.set(Math.cos(azimuth) * (radius - point.y), b.axial + axial, Math.sin(azimuth) * (radius - point.y))
}

export class CafePilot {
  readonly group = new THREE.Group()
  interior: BuildingInterior | null = null
  private source: THREE.Group | null = null
  private loading = false
  private disposed = false
  private radius = 1
  private daylight = 1
  private readonly enabled = new URLSearchParams(window.location.search).get('cafeModel') !== '0'
  constructor(parent: THREE.Group, private readonly invalidate: () => void) {
    this.group.name = 'blender-cafe-pilot'
    this.group.visible = false
    parent.add(this.group)
  }
  rebuild(interiors: BuildingInterior[], radius: number) {
    this.clearGeometry()
    this.radius = radius
    this.interior = this.enabled ? interiors.find(interior => matchesCafePilot(interior, radius)) ?? null : null
    if (!this.interior) return
    if (this.source) this.mount()
    else if (!this.loading) {
      this.loading = true
      new GLTFLoader().load('/assets/buildings/cafe-pilot.glb', gltf => {
        this.loading = false
        if (this.disposed) { this.releaseSource(gltf.scene); return }
        this.source = gltf.scene
        this.mount()
        this.invalidate()
      }, undefined, error => {
        this.loading = false
        console.warn('Cafe pilot unavailable; keeping procedural cafe.', error)
      })
    }
  }
  private mount() {
    this.clearGeometry()
    if (!this.source || !this.interior) return
    const interior = this.interior
    const origin = cafePilotPoint(interior, this.radius, new THREE.Vector3())
    this.group.position.copy(origin)
    this.source.updateMatrixWorld(true)
    this.source.traverse(object => {
      if (!(object instanceof THREE.Mesh)) return
      const geometry = object.geometry.clone().applyMatrix4(object.matrixWorld)
      const positions = geometry.getAttribute('position'), point = new THREE.Vector3()
      for (let i = 0; i < positions.count; i++) {
        point.fromBufferAttribute(positions, i)
        cafePilotPoint(interior, this.radius, point).sub(origin)
        positions.setXYZ(i, point.x, point.y, point.z)
      }
      geometry.computeVertexNormals(); geometry.computeBoundingSphere()
      const mesh = new THREE.Mesh(geometry, object.material)
      mesh.name = object.name
      mesh.castShadow = true; mesh.receiveShadow = true
      this.group.add(mesh)
    })
    this.setDaylight(this.daylight)
  }
  update(azimuth: number, axial: number, altitude: number) {
    const previous = this.group.visible
    // Temporary stage-1 promotion range. Authored LOD1/2 follow after review.
    this.group.visible = !!this.interior && this.group.children.length > 0 &&
      cafePilotDistance(this.interior, this.radius, azimuth, axial, altitude) <= (previous ? 144 : 120)
    return previous !== this.group.visible
  }
  replaces(interior: BuildingInterior) { return this.group.visible && this.interior === interior }
  setDaylight(daylight: number) {
    this.daylight = daylight
    this.source?.traverse(object => {
      if (!(object instanceof THREE.Mesh)) return
      for (const material of (Array.isArray(object.material) ? object.material : [object.material])) {
        if (!(material instanceof THREE.MeshStandardMaterial)) continue
        if (material.name.endsWith('LIGHT')) material.emissiveIntensity = 0.08 + (1 - daylight) * 0.8
        if (material.name.endsWith('SHOP_GLASS')) material.emissiveIntensity = 0.025 + (1 - daylight) * 0.32
      }
    })
  }
  private clearGeometry() {
    for (const object of [...this.group.children]) {
      if (object instanceof THREE.Mesh) object.geometry.dispose()
      object.removeFromParent()
    }
    this.group.visible = false
  }
  private releaseSource(source: THREE.Group) {
    const materials = new Set<THREE.Material>()
    const textures = new Set<THREE.Texture>()
    source.traverse(object => {
      if (!(object instanceof THREE.Mesh)) return
      object.geometry.dispose()
      for (const material of (Array.isArray(object.material) ? object.material : [object.material])) materials.add(material)
    })
    materials.forEach(material => {
      Object.values(material).forEach(value => { if (value instanceof THREE.Texture) textures.add(value) })
      material.dispose()
    })
    textures.forEach(texture => texture.dispose())
  }
  dispose() {
    this.disposed = true
    this.clearGeometry()
    if (this.source) this.releaseSource(this.source)
    this.source = null; this.interior = null
    this.group.removeFromParent()
  }
}
