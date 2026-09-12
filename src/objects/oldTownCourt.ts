import * as THREE from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import { loadBalconyLifeAssets, type BalconyLifeAssets } from './balconyLifeAssets'
import { loadColonyModules, type ColonyModules } from './colonyBuildingModules'
import type { OldTownPaving } from './oldTownBlockPlan'
import { COURT_GROUND, oldTownCourtLod, planOldTownCourtLife, type CourtLifePlan } from './oldTownCourtPlan'

// A single small court. Reuse shared Blender sources; physical seats and pots
// survive loading failures, rebuilds and camera LOD changes.
export class OldTownCourt {
  readonly group = new THREE.Group()
  plan: CourtLifePlan = { props: [], seats: [], colliders: [] }
  private radius = 1
  private level = 2
  private furniture?: BalconyLifeAssets
  private modules?: ColonyModules
  private disposed = false
  private batches: THREE.InstancedMesh[] = []
  private material = new THREE.MeshStandardMaterial({ roughness: .88 })
  private box = new THREE.BoxGeometry(1, 1, 1)
  private leaf = new THREE.IcosahedronGeometry(.5, 0)
  private fallback = (parts: number[][]) => {
    const pieces = parts.map(([x, y, z, w, h, d]) => new THREE.BoxGeometry(w, h, d).translate(x, y, z))
    const g = mergeGeometries(pieces)!; pieces.forEach(p => p.dispose()); return g
  }
  private chair = this.fallback([
    [0, .425, 0, .46, .03, .38], [0, .63, -.166, .46, .38, .035],
    ...[-.195, .195].flatMap(x => [-.15, .15].map(z => [x, .205, z, .035, .41, .035])),
  ])
  private table = this.fallback([[0, .5825, 0, .32, .035, .3], [0, .2825, 0, .045, .565, .045], [0, .025, 0, .27, .05, .25]])
  constructor(parent: THREE.Group) {
    this.group.name = 'old-town-court-life'; parent.add(this.group)
    loadBalconyLifeAssets().then(g => { if (!this.disposed) { this.furniture = g; this.render() } })
      .catch(() => console.warn('Courtyard furniture unavailable; retaining solid fallback seats.'))
    loadColonyModules().then(g => { if (!this.disposed) { this.modules = g; this.render() } }).catch(() => {})
  }
  rebuild(paving: readonly OldTownPaving[], radius: number) {
    this.radius = radius; this.plan = planOldTownCourtLife(paving, radius); this.level = 2; this.render()
  }
  update(azimuth: number, axial: number, altitude: number) {
    const distance = Math.min(...this.plan.props.map(p => Math.hypot(
      Math.atan2(Math.sin(azimuth - p.azimuth), Math.cos(azimuth - p.azimuth)) * this.radius,
      axial - p.axial, altitude - COURT_GROUND)))
    const level = oldTownCourtLod(distance, this.level)
    if (level !== this.level) { this.level = level; this.render() }
  }
  private clearBatches() { for (const b of this.batches) { b.removeFromParent(); b.dispose() }; this.batches = [] }
  private render() {
    this.clearBatches()
    const buckets = new Map<string, { geometry: THREE.BufferGeometry; instances: { matrix: THREE.Matrix4; tint: number }[] }>()
    const add = (name: string, geometry: THREE.BufferGeometry, frame: THREE.Matrix4, y: number, size: number[], tint: number) => {
      if (!buckets.has(name)) buckets.set(name, { geometry, instances: [] })
      const local = new THREE.Matrix4().compose(new THREE.Vector3(0, y, 0), new THREE.Quaternion(), new THREE.Vector3(...size))
      buckets.get(name)!.instances.push({ matrix: frame.clone().multiply(local), tint })
    }
    if (this.level < 2) for (const p of this.plan.props) {
      const a = p.azimuth, c = Math.cos(a), s = Math.sin(a)
      // Furniture's native +Z faces the street (+axial), with +Y radial inward.
      const frame = new THREE.Matrix4().makeBasis(new THREE.Vector3(s, 0, -c), new THREE.Vector3(-c, 0, -s), new THREE.Vector3(0, 1, 0))
        .setPosition(c * (this.radius - COURT_GROUND), p.axial, s * (this.radius - COURT_GROUND))
      if (p.kind === 'plant') {
        const h = p.height * .4
        add('pots', this.modules?.planter ?? this.box, frame, h / 2, [p.width, h, p.depth], [0x786859, 0x8f7963, 0x626f66][p.tint])
        add('leaves', this.modules?.planting ?? this.leaf, frame, h + (p.height - h) / 2 - .04,
          [p.width * .9, p.height - h, p.depth * .9], [0x617750, 0x526b50, 0x788556][p.tint])
      } else add(p.kind, this.furniture?.[`${p.kind}${this.level as 0 | 1}`] ?? (p.kind === 'chair' ? this.chair : this.table),
        frame, 0, [1, 1, 1], [0x7e897e, 0x8b8070, 0x726551][p.tint])
    }
    let triangles = 0
    for (const [name, b] of buckets) {
      const mesh = new THREE.InstancedMesh(b.geometry, this.material, b.instances.length)
      mesh.name = `court-${name}`; mesh.castShadow = true; mesh.receiveShadow = true
      b.instances.forEach((v, i) => { mesh.setMatrixAt(i, v.matrix); mesh.setColorAt(i, new THREE.Color(v.tint)) })
      mesh.computeBoundingSphere(); this.group.add(mesh); this.batches.push(mesh)
      triangles += (b.geometry.index?.count ?? b.geometry.attributes.position.count) / 3 * mesh.count
    }
    Object.assign(this.group.userData, { props: this.plan.props.length, seats: this.plan.seats.length,
      colliders: this.plan.colliders.length, level: this.level, furnitureReady: !!this.furniture,
      plantingReady: !!this.modules, drawCalls: this.batches.length, triangles })
  }
  clear() { this.plan = { props: [], seats: [], colliders: [] }; this.level = 2; this.render() }
  dispose() {
    this.disposed = true; this.clearBatches(); this.material.dispose(); this.box.dispose(); this.leaf.dispose(); this.chair.dispose(); this.table.dispose(); this.group.removeFromParent()
    // Loaded furniture/plant modules belong to their shared caches.
  }
}
