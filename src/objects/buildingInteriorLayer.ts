import {colonyBuildingDesign} from './colonyBuildingDesign'
import {loadColonyModules,colonyFacadeMaterial,prepareColonyGeometry,writeColonyFacade,dirtyColonyFacade} from './colonyBuildingModules'
import { NYAAN_PILOT, apartmentShelter } from './nyaanApartment'
import * as THREE from 'three'
import { AuthoredBuildingPilot, CAFE_PILOT, LOBBY_PILOT } from './cafePilot'
import { RoomDressing } from './roomDressing'
import { getRoadTileLiftMeters } from './roadTiles'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import {
  interiorDistance, interiorPartBuilding, selectBuildingExperienceLod,
  type BuildingExperienceLod, type BuildingInterior, type InteriorPart
} from './buildingInteriors'

const MATERIALS: InteriorPart['material'][] = ['wall', 'upper', 'wood', 'green', 'light', 'sign']

// Six material batches plus a curved floor, independent of room count. No per-building lights,
// geometry generation during traversal. Authored building
// pilots load separately, retaining these batches until their GLB is ready.
export class BuildingInteriorLayer {
  readonly group = new THREE.Group()
  private readonly geometry = new THREE.BoxGeometry(1, 1, 1)
  private structure:THREE.BufferGeometry=this.geometry
  private disposed=false
  private readonly materials: THREE.MeshStandardMaterial[]
  private readonly sign: THREE.CanvasTexture
  private meshes: THREE.InstancedMesh[] = []
  private floor: THREE.Mesh | null = null
  private readonly floorMaterial = new THREE.MeshStandardMaterial({ color: 0x797b75, roughness: 0.95, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 })
  private entries: Array<{ interior: BuildingInterior; lod: BuildingExperienceLod; parts: Array<{ part: InteriorPart; matrix: THREE.Matrix4 }> }> = []
  private readonly pilots: AuthoredBuildingPilot[]
  private readonly roomDressing: RoomDressing
  private radius = 1
  private focus = new THREE.Vector3(Infinity, Infinity, Infinity)

  constructor(parent: THREE.Group) {
    parent.add(this.group)
    this.roomDressing = new RoomDressing(this.group)
    this.pilots = [CAFE_PILOT, LOBBY_PILOT, NYAAN_PILOT].map(spec => new AuthoredBuildingPilot(this.group, () => {
      const { x, y, z } = this.focus
      this.focus.set(Infinity, Infinity, Infinity)
      if (Number.isFinite(x)) this.update(x, y, z)
    }, spec))
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
      new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.85 }),
      colonyFacadeMaterial(false,true),
      new THREE.MeshStandardMaterial({ color: 0x816047, roughness: 0.85 }),
      new THREE.MeshStandardMaterial({ color: 0x557342, roughness: 1 }),
      new THREE.MeshStandardMaterial({ color: 0xffddb0, emissive: 0xffc880, emissiveIntensity: 0.8 }),
      new THREE.MeshStandardMaterial({ map: this.sign, emissiveMap: this.sign, emissive: 0xffffff, emissiveIntensity: 0.35, roughness: 0.8 })
    ]
    loadColonyModules().then(modules=>{if(this.disposed)return;this.structure=modules.structure;for(const [index,mesh] of this.meshes.entries()){if(index===1){mesh.geometry.dispose();mesh.geometry=prepareColonyGeometry(this.structure,mesh.instanceMatrix.count)}else mesh.geometry=this.structure;mesh.count=0};this.focus.set(Infinity,Infinity,Infinity)}).catch(()=>{})
    // Upper floors keep metre-sized windows even on differently sized lots.

  }

  rebuild(interiors: BuildingInterior[], radius: number) {
    this.clear()
    this.radius = radius
    this.pilots.forEach(pilot => pilot.rebuild(interiors, radius))
    this.roomDressing.rebuild(interiors, radius)
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
    this.meshes = this.materials.map((material,index) => {
      const mesh = new THREE.InstancedMesh(index===1?prepareColonyGeometry(this.structure,capacity):this.structure, material, capacity)
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
      mesh.count = 0
      mesh.castShadow = true; mesh.receiveShadow = true
      this.group.add(mesh)
      return mesh
    })
  }

  update(azimuth: number, axial: number, altitude: number) {
    this.roomDressing.update(azimuth, axial, altitude)
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
      this.meshes[index].setMatrixAt(counts[index], matrix)
      if(index<=1){const design=colonyBuildingDesign(entry.interior.building);this.meshes[index].setColorAt(counts[index],new THREE.Color('#'+design.wall));if(index===1)writeColonyFacade(this.meshes[index],counts[index],design)}
      counts[index]++
    }
    this.meshes.forEach((mesh, index) => {
      mesh.count = counts[index]
      mesh.instanceMatrix.needsUpdate = true
      dirtyColonyFacade(mesh);if(mesh.instanceColor)mesh.instanceColor.needsUpdate=true
      mesh.computeBoundingSphere()
    })
  }

  sampleRoomEnvironment(azimuth: number, axial: number, altitude: number) {
    const environment = this.roomDressing.sampleEnvironment(azimuth, axial, altitude)
    const apartment = this.entries.find(entry => entry.interior.kind === 'apartment')?.interior
    if (apartment) environment.shelter = Math.max(environment.shelter, apartmentShelter(apartment, this.radius, azimuth, axial, altitude))
    return environment
  }

  setDaylight(daylight: number) {
    this.materials[1].emissiveIntensity=.015+(1-daylight)*.5
    this.roomDressing.setDaylight(daylight)
    this.pilots.forEach(pilot => pilot.setDaylight(daylight))
    this.materials[4].emissiveIntensity = 0.5 + (1 - daylight) * 1.5
    // A little interior bounce without hundreds of realtime point lights.
    for (const index of [0, 2]) {
      this.materials[index].emissive.setHex(0x8b7355)
      this.materials[index].emissiveIntensity = (1 - daylight) * 0.12
    }
  }

  clear() {
    this.roomDressing.clear()
    this.pilots.forEach(pilot => pilot.rebuild([], this.radius))
    for (const mesh of this.meshes) { if(mesh.geometry.getAttribute('aColonyFacade'))mesh.geometry.dispose();mesh.dispose(); mesh.removeFromParent() }
    if (this.floor) { this.floor.geometry.dispose(); this.floor.removeFromParent(); this.floor = null }
    this.meshes = []; this.entries = []
    this.focus.set(Infinity, Infinity, Infinity)
  }

  dispose() {
    this.disposed=true
    this.roomDressing.dispose()
    this.pilots.forEach(pilot => pilot.dispose()); this.clear(); this.geometry.dispose(); this.sign.dispose(); this.floorMaterial.dispose()
    this.materials.forEach(material => material.dispose())
    this.group.removeFromParent()
  }
}
