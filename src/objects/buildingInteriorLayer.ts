import * as THREE from 'three'
import { AuthoredBuildingPilot, CAFE_PILOT, LOBBY_PILOT } from './cafePilot'
import { getRoadTileLiftMeters } from './roadTiles'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import {
  interiorDistance, interiorPartBuilding, selectBuildingExperienceLod,
  type BuildingExperienceLod, type BuildingInterior, type InteriorPart
} from './buildingInteriors'

const MATERIALS: InteriorPart['material'][] = ['wall', 'upper', 'wood', 'green', 'light', 'sign']

// Six material batches plus a curved floor, independent of room count. No per-building lights,
// transparent sorting, or geometry generation during traversal. Two authored building
// pilots load separately, retaining these batches until its GLB is ready.
export class BuildingInteriorLayer {
  readonly group = new THREE.Group()
  private readonly geometry = new THREE.BoxGeometry(1, 1, 1)
  private readonly materials: THREE.MeshStandardMaterial[]
  private readonly windows: THREE.CanvasTexture
  private readonly sign: THREE.CanvasTexture
  private meshes: THREE.InstancedMesh[] = []
  private floor: THREE.Mesh | null = null
  private readonly floorMaterial = new THREE.MeshStandardMaterial({ color: 0x797b75, roughness: 0.95, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 })
  private entries: Array<{ interior: BuildingInterior; lod: BuildingExperienceLod; parts: Array<{ part: InteriorPart; matrix: THREE.Matrix4 }> }> = []
  private readonly pilots: AuthoredBuildingPilot[]
  private radius = 1
  private focus = new THREE.Vector3(Infinity, Infinity, Infinity)

  constructor(parent: THREE.Group) {
    parent.add(this.group)
    this.pilots = [CAFE_PILOT, LOBBY_PILOT].map(spec => new AuthoredBuildingPilot(this.group, () => {
      const { x, y, z } = this.focus
      this.focus.set(Infinity, Infinity, Infinity)
      if (Number.isFinite(x)) this.update(x, y, z)
    }, spec))
    const canvas = document.createElement('canvas')
    canvas.width = 64; canvas.height = 64
    const ctx = canvas.getContext('2d')!
    ctx.fillStyle = '#a5a79e'; ctx.fillRect(0, 0, 64, 64)
    ctx.fillStyle = '#444f55'; ctx.fillRect(12, 12, 40, 40)
    ctx.fillStyle = '#79817e'; ctx.fillRect(14, 14, 36, 15)
    ctx.fillStyle = '#b9b9aa'; ctx.fillRect(10, 52, 44, 3)
    ctx.fillStyle = '#a5a79e'; ctx.fillRect(30, 12, 3, 40)
    this.windows = new THREE.CanvasTexture(canvas)
    this.windows.colorSpace = THREE.SRGBColorSpace
    this.windows.wrapS = this.windows.wrapT = THREE.RepeatWrapping
    const signCanvas = document.createElement('canvas')
    signCanvas.width = 512; signCanvas.height = 64
    const signCtx = signCanvas.getContext('2d')!
    signCtx.fillStyle = '#283b3c'; signCtx.fillRect(0, 0, 512, 64)
    signCtx.fillStyle = '#f1dfb7'; signCtx.font = 'bold 34px sans-serif'
    signCtx.textAlign = 'center'; signCtx.textBaseline = 'middle'
    signCtx.fillText('OPEN  ·  WALK IN', 256, 33)
    this.sign = new THREE.CanvasTexture(signCanvas)
    this.sign.colorSpace = THREE.SRGBColorSpace
    this.materials = [
      new THREE.MeshStandardMaterial({ color: 0xb9b5a5, roughness: 0.85 }),
      new THREE.MeshStandardMaterial({ map: this.windows, roughness: 0.8 }),
      new THREE.MeshStandardMaterial({ color: 0x816047, roughness: 0.85 }),
      new THREE.MeshStandardMaterial({ color: 0x557342, roughness: 1 }),
      new THREE.MeshStandardMaterial({ color: 0xffddb0, emissive: 0xffc880, emissiveIntensity: 0.8 }),
      new THREE.MeshStandardMaterial({ map: this.sign, emissiveMap: this.sign, emissive: 0xffffff, emissiveIntensity: 0.35, roughness: 0.8 })
    ]
    // Upper floors keep metre-sized windows even on differently sized lots.
    this.materials[1].onBeforeCompile = shader => {
      shader.vertexShader = 'varying vec2 vRoomRepeat; varying float vRoomWall;\n' + shader.vertexShader
      shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
        vec3 size = vec3(length(instanceMatrix[0].xyz), length(instanceMatrix[1].xyz), length(instanceMatrix[2].xyz));
        vRoomRepeat = vec2(abs(normal.x) > 0.5 ? size.z : size.x, size.y) / vec2(2.8, 3.2);
        vRoomWall = 1.0 - abs(normal.y);`)
      shader.fragmentShader = 'varying vec2 vRoomRepeat; varying float vRoomWall;\n' + shader.fragmentShader
      shader.fragmentShader = shader.fragmentShader.replace('#include <map_fragment>', `
        vec4 facade = texture2D(map, vMapUv * vRoomRepeat);
        diffuseColor *= mix(vec4(0.53, 0.55, 0.52, 1.0), facade, vRoomWall);`)
    }
  }

  rebuild(interiors: BuildingInterior[], radius: number) {
    this.clear()
    this.radius = radius
    this.pilots.forEach(pilot => pilot.rebuild(interiors, radius))
    const rotation = new THREE.Quaternion(), scale = new THREE.Vector3(), position = new THREE.Vector3()
    this.entries = interiors.map(interior => ({ interior, lod: 4 as BuildingExperienceLod,
      parts: interior.parts.map(part => {
        const b = interiorPartBuilding(interior, part, radius)
        const c = Math.cos(b.azimuth), s = Math.sin(b.azimuth)
        const basis = new THREE.Matrix4().makeBasis(new THREE.Vector3(-s, 0, c), new THREE.Vector3(-c, 0, -s), new THREE.Vector3(0, -1, 0))
        rotation.setFromRotationMatrix(basis)
        position.set(c, 0, s).multiplyScalar(radius - (b.baseHeight ?? 0) - b.height / 2).setY(b.axial)
        scale.set(b.width, b.height, b.depth)
        return { part, matrix: new THREE.Matrix4().compose(position, rotation, scale) }
      }) }))
    // A curved finish over the existing cylinder collider; no doorway step
    // and no flat slab floating above the floor on smaller habitats.
    const floors = interiors.map(({ building: b }) => {
      const geometry = new THREE.PlaneGeometry(b.width - 0.1, b.depth - 0.1, Math.ceil(b.width / 2), 1)
      const positions = geometry.getAttribute('position')
      for (let i = 0; i < positions.count; i++) {
        const az = b.azimuth + positions.getX(i) / radius
        const axial = b.axial + positions.getY(i)
        positions.setXYZ(i, Math.cos(az) * (radius - getRoadTileLiftMeters(radius)), axial, Math.sin(az) * (radius - getRoadTileLiftMeters(radius)))
      }
      geometry.computeVertexNormals()
      return geometry
    })
    if (floors.length) {
      const geometry = mergeGeometries(floors)
      floors.forEach(floor => floor.dispose())
      if (geometry) { this.floor = new THREE.Mesh(geometry, this.floorMaterial); this.floor.receiveShadow = true; this.group.add(this.floor) }
    }
    const capacity = Math.max(1, this.entries.reduce((sum, entry) => sum + entry.parts.length, 0))
    this.meshes = this.materials.map(material => {
      const mesh = new THREE.InstancedMesh(this.geometry, material, capacity)
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
      mesh.count = 0
      mesh.castShadow = true; mesh.receiveShadow = true
      this.group.add(mesh)
      return mesh
    })
  }

  update(azimuth: number, axial: number, altitude: number) {
    let changed = false
    for (const pilot of this.pilots) if (pilot.update(azimuth, axial, altitude)) changed = true
    if (!changed && Math.hypot((azimuth - this.focus.x) * this.radius, axial - this.focus.y, altitude - this.focus.z) < 1) return
    this.focus.set(azimuth, axial, altitude)
    for (const entry of this.entries) {
      // Near/far ownership belongs to Cityscape's existing coarse grid. Keep
      // the structural shell even when the independently managed room is far.
      const next = selectBuildingExperienceLod(interiorDistance(entry.interior, this.radius, azimuth, axial, altitude), entry.lod)
      if (next !== entry.lod) { entry.lod = next; changed = true }
    }
    if (!changed && this.meshes.some(mesh => mesh.count > 0)) return
    const counts = MATERIALS.map(() => 0)
    for (const entry of this.entries) for (const { part, matrix } of entry.parts) {
      if (this.pilots.some(pilot => pilot.replaces(entry.interior, part))) continue
      if (part.detail < 3 && entry.lod > part.detail) continue
      const index = MATERIALS.indexOf(part.material)
      this.meshes[index].setMatrixAt(counts[index]++, matrix)
    }
    this.meshes.forEach((mesh, index) => {
      mesh.count = counts[index]
      mesh.instanceMatrix.needsUpdate = true
      mesh.computeBoundingSphere()
    })
  }

  setDaylight(daylight: number) {
    this.pilots.forEach(pilot => pilot.setDaylight(daylight))
    this.materials[4].emissiveIntensity = 0.5 + (1 - daylight) * 1.5
    // A little interior bounce without hundreds of realtime point lights.
    for (const index of [0, 2]) {
      this.materials[index].emissive.setHex(0x8b7355)
      this.materials[index].emissiveIntensity = (1 - daylight) * 0.12
    }
  }

  clear() {
    this.pilots.forEach(pilot => pilot.rebuild([], this.radius))
    for (const mesh of this.meshes) { mesh.dispose(); mesh.removeFromParent() }
    if (this.floor) { this.floor.geometry.dispose(); this.floor.removeFromParent(); this.floor = null }
    this.meshes = []; this.entries = []
    this.focus.set(Infinity, Infinity, Infinity)
  }

  dispose() {
    this.pilots.forEach(pilot => pilot.dispose()); this.clear(); this.geometry.dispose(); this.windows.dispose(); this.sign.dispose(); this.floorMaterial.dispose()
    this.materials.forEach(material => material.dispose())
    this.group.removeFromParent()
  }
}
