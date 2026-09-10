import * as THREE from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import contract from '../../assets/blender/cafe-pilot.json'
import lobbyContract from '../../assets/blender/lobby-pilot.json'
import type { BuildingInterior, InteriorPart } from './buildingInteriors'
import { wrapBuildingAngleToPi } from './buildingLod'

export type AuthoredPilotSpec = {
  id: 'cafe' | 'lobby' | 'nyaan'
  radius: number
  kind: BuildingInterior['kind']
  building: typeof contract.interior.building
  asset: string
  nodePrefix: string
}
export const CAFE_PILOT: AuthoredPilotSpec = {
  id: 'cafe', radius: contract.habitat.radius, kind: 'cafe', building: contract.interior.building,
  asset: '/assets/buildings/cafe-pilot-runtime.glb', nodePrefix: 'cafe_runtime_lod'
}
export const LOBBY_PILOT: AuthoredPilotSpec = {
  id: 'lobby', radius: lobbyContract.habitat.radius, kind: 'passage', building: lobbyContract.interior.building,
  asset: '/assets/buildings/lobby-pilot-runtime.glb', nodePrefix: 'lobby_runtime_lod'
}

// Authoring is tied to two exact lots; arbitrary footprints must not be stretched.
export function matchesAuthoredPilot(interior: BuildingInterior, radius: number, spec: AuthoredPilotSpec) {
  const b = interior.building, target = spec.building
  return radius === spec.radius && interior.kind === spec.kind &&
    b.front?.axis === target.front.axis && b.front.side === target.front.side &&
    (['azimuth', 'axial', 'width', 'depth', 'height'] as const).every(key => Math.abs(b[key] - target[key]) < 1e-6)
}
export function matchesCafePilot(interior: BuildingInterior, radius: number) {
  return matchesAuthoredPilot(interior, radius, CAFE_PILOT)
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

export type CafeLod = 0 | 1 | 2

// Distances are from the complete envelope, with 20% exit hysteresis.
// No upper cutoff here: Cityscape retains ownership of the coarse near grid.
export function selectCafeLod(distance: number, previous: CafeLod = 2): CafeLod {
  if (distance <= (previous === 0 ? 30 : 25)) return 0
  if (distance <= (previous <= 1 ? 144 : 120)) return 1
  return 2
}

export class AuthoredBuildingPilot {
  readonly group = new THREE.Group()
  interior: BuildingInterior | null = null
  private sources: Array<THREE.Object3D | null> = [null, null, null]
  private assets: THREE.Group[] = []
  private loading = false
  private requested = false
  private disposed = false
  private radius = 1
  private daylight = 1
  private level: CafeLod | -1 = -1
  private selection: CafeLod = 2
  private groups = [new THREE.Group(), new THREE.Group(), new THREE.Group()]
  private fades = this.groups.map(() => ({ fraction: { value: 1 }, inverse: { value: 0 } }))
  private transition: { from: CafeLod; to: CafeLod; started: number } | null = null
  private readonly params = new URLSearchParams(window.location.search)
  private readonly enabled: boolean
  private readonly forced: CafeLod | null
  constructor(parent: THREE.Group, private readonly invalidate: () => void, private readonly spec: AuthoredPilotSpec = CAFE_PILOT) {
    this.enabled = this.params.get(`${spec.id}Model`) !== '0'
    const forced = this.params.get(`${spec.id}Lod`)
    this.forced = this.params.has('debug') && /^[012]$/.test(forced ?? '') ? Number(forced) as CafeLod : null
    this.group.name = `blender-${spec.id}-pilot`
    this.group.visible = false
    this.groups.forEach((group, i) => { group.name = `${spec.id}-lod-${i}`; group.visible = false; this.group.add(group) })
    parent.add(this.group)
  }
  rebuild(interiors: BuildingInterior[], radius: number) {
    this.clearGeometry()
    this.radius = radius
    this.interior = this.enabled ? interiors.find(interior => matchesAuthoredPilot(interior, radius, this.spec)) ?? null : null
    if (!this.interior) return
    this.mount()
    if (this.requested || this.loading) return
    this.requested = true; this.loading = true
    new GLTFLoader().load(this.spec.asset, gltf => {
      this.loading = false
      if (this.disposed) { this.releaseAssets([gltf.scene]); return }
      this.assets.push(gltf.scene)
      this.sources = [0, 1, 2].map(level => gltf.scene.getObjectByName(`${this.spec.nodePrefix}${level}`) ?? null)
      this.mount(); this.invalidate()
    }, undefined, error => {
      this.loading = false
      console.warn(`${this.spec.id} LOD unavailable; retaining procedural fallback.`, error)
    })
  }

  private mount() {
    this.clearGeometry()
    if (!this.interior) return
    const interior = this.interior
    const origin = cafePilotPoint(interior, this.radius, new THREE.Vector3())
    this.group.position.copy(origin)
    this.sources.forEach((source, level) => {
      if (!source) return
      source.updateWorldMatrix(true, true)
      const materials = new Map<THREE.Material, THREE.Material>()
      source.traverse(object => {
        if (!(object instanceof THREE.Mesh)) return
        const geometry = object.geometry.clone().applyMatrix4(object.matrixWorld)
        const positions = geometry.getAttribute('position'), point = new THREE.Vector3()
        for (let i = 0; i < positions.count; i++) {
          point.fromBufferAttribute(positions, i)
          cafePilotPoint(interior, this.radius, point).sub(origin)
          positions.setXYZ(i, point.x, point.y, point.z)
        }
        geometry.computeVertexNormals(); geometry.computeBoundingSphere()
        const clone = (sourceMaterial: THREE.Material) => {
          let material = materials.get(sourceMaterial)
          if (material) return material
          material = sourceMaterial.clone()
          material.onBeforeCompile = shader => {
            shader.uniforms.cafeFraction = this.fades[level].fraction
            shader.uniforms.cafeInverse = this.fades[level].inverse
            shader.fragmentShader = 'uniform float cafeFraction; uniform float cafeInverse;\n' + shader.fragmentShader
            shader.fragmentShader = shader.fragmentShader.replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>
              float cafeNoise = fract(sin(dot(floor(gl_FragCoord.xy), vec2(12.9898, 78.233))) * 43758.5453);
              if (cafeInverse < 0.5 ? cafeNoise >= cafeFraction : cafeNoise < cafeFraction) discard;`)
          }
          material.customProgramCacheKey = () => 'cafe-lod-dither-v1'
          materials.set(sourceMaterial, material)
          return material
        }
        const mesh = new THREE.Mesh(geometry, Array.isArray(object.material) ? object.material.map(clone) : clone(object.material))
        mesh.name = object.name; mesh.castShadow = true; mesh.receiveShadow = true
        this.groups[level].add(mesh)
      })
    })
    this.setDaylight(this.daylight)
  }
  update(azimuth: number, axial: number, altitude: number) {
    const previous = this.level
    const distance = this.interior ? cafePilotDistance(this.interior, this.radius, azimuth, axial, altitude) : Infinity
    const wanted = this.forced ?? selectCafeLod(distance, this.selection)
    this.selection = wanted
    let next: CafeLod | -1 = this.interior && this.groups[wanted].children.length ? wanted : -1
    // Keep the original procedural cafe if a needed distant model fails. A
    // high-detail fallback is bounded to the old 144m pilot promotion range.
    if (next < 0 && this.interior && distance <= 144 && this.groups[0].children.length) next = 0
    if (next !== previous) {
      this.transition = next !== -1 && previous !== -1 && this.forced === null
        ? { from: previous, to: next, started: performance.now() } : null
      this.level = next
    }
    this.groups.forEach((group, i) => {
      group.visible = i === this.level
      this.fades[i].fraction.value = 1; this.fades[i].inverse.value = 0
    })
    if (this.transition) {
      const { from, to, started } = this.transition
      const fraction = Math.min(1, (performance.now() - started) / 240)
      if (fraction >= 1) this.transition = null
      else {
        this.groups[from].visible = this.groups[to].visible = true
        this.fades[from].fraction.value = this.fades[to].fraction.value = fraction
        this.fades[from].inverse.value = 1
      }
    }
    this.group.visible = this.level >= 0
    this.group.userData.lod = this.level
    this.group.userData.distance = distance
    this.group.userData.transitioning = !!this.transition
    return previous !== this.level
  }
  replaces(interior: BuildingInterior, part: InteriorPart) {
    return this.group.visible && this.interior === interior && (this.level === 0 || part.detail >= 2)
  }
  setDaylight(daylight: number) {
    this.daylight = daylight
    this.group.traverse(object => {
      if (!(object instanceof THREE.Mesh)) return
      for (const material of (Array.isArray(object.material) ? object.material : [object.material])) {
        if (!(material instanceof THREE.MeshStandardMaterial)) continue
        if (material.name.endsWith('LIGHT')) material.emissiveIntensity = 0.08 + (1 - daylight) * 0.8
        if (material.name.endsWith('SHOP_GLASS')) material.emissiveIntensity = 0.025 + (1 - daylight) * 0.32
        // Low-cost indoor bounce for the apartment; the upper shell and glass stay dark.
        if (/^SWNY_(plaster|concrete|wood|fabric|ivory|red|blue|paper|tile)$/.test(material.name)) {
          material.emissiveIntensity = 1 + (1 - daylight) * 5
        }
      }
    })
  }
  private clearGeometry() {
    const materials = new Set<THREE.Material>()
    for (const group of this.groups) {
      for (const object of [...group.children]) {
        if (object instanceof THREE.Mesh) {
          object.geometry.dispose()
          for (const material of Array.isArray(object.material) ? object.material : [object.material]) materials.add(material)
        }
        object.removeFromParent()
      }
      group.visible = false
    }
    materials.forEach(material => material.dispose())
    this.group.visible = false; this.level = -1; this.transition = null
  }
  private releaseAssets(assets: THREE.Group[]) {
    const materials = new Set<THREE.Material>(), textures = new Set<THREE.Texture>()
    for (const asset of assets) asset.traverse(object => {
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
    this.disposed = true; this.clearGeometry(); this.releaseAssets(this.assets)
    this.assets = []; this.sources = [null, null, null]; this.interior = null
    this.group.removeFromParent()
  }
}
