import * as THREE from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { type CityBuilding, type CityRoad } from './cityLayout'
import { planOldTownBlock, planOldTownCourt, oldTownColliders, oldTownPavingColliders, oldTownLod, type OldTownLot, type OldTownModule, type OldTownPaving } from './oldTownBlockPlan'

const names: (OldTownModule | 'water_tank_lod')[] = ['water_tank', 'water_tank_lod', 'header_tank', 'meter_bank', 'laundry']
type Entry = OldTownLot & { matrix: THREE.Matrix4; level: number }

/** A bounded, instanced detail layer for one Old Town block. Permanent tank
 * colliders do not depend on camera LOD or successful asset loading. */
export class OldTownBlock {
  readonly group = new THREE.Group()
  private entries: Entry[] = []
  private radius = 1
  private focus = new THREE.Vector3(Infinity, Infinity, Infinity)
  private box = new THREE.BoxGeometry(1, 1, 1)
  private material = new THREE.MeshStandardMaterial({ roughness: .88 })
  private coloured = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: .86 })
  private modules = new Map<string, THREE.BufferGeometry>()
  private batches = new Map<string, THREE.InstancedMesh>()
  private paving: THREE.Mesh | null = null
  private pavingPlan: OldTownPaving[] = []
  private disposed = false
  constructor(parent: THREE.Group) {
    this.group.name = 'old-town-services'; parent.add(this.group)
    new GLTFLoader().loadAsync('/assets/buildings/old-town-services.glb').then(g => {
      try {
        if (this.disposed) return
        for (const name of names) {
          const node = g.scene.getObjectByName(name)
          if (!(node instanceof THREE.Mesh)) throw Error('Missing Old Town module ' + name)
          node.updateWorldMatrix(true, false)
          this.modules.set(name, node.geometry.clone().applyMatrix4(node.matrixWorld))
        }
        this.clearBatches(); this.focus.set(Infinity, Infinity, Infinity)
        this.group.userData.ready = true
      } finally {
        g.scene.traverse(o => { if (o instanceof THREE.Mesh) {
          o.geometry.dispose(); for (const m of Array.isArray(o.material) ? o.material : [o.material]) m.dispose()
        } })
      }
    }).catch(e => console.warn('Old Town services unavailable; retaining roof silhouettes.', e))
  }
  rebuild(buildings: CityBuilding[], roads: CityRoad[], radius: number, length: number, interiors: ReadonlyMap<CityBuilding, unknown>, obstacles: CityBuilding[] = []) {
    this.clear(); this.radius = radius
    this.entries = planOldTownBlock(buildings, roads, radius, length, interiors).map(lot => {
      const b = lot.spec.building, a = b.azimuth, side = b.front!.side, tangent = b.front!.axis === 'tangent'
      const x = tangent ? new THREE.Vector3(0, side, 0) : new THREE.Vector3(side * Math.sin(a), 0, -side * Math.cos(a))
      const z = tangent ? new THREE.Vector3(-side * Math.sin(a), 0, side * Math.cos(a)) : new THREE.Vector3(0, side, 0)
      const matrix = new THREE.Matrix4().makeBasis(x, new THREE.Vector3(-Math.cos(a), 0, -Math.sin(a)), z)
        .setPosition(Math.cos(a) * radius, b.axial, Math.sin(a) * radius)
      return { ...lot, matrix, level: 3 }
    })
    this.group.userData.lots = this.entries.length
    this.group.userData.plannedParts = this.entries.reduce((n, e) => n + e.parts.length, 0)
    const court = planOldTownCourt(this.entries, buildings, roads, radius, length, obstacles)
    this.pavingPlan = court
    this.group.userData.court = court
    if (court.length) {
      const positions: number[] = [], colours: number[] = [], colour = new THREE.Color()
      for (const r of court) {
        const columns = Math.ceil(r.tangentWidth / 2.5), rows = Math.ceil(r.axialLength / 2.5)
        for (let i = 0; i < columns; i++) for (let j = 0; j < rows; j++) {
          // Slightly varied concrete pours. Thin inset joints expose the darker
          // soil below instead of laying a second coplanar surface over it.
          const gap = .018
          const a0 = r.azimuth + (-r.tangentWidth / 2 + i * r.tangentWidth / columns + gap) / radius
          const a1 = r.azimuth + (-r.tangentWidth / 2 + (i + 1) * r.tangentWidth / columns - gap) / radius
          const y0 = r.axial - r.axialLength / 2 + j * r.axialLength / rows + gap
          const y1 = r.axial - r.axialLength / 2 + (j + 1) * r.axialLength / rows - gap
          colour.set(['#8c9086', '#92968b', '#898f86'][(i * 7 + j * 3 + i * j) % 3])
          for (const [a, y] of [[a0, y0], [a1, y0], [a1, y1], [a0, y0], [a1, y1], [a0, y1]]) {
            positions.push(Math.cos(a) * (radius - .12), y, Math.sin(a) * (radius - .12))
            colours.push(colour.r, colour.g, colour.b)
          }
        }
      }
      const geometry = new THREE.BufferGeometry()
      geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
      geometry.setAttribute('color', new THREE.Float32BufferAttribute(colours, 3)); geometry.computeVertexNormals(); geometry.computeBoundingSphere()
      this.paving = new THREE.Mesh(geometry, this.coloured); this.paving.name = 'old-town-service-court'
      this.paving.receiveShadow = true; this.group.add(this.paving)
    }
  }
  getColliders() { return [...oldTownColliders(this.entries, this.radius), ...oldTownPavingColliders(this.pavingPlan)] }
  private batch(key: string, geometry: THREE.BufferGeometry, material: THREE.Material) {
    let mesh = this.batches.get(key)
    if (!mesh) {
      const capacity = Math.max(1, this.group.userData.plannedParts ?? 1)
      mesh = new THREE.InstancedMesh(geometry, material, capacity)
      mesh.count = 0
      mesh.name = 'old-town-' + key; mesh.castShadow = true; mesh.receiveShadow = true
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
      this.group.add(mesh); this.batches.set(key, mesh)
    }
    return mesh
  }
  update(azimuth: number, axial: number, altitude: number) {
    const camera = new THREE.Vector3(Math.cos(azimuth) * (this.radius - altitude), axial, Math.sin(azimuth) * (this.radius - altitude))
    if (camera.distanceToSquared(this.focus) < 16) return
    this.focus.copy(camera)
    if (this.paving) this.paving.visible = camera.distanceTo(this.paving.geometry.boundingSphere!.center) < 800
    for (const mesh of this.batches.values()) mesh.count = 0
    const local = new THREE.Matrix4(), world = new THREE.Matrix4(), point = new THREE.Vector3(), size = new THREE.Vector3(), q = new THREE.Quaternion(), tint = new THREE.Color()
    let visible = 0, roofs = 0
    for (const e of this.entries) {
      // Actual part positions include height, so standing on a roof keeps its detail.
      const distance = Math.min(...e.parts.map(p => point.set(p.x, p.y, p.z).applyMatrix4(e.matrix).distanceTo(camera)))
      e.level = oldTownLod(distance, e.level)
      for (const p of e.parts) {
        if (e.level === 3 || (p.range === 'street' && e.level > 0) || (p.module === 'laundry' && e.level > 0)) continue
        const module = e.level === 2 && p.module === 'water_tank' ? 'water_tank_lod' : p.module
        const geometry = e.level < 2 || module === 'water_tank_lod' ? this.modules.get(module) : undefined
        if (!geometry && p.module === 'laundry') continue
        const key = geometry ? module : 'box', mesh = this.batch(key, geometry ?? this.box, geometry ? this.coloured : this.material)
        const y = p.y + (p.module !== 'box' && !geometry ? p.h / 2 : 0)
        q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), p.module === 'meter_bank' ? Math.PI : 0)
        local.compose(point.set(p.x, y, p.z), q, size.set(p.w, p.h, p.d))
        world.multiplyMatrices(e.matrix, local); mesh.setMatrixAt(mesh.count, world)
        tint.set('#' + (geometry || p.module === 'box' ? p.tint : p.module === 'water_tank' ? 'a1a99a' : '82948a'))
        mesh.setColorAt(mesh.count++, tint); visible++; if (p.range === 'roof') roofs++
      }
    }
    for (const mesh of this.batches.values()) {
      mesh.visible = mesh.count > 0; mesh.instanceMatrix.needsUpdate = true
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
      if (mesh.count) mesh.computeBoundingSphere()
    }
    Object.assign(this.group.userData, { visibleParts: visible, visibleRoofParts: roofs, drawCalls: [...this.batches.values()].filter(b => b.visible).length + (this.paving?.visible ? 1 : 0) })
  }
  private clearBatches() { for (const b of this.batches.values()) { b.removeFromParent(); b.dispose() }; this.batches.clear() }
  clear() {
    this.clearBatches(); this.entries = []; this.focus.set(Infinity, Infinity, Infinity); this.group.userData.lots = 0
    this.pavingPlan = []
    if (this.paving) { this.paving.geometry.dispose(); this.paving.removeFromParent(); this.paving = null }
  }
  dispose() {
    this.disposed = true; this.clear(); this.box.dispose(); this.material.dispose(); this.coloured.dispose()
    for (const g of this.modules.values()) g.dispose()
    this.modules.clear(); this.group.removeFromParent()
  }
}
