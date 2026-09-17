import * as THREE from 'three'
import { citySurfaceVertices } from '../objects/citySurfaceMesh'
import { getCityGroundHeight, type CityBuilding, type CityCollisionIndex } from '../objects/cityLayout'
import { landscapeColliders } from './authoredLandscape'
import type { LandscapeData, LandscapeMaterial } from './landscapeData'
import { landscapeTexture, landscapeUVs } from './landscapeMaterials'
import { ColonyCollisionCache } from './colonyCollisionCache'

export type ColonyPackedMesh = { vertices: number[]; meshes: Record<string, number[]>; surfaces: { indices: number[]; bounds: [number, number, number, number]; groundSurface?: boolean }[]; mid?: ColonyPackedMesh }
export type ColonyBox = [number, number, number, number, number, number, number, string]
export type ColonyProxyPart = [...ColonyBox, 'box' | 'gable']
export type ColonyTile = { id: string; url: string; band: number; bounds: [number, number, number, number]; districts: string[]; boxes: ColonyBox[]; proxyParts?: ColonyProxyPart[]; architecture?: boolean }
export type ColonyManifest = { version: 1; radius: number; span: number; palette: Record<string, string>; base: ColonyPackedMesh; tiles: ColonyTile[];
  materialDetails?: Record<string, LandscapeMaterial>;
  architecture?: { version: 1; fixed: ColonyPackedMesh; solids: [number, number, number, number, number, number, number][];
    counts: { buildings: number; nearTriangles: number; midTriangles: number; fixedTriangles: number; surfaceGroups: number } };
  structures?: [number, number, number, number, number, number, number][];
  visits: Record<string, { band: number; position: [number, number] }> }

export const COLONY_NEAR_DISTANCE = 850
export const COLONY_MID_DISTANCE = 2600
export const COLONY_TILE_CACHE = 18
export const COLONY_LOAD_CONCURRENCY = 3

export function readColonyManifest(value: unknown): ColonyManifest {
  const p = value as ColonyManifest
  const finiteTuple = (v: unknown, size: number) => Array.isArray(v) && v.length === size && v.every(Number.isFinite)
  if (p?.version !== 1 || p.radius !== 3200 || p.span !== 40000 || !Array.isArray(p.tiles) || !p.base || !p.palette || !p.visits) throw Error('Invalid colony manifest')
  const ids = new Set<string>()
  for (const box of p.structures ?? []) if (!finiteTuple(box, 7) || box[3] <= 0 || box[4] <= 0 || box[5] <= 0) throw Error('Invalid colony structure')
  for (const tile of p.tiles) {
    if (ids.has(tile.id) || !/^\/landscapes\/izma\/[a-z0-9-]+\.json$/.test(tile.url) || !finiteTuple(tile.bounds, 4) || !Array.isArray(tile.boxes)) throw Error('Invalid colony tile')
    ids.add(tile.id)
    for (const box of tile.boxes) if (box.length !== 8 || !box.slice(0, 7).every(Number.isFinite) || !p.palette[box[7]] || box[3] <= 0 || box[4] <= 0 || box[5] <= 0) throw Error('Invalid colony box')
    for (const box of tile.proxyParts ?? []) if (box.length !== 9 || !box.slice(0, 7).every(Number.isFinite) || !p.palette[box[7]] || !['box', 'gable'].includes(box[8]) || box[3] <= 0 || box[4] <= 0 || box[5] <= 0) throw Error('Invalid colony proxy')
  }
  return p
}

export function decodeColonyMesh(packed: ColonyPackedMesh, includeSurfaces = true) {
  if (!Array.isArray(packed.vertices) || packed.vertices.length % 3 || !packed.vertices.every(Number.isFinite)) throw Error('Invalid colony vertices')
  const expand = (indices: number[]) => {
    if (!Array.isArray(indices) || indices.length % 3) throw Error('Incomplete colony triangle')
    const values: number[] = []
    for (const i of indices) {
      if (!Number.isInteger(i) || i < 0 || i * 3 + 2 >= packed.vertices.length) throw Error('Colony vertex index out of bounds')
      values.push(packed.vertices[i * 3], packed.vertices[i * 3 + 1], packed.vertices[i * 3 + 2])
    }
    return values
  }
  return { meshes: Object.fromEntries(Object.entries(packed.meshes).map(([name, indices]) => [name, expand(indices)])),
    surfaces: includeSurfaces ? packed.surfaces.map(s => ({ bounds: s.bounds, vertices: expand(s.indices), groundSurface: s.groundSurface })) : [] }
}

export function colonyTileDistance(tile: ColonyTile, radius: number, azimuth: number, axial: number) {
  const [x0, y0, x1, y1] = tile.bounds
  const x = (x0 + x1) / 2
  const dx = Math.abs(Math.atan2(Math.sin(azimuth - x / radius), Math.cos(azimuth - x / radius)) * radius)
  return Math.hypot(Math.max(0, dx - (x1 - x0) / 2), Math.max(0, Math.abs(axial - (y0 + y1) / 2) - (y1 - y0) / 2))
}

export function colonyColliders(manifest: ColonyManifest, surfaces = decodeColonyMesh(manifest.base).surfaces,
  architectureSurfaces = manifest.architecture ? decodeColonyMesh(manifest.architecture.fixed).surfaces : []): CityBuilding[] {
  return [...landscapeColliders({ surfaces: [...surfaces, ...architectureSurfaces], solids: [] }, manifest.radius), ...colonySolidColliders(manifest)]
}

function colonySolidColliders(manifest: ColonyManifest): CityBuilding[] {
  const buildings = manifest.architecture ? manifest.architecture.solids.map(([x, y, z, width, depth, height, yaw]) => ({ x, y, z, width, depth, height, yaw })) :
    manifest.tiles.flatMap(t => t.boxes.map(([x, y, z, width, depth, height, yaw]) => ({ x, y, z: z - 1.2, width, depth, height: height + 1.2, yaw })))
  return landscapeColliders({ surfaces: [], solids: [
    ...buildings,
    ...(manifest.structures ?? []).map(([x, y, z, width, depth, height, yaw]) => ({ x, y, z, width, depth, height, yaw }))
  ] }, manifest.radius)
}

type TileState = { group: THREE.Group; near: THREE.Group; mid?: THREE.Group; used: number }
type Proxy = { tile: ColonyTile; box: ColonyBox | ColonyProxyPart; mesh: THREE.InstancedMesh; instance: number; matrix: THREE.Matrix4; visible: boolean }
type FetchTile = (url: string, signal: AbortSignal) => Promise<ColonyPackedMesh>
const fetchTile: FetchTile = async (url, signal) => {
  const response = await fetch(url, { signal })
  if (!response.ok) throw Error(`Colony tile ${response.status}: ${url}`)
  return response.json()
}

/** Always-present terrain and collision descriptors, bounded collision expansion
 * and independently fetched building tiles. Failed/late detail leaves the coarse body visible and solid.
 * All coordinates remain in the existing co-rotating habitat root. */
export class AuthoredColony {
  readonly group = new THREE.Group()
  private manifest: ColonyManifest | null = null
  private materials = new Map<string, THREE.MeshStandardMaterial>()
  private textures = new Map<string, THREE.Texture>()
  private surfaceKinds = new Map<string, NonNullable<LandscapeMaterial['surface']>>()
  private proxies: Proxy[] = []
  private loaded = new Map<string, TileState>()
  private pending = new Map<string, AbortController>()
  private failed = new Map<string, { attempts: number; retryAt: number; message: string }>()
  private wanted: ColonyTile[] = []
  private generation = 0
  private clock = 0
  private lastFocus = { azimuth: Infinity, axial: Infinity, altitude: Infinity }
  private collisionCache = new ColonyCollisionCache()
  private colliders: CityBuilding[] = []
  private emissive: { material: THREE.MeshStandardMaterial; intensity: number }[] = []
  private daylight = 1

  constructor(parent: THREE.Group, private loadTile: FetchTile = fetchTile) {
    this.group.name = 'authored-colony'; parent.add(this.group)
  }

  rebuild(manifest: ColonyManifest | null, appearance?: Pick<LandscapeData, 'palette' | 'materialDetails'>) {
    this.clear(); this.manifest = manifest
    if (!manifest) return
    if (manifest.version !== 1 || manifest.radius !== 3200 || manifest.span !== 40000) throw Error('Unsupported colony envelope')
    // The study and its extension share surface colour and metre-based UVs;
    // a tile boundary must not appear as a different river or grass rectangle.
    const shared: Record<string, string> = { earth: 'earth', reserve: 'earth', verge: 'earth', water: 'water',
      arterial: 'road', local: 'road', expressway: 'road', walk: 'walk' }
    for (const [name, color] of Object.entries(manifest.palette)) {
      const source = shared[name], detail = manifest.materialDetails?.[name]
      const surface = detail?.surface ?? appearance?.materialDetails?.[source]?.surface
      if (surface) {
        if (!this.textures.has(surface)) this.textures.set(surface, landscapeTexture(surface))
        this.surfaceKinds.set(name, surface)
      }
      const material = new THREE.MeshStandardMaterial({ color: appearance?.palette[source] ?? color,
        roughness: name === 'water' ? .28 : .93, metalness: name === 'water' ? .12 : 0,
        side: THREE.DoubleSide, map: surface ? this.textures.get(surface) : null })
      if (detail?.emission) {
        material.emissive.set(detail.emission.color)
        this.emissive.push({ material, intensity: detail.emission.intensity })
      }
      this.materials.set(name, material)
    }
    const base = decodeColonyMesh(manifest.base, false)
    this.colliders = [...this.collisionCache.colliders(manifest.base, manifest.radius),
      ...(manifest.architecture ? this.collisionCache.colliders(manifest.architecture.fixed, manifest.radius) : []),
      ...colonySolidColliders(manifest)]
    this.group.add(this.createMeshes(base.meshes, 'colony-base'))
    if (manifest.architecture) {
      const fixed = decodeColonyMesh(manifest.architecture.fixed, false)
      this.group.add(this.createMeshes(fixed.meshes, 'colony-parcel-ground'))
    }
    const boxes = manifest.tiles.flatMap(tile => (tile.proxyParts ?? tile.boxes).map(box => ({ tile, box })))
    const rotation = new THREE.Quaternion(), localYaw = new THREE.Quaternion(), axis = new THREE.Vector3(0, 1, 0)
    for (const name of this.materials.keys()) for (const shape of ['box', 'gable'] as const) {
      const entries = boxes.filter(b => b.box[7] === name && (b.box[8] ?? 'box') === shape)
      if (!entries.length) continue
      const geometry = shape === 'box' ? new THREE.BoxGeometry(1, 1, 1) : new THREE.BufferGeometry()
        .setAttribute('position', new THREE.Float32BufferAttribute([-.5, -.5, -.5, .5, -.5, -.5, 0, .5, -.5, -.5, -.5, .5, .5, -.5, .5, 0, .5, .5], 3))
        .setIndex([0, 2, 1, 3, 4, 5, 0, 3, 5, 0, 5, 2, 2, 5, 4, 2, 4, 1, 0, 1, 4, 0, 4, 3])
      geometry.computeVertexNormals()
      const mesh = new THREE.InstancedMesh(geometry, this.materials.get(name), entries.length)
      mesh.name = 'colony-proxy-' + name + (shape === 'gable' ? '-gable' : ''); mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
      entries.forEach(({ tile, box }, instance) => {
        const [x, y, z, width, depth, height, yaw] = box, a = x / manifest.radius
        const tangent = new THREE.Vector3(-Math.sin(a), 0, Math.cos(a)), up = new THREE.Vector3(-Math.cos(a), 0, -Math.sin(a))
        rotation.setFromRotationMatrix(new THREE.Matrix4().makeBasis(tangent, up, new THREE.Vector3(0, -1, 0)))
        rotation.multiply(localYaw.setFromAxisAngle(axis, yaw))
        const skirt = tile.proxyParts ? 0 : 1.2
        const radial = manifest.radius - z - (height - skirt) / 2
        const matrix = new THREE.Matrix4().compose(new THREE.Vector3(Math.cos(a) * radial, y, Math.sin(a) * radial),
          rotation, new THREE.Vector3(width, height + skirt, depth))
        mesh.setMatrixAt(instance, matrix); this.proxies.push({ tile, box, mesh, instance, matrix, visible: true })
      })
      mesh.computeBoundingSphere(); this.group.add(mesh)
    }
    this.group.userData = { world: 'izma', scope: manifest.architecture ? 'whole-colony terrain and district architecture' : 'whole-colony terrain and initial massing', tiles: manifest.tiles.length,
      loaded: 0, pending: 0, failed: [], near: 0, mid: 0, far: 0, baseTriangles: Object.values(base.meshes).reduce((n, a) => n + a.length / 9, 0),
      parcelGroundTriangles: manifest.architecture?.counts.fixedTriangles ?? 0, collisionCache: this.collisionCache.stats }
    this.setDaylight(this.daylight)
  }

  getColliders() { return this.colliders }

  visit(kind: string, index: CityCollisionIndex) {
    const point = this.manifest?.visits[kind]
    if (!point || !this.manifest) return null
    const azimuth = point.band * Math.PI * 2 / 3 + point.position[0] / this.manifest.radius, axial = point.position[1]
    const groundHeight = getCityGroundHeight(index, this.manifest.radius, azimuth, axial, 400)
    const up = new THREE.Vector3(-Math.cos(azimuth), 0, -Math.sin(azimuth))
    const eye = up.clone().multiplyScalar(-(this.manifest.radius - groundHeight - 1.8)); eye.y = axial
    const target = eye.clone().add(new THREE.Vector3(0, 40, 0))
    return { azimuth, axial, groundHeight, orientation: new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().lookAt(eye, target, up)) }
  }

  private createMeshes(meshes: Record<string, number[]>, name: string) {
    for (const material of Object.keys(meshes)) if (!this.materials.has(material)) throw Error('Unknown colony material: ' + material)
    const group = new THREE.Group(); group.name = name
    for (const [material, positions] of Object.entries(meshes)) {
      const mat = this.materials.get(material)
      if (!mat) throw Error('Unknown colony material: ' + material)
      const geometry = new THREE.BufferGeometry().setAttribute('position', new THREE.BufferAttribute(citySurfaceVertices(positions, this.manifest!.radius), 3))
      geometry.translate(this.manifest!.radius, 0, 0)
      const surface = this.surfaceKinds.get(material)
      if (surface) geometry.setAttribute('uv', new THREE.BufferAttribute(landscapeUVs(positions, surface), 2))
      geometry.computeVertexNormals(); geometry.computeBoundingSphere()
      const mesh = new THREE.Mesh(geometry, mat); mesh.name = name + '-' + material
      group.add(mesh)
    }
    return group
  }

  update(azimuth: number, axial: number, altitude: number) {
    if (!this.manifest) return
    const previous = this.lastFocus
    if (Math.hypot((azimuth - previous.azimuth) * this.manifest.radius, axial - previous.axial, altitude - previous.altitude) < 20) {
      this.pump(); return
    }
    this.lastFocus = { azimuth, axial, altitude }; this.clock++
    const candidates = this.manifest.tiles.map(tile => ({ tile, distance: Math.hypot(colonyTileDistance(tile, this.manifest!.radius, azimuth, axial), Math.max(0, altitude - 150)) }))
      .sort((a, b) => a.distance - b.distance)
    this.wanted = candidates.filter(t => t.distance < (t.tile.architecture ? COLONY_MID_DISTANCE : COLONY_NEAR_DISTANCE)).slice(0, COLONY_TILE_CACHE).map(t => t.tile)
    const wanted = new Set(this.wanted.map(t => t.id))
    for (const [id, state] of this.loaded) {
      state.group.visible = wanted.has(id)
      if (state.group.visible) { state.used = this.clock; this.selectLOD(state, candidates.find(c => c.tile.id === id)!.distance) }
    }
    this.refreshProxies()
    this.pump(); this.stats()
  }

  private refreshProxies() {
    if (!this.manifest) return
    const hidden = new THREE.Matrix4().makeScale(0, 0, 0), { azimuth, axial } = this.lastFocus
    for (const p of this.proxies) {
      const distance = colonyTileDistance(p.tile, this.manifest.radius, azimuth, axial)
      const loaded = this.loaded.get(p.tile.id)
      const visible = !loaded?.group.visible && (!!p.tile.proxyParts || distance < COLONY_MID_DISTANCE || p.box[5] >= 14)
      if (visible === p.visible) continue
      p.visible = visible; p.mesh.setMatrixAt(p.instance, visible ? p.matrix : hidden); p.mesh.instanceMatrix.needsUpdate = true
    }
  }

  private pump() {
    if (!this.manifest) return
    const now = Date.now()
    for (const tile of this.wanted) {
      if (this.pending.size >= COLONY_LOAD_CONCURRENCY) break
      const fail = this.failed.get(tile.id)
      if (this.loaded.has(tile.id) || this.pending.has(tile.id) || (fail && (fail.attempts >= 3 || fail.retryAt > now))) continue
      const controller = new AbortController(), generation = this.generation
      this.pending.set(tile.id, controller)
      void this.loadTile(tile.url, controller.signal).then(packed => {
        if (generation !== this.generation) return
        const decoded = decodeColonyMesh(packed)
        const decodedMid = packed.mid ? decodeColonyMesh(packed.mid) : undefined
        for (const name of [...Object.keys(decoded.meshes), ...Object.keys(decodedMid?.meshes ?? {})]) {
          if (!this.materials.has(name)) throw Error('Unknown colony material: ' + name)
        }
        const near = this.createMeshes(decoded.meshes, 'colony-tile-' + tile.id + '-near')
        const mid = decodedMid ? this.createMeshes(decodedMid.meshes, 'colony-tile-' + tile.id + '-mid') : undefined
        const group = new THREE.Group(); group.name = 'colony-tile-' + tile.id
        group.add(near); if (mid) group.add(mid)
        group.visible = this.wanted.some(t => t.id === tile.id)
        const state = { group, near, mid, used: this.clock }
        this.selectLOD(state, Math.hypot(colonyTileDistance(tile, this.manifest!.radius, this.lastFocus.azimuth, this.lastFocus.axial), Math.max(0, this.lastFocus.altitude - 150)))
        this.group.add(group); this.loaded.set(tile.id, state)
        this.failed.delete(tile.id)
        while (this.loaded.size > COLONY_TILE_CACHE) {
          const candidate = [...this.loaded].filter(([, s]) => !s.group.visible).sort((a, b) => a[1].used - b[1].used)[0]
          if (!candidate) break
          this.disposeGroup(candidate[1].group); this.loaded.delete(candidate[0])
        }
        this.refreshProxies()
      }).catch(error => {
        if (generation !== this.generation || controller.signal.aborted) return
        this.failed.set(tile.id, { attempts: (fail?.attempts ?? 0) + 1, retryAt: Date.now() + 5000, message: String(error) })
      }).finally(() => {
        if (generation !== this.generation) return
        this.pending.delete(tile.id); this.stats(); this.pump()
      })
    }
  }

  private stats() {
    this.group.userData.loaded = this.loaded.size; this.group.userData.pending = this.pending.size
    this.group.userData.near = [...this.loaded.values()].filter(s => s.group.visible && s.near.visible).length
    this.group.userData.mid = [...this.loaded.values()].filter(s => s.group.visible && s.mid?.visible).length
    this.group.userData.far = (this.manifest?.tiles.length ?? 0) - this.group.userData.near - this.group.userData.mid
    this.group.userData.failed = [...this.failed].map(([id, f]) => ({ id, attempts: f.attempts, message: f.message }))
  }

  private selectLOD(state: TileState, distance: number) {
    // A small hysteresis keeps a façade from alternating when standing still
    // near the level boundary. Both levels come from the same saved building.
    const threshold = COLONY_NEAR_DISTANCE + (state.near.visible ? 60 : -60)
    state.near.visible = !state.mid || distance < threshold
    if (state.mid) state.mid.visible = !state.near.visible
  }
  setDaylight(value: number) {
    this.daylight = THREE.MathUtils.clamp(value, 0, 1)
    const night = THREE.MathUtils.smoothstep(1 - this.daylight, .3, .85)
    for (const { material, intensity } of this.emissive) material.emissiveIntensity = intensity * night
  }
  private disposeGroup(group: THREE.Object3D) {
    group.traverse(o => { if (o instanceof THREE.Mesh) o.geometry.dispose() }); group.removeFromParent()
  }
  clear() {
    this.generation++
    for (const controller of this.pending.values()) controller.abort()
    this.pending.clear(); this.loaded.clear(); this.failed.clear(); this.wanted = []
    this.group.traverse(o => { if (o instanceof THREE.Mesh) o.geometry.dispose(); if (o instanceof THREE.InstancedMesh) o.dispose() })
    for (const material of this.materials.values()) material.dispose()
    for (const texture of this.textures.values()) texture.dispose()
    this.textures.clear(); this.surfaceKinds.clear()
    this.collisionCache.clear(); this.colliders = []
    this.group.clear(); this.group.userData = {}; this.materials.clear(); this.proxies = []; this.emissive = []
    this.manifest = null; this.lastFocus = { azimuth: Infinity, axial: Infinity, altitude: Infinity }
  }
  dispose() { this.clear(); this.group.removeFromParent() }
}
