import * as THREE from 'three'
import { RailService, type RailTrain } from '../gameplay/railService'
import type { ColonyRailData } from '../worlds/colonyRailData'
import type { LandscapeLight, LandscapeMaterial } from '../worlds/landscapeData'

export const RAIL_DETAIL_LIMIT = 3
const up = new THREE.Vector3(), forward = new THREE.Vector3(), right = new THREE.Vector3()
export function railTrainMatrix(train: RailTrain, target = new THREE.Matrix4()) {
  const [x, y, h] = train.position, a = x / 3200, [dx, dy, dz] = train.tangent
  up.set(-Math.cos(a), 0, -Math.sin(a))
  forward.set(-Math.sin(a) * dx, dy, Math.cos(a) * dx).addScaledVector(up, dz).normalize()
  right.crossVectors(up, forward).normalize(); up.crossVectors(forward, right).normalize()
  return target.makeBasis(right, up, forward).setPosition(Math.cos(a) * (3200 - h), y, Math.sin(a) * (3200 - h))
}
export function railTrainDistance(train: RailTrain, azimuth: number, axial: number) {
  const a = train.position[0] / 3200 - azimuth
  return Math.hypot(Math.atan2(Math.sin(a), Math.cos(a)) * 3200, train.position[1] - axial)
}
type Slot = { root: THREE.Group; levels: THREE.Group[]; stripe: THREE.MeshStandardMaterial; id: string | null;
  display?: { group: THREE.Group; texture: THREE.CanvasTexture; material: THREE.MeshBasicMaterial; context: CanvasRenderingContext2D; text: string } }

/** Three reusable detailed vehicles; all other moving cars use two instances.
 * The service clock, passenger and collisions never depend on visual LOD. */
export class ColonyRail {
  readonly group = new THREE.Group()
  service: RailService | null = null
  readonly lightSources: LandscapeLight[] = []
  private data: ColonyRailData | null = null
  private slots: Slot[] = []
  private materials: THREE.MeshStandardMaterial[] = []
  private geometries: THREE.BufferGeometry[] = []
  private farBody: THREE.InstancedMesh | null = null
  private farWindow: THREE.InstancedMesh | null = null
  private matrix = new THREE.Matrix4()
  private transform = new THREE.Matrix4()
  constructor(parent: THREE.Group) { this.group.name = 'colony-trams'; parent.add(this.group) }
  configure(data: ColonyRailData | null, palette: Record<string, string>, details: Record<string, LandscapeMaterial> = {}) {
    if (this.data === data) return false
    this.clear(); this.data = data
    if (!data) return true
    this.service = new RailService(data)
    const mats = new Map<string, THREE.MeshStandardMaterial>()
    for (const name of new Set(Object.values(data.vehicle).flatMap(part => Object.keys(part.meshes)))) {
      const detail = details[name]
      const mat = new THREE.MeshStandardMaterial({ color: palette[name], roughness: .72, side: THREE.DoubleSide,
        opacity: detail?.opacity ?? 1, transparent: detail?.opacity !== undefined, depthWrite: detail?.opacity === undefined })
      if (detail?.emission) { mat.emissive.set(detail.emission.color); mat.userData.emission = detail.emission.intensity }
      mats.set(name, mat); this.materials.push(mat)
    }
    const templates = [0, 1].map(lod => {
      const level = new THREE.Group()
      for (const [id, dataPart] of Object.entries(data.vehicle)) {
        const part = lod === 1 ? dataPart.mid! : dataPart, group = new THREE.Group(); group.name = id
        const door = /^tram-door-(-?1)-(-?1)$/.exec(id)
        if (door) group.userData = { side: Number(door[1]), leaf: Number(door[2]) }
        for (const [name, indices] of Object.entries(part.meshes)) {
          const positions = indices.flatMap(i => [-part.vertices[i * 3], part.vertices[i * 3 + 2], part.vertices[i * 3 + 1]])
          const geometry = new THREE.BufferGeometry().setAttribute('position', new THREE.BufferAttribute(Float32Array.from(positions), 3))
          geometry.computeVertexNormals(); geometry.computeBoundingSphere(); this.geometries.push(geometry)
          const mesh = new THREE.Mesh(geometry, mats.get(name)); mesh.name = name; group.add(mesh)
        }
        level.add(group)
      }
      return level
    })
    for (let i = 0; i < RAIL_DETAIL_LIMIT; i++) {
      const root = new THREE.Group(), levels = templates.map(t => t.clone(true)), stripe = mats.get('rail-rail-a')!.clone()
      this.materials.push(stripe)
      for (const level of levels) level.traverse(o => { if (o instanceof THREE.Mesh && o.name === 'rail-rail-a') o.material = stripe })
      root.add(...levels); root.matrixAutoUpdate = false; this.group.add(root)
      const slot: Slot = { root, levels, stripe, id: null }
      if (typeof document !== 'undefined') {
        const canvas = document.createElement('canvas'); canvas.width = 768; canvas.height = 80
        const context = canvas.getContext('2d')!, texture = new THREE.CanvasTexture(canvas)
        texture.colorSpace = THREE.SRGBColorSpace
        const material = new THREE.MeshBasicMaterial({ map: texture, color: '#c2ccc7' })
        const geometry = new THREE.PlaneGeometry(1.48, .155), group = new THREE.Group(); group.name = 'tram-destination-displays'
        this.geometries.push(geometry)
        for (const side of [-1, 1]) {
          const screen = new THREE.Mesh(geometry, material)
          screen.position.set(-side * (data.configuration.carWidth / 2 - .099), data.configuration.carFloor + 2.27, 0)
          screen.rotation.y = side * Math.PI / 2; group.add(screen)
        }
        root.add(group); slot.display = { group, texture, material, context, text: '' }
      }
      this.slots.push(slot)
    }
    const box = new THREE.BoxGeometry(1, 1, 1); this.geometries.push(box)
    this.farBody = new THREE.InstancedMesh(box, mats.get('rail-body'), this.service.trains.length)
    const dark = new THREE.MeshStandardMaterial({ color: '#3f5558', roughness: .7 }); this.materials.push(dark)
    this.farWindow = new THREE.InstancedMesh(box, dark, this.service.trains.length)
    this.farBody.frustumCulled = false; this.farWindow.frustumCulled = false
    this.group.add(this.farBody, this.farWindow)
    for (const train of this.service.trains) this.lightSources.push({ ...data.vehicleLight, position: [...train.position] })
    return true
  }
  update(dt: number, azimuth: number, axial: number, daylight: number, riding: string | null) {
    const service = this.service, data = this.data
    if (!service || !data) return
    service.step(dt)
    const candidates = service.trains.map(train => ({ train, distance: railTrainDistance(train, azimuth, axial) }))
      .filter(c => c.distance < 900 || c.train.id === riding)
      .sort((a, b) => Number(b.train.id === riding) - Number(a.train.id === riding) || a.distance - b.distance).slice(0, RAIL_DETAIL_LIMIT)
    const detailed = new Set(candidates.map(c => c.train.id))
    this.slots.forEach((slot, i) => {
      const candidate = candidates[i]; slot.root.visible = !!candidate; slot.id = candidate?.train.id ?? null
      if (!candidate) return
      const train = candidate.train; railTrainMatrix(train, slot.root.matrix)
      slot.stripe.color.set(train.line.color)
      if (slot.display) {
        const display = slot.display, text = train.station ? train.station.name : `Next · ${train.next.name}`
        display.group.visible = candidate.distance < 150 || train.id === riding
        if (display.text !== text) {
          display.text = text; const ctx = display.context
          ctx.fillStyle = '#172a2d'; ctx.fillRect(0, 0, 768, 80)
          ctx.fillStyle = '#e6dfc7'; ctx.font = '44px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
          ctx.fillText(text, 384, 42, 720); display.texture.needsUpdate = true
        }
      }
      slot.levels.forEach((level, lod) => {
        level.visible = lod === (candidate.distance < 150 || train.id === riding ? 0 : 1)
        for (const part of level.children) if (part.userData.side) part.position.z = part.userData.leaf * .8 *
          (part.userData.side === -Math.sign(train.lane) ? train.doorOpen : 0)
      })
    })
    const night = THREE.MathUtils.smoothstep(1 - daylight, .3, .85)
    for (const mat of this.materials) if (mat.userData.emission) mat.emissiveIntensity = mat.userData.emission * night
    service.trains.forEach((train, i) => {
      railTrainMatrix(train, this.matrix)
      this.transform.makeTranslation(0, data.configuration.carFloor + 1.2, 0).scale(new THREE.Vector3(data.configuration.carWidth, 2.4, data.configuration.carLength))
      if (detailed.has(train.id)) this.transform.makeScale(0, 0, 0)
      this.farBody!.setMatrixAt(i, this.transform.premultiply(this.matrix))
      this.transform.makeTranslation(0, data.configuration.carFloor + 1.47, 0).scale(new THREE.Vector3(data.configuration.carWidth + .02, 1.08, data.configuration.carLength - 1))
      if (detailed.has(train.id)) this.transform.makeScale(0, 0, 0)
      this.farWindow!.setMatrixAt(i, this.transform.premultiply(this.matrix))
      const light = this.lightSources[i]
      light.position[0] = train.position[0]; light.position[1] = train.position[1]; light.position[2] = train.position[2] + data.vehicleLight.position[2]
    })
    this.farBody!.instanceMatrix.needsUpdate = true; this.farWindow!.instanceMatrix.needsUpdate = true
    this.group.userData = { clock: service.time, trains: service.trains.length, detailed: candidates.length, detailLimit: RAIL_DETAIL_LIMIT }
  }
  hit(trainId: string, raycaster: THREE.Raycaster) {
    const slot = this.slots.find(slot => slot.id === trainId)
    if (!slot) return false
    slot.root.updateWorldMatrix(true, true)
    return raycaster.intersectObject(slot.levels.find(l => l.visible)!, true).length > 0
  }
  clear() {
    this.slots.forEach(s => { s.display?.texture.dispose(); s.display?.material.dispose() })
    this.group.clear(); this.service = null; this.lightSources.length = 0
    this.geometries.forEach(g => g.dispose()); this.materials.forEach(m => m.dispose())
    this.geometries = []; this.materials = []; this.slots = []; this.farBody = null; this.farWindow = null
  }
  dispose() { this.clear(); this.group.removeFromParent() }
}
