import * as THREE from 'three'
import type { CityBuilding } from '../objects/cityLayout'
import { citySurfaceVertices } from '../objects/citySurfaceMesh'
import type { LandscapeData, LandscapeLight } from './landscapeData'
import type { AuthoredWorldId } from './worldDefinitions'
import { landscapeTexture, landscapeUVs } from './landscapeMaterials'
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js'

export const LANDSCAPE_LIGHT_BUDGET = 6

export function landscapeColliders(data: Pick<LandscapeData, 'surfaces' | 'solids'>, radius: number): CityBuilding[] {
  const surfaces: CityBuilding[] = data.surfaces.map(({ vertices, bounds, groundSurface }) => {
    const x = (bounds[0] + bounds[2]) / 2, y = (bounds[1] + bounds[3]) / 2
    let height = 0
    const surfaceMesh = vertices.map((n, i) => {
      if (i % 3 === 2) { height = Math.max(height, n); return n }
      return n - (i % 3 === 0 ? x : y)
    })
    return { azimuth: x / radius, axial: y, width: bounds[2] - bounds[0], depth: bounds[3] - bounds[1],
      height, surfaceMesh, groundSurface: groundSurface !== false, collisionMargin: 0, groundMargin: 0, kind: 'block', tone: .5 }
  })
  return [...surfaces, ...data.solids.map(s => ({
    azimuth: s.x / radius, axial: s.y, width: s.width, depth: s.depth,
    baseHeight: s.z, height: s.height, yaw: s.yaw,
    collisionMargin: 0, groundMargin: 0, kind: 'block' as const, tone: .5
  }))]
}

/** Per-world content. Physics, coordinates, input and streaming stay shared. */
export class AuthoredLandscape {
  readonly group = new THREE.Group()
  private levels: THREE.Group[] = []
  private materials: THREE.Material[] = []
  private textures: THREE.Texture[] = []
  private emissive: { material: THREE.MeshStandardMaterial; intensity: number }[] = []
  private lightPool: THREE.PointLight[] = []
  private lightSelection: { index: number; fade: number }[] = []
  private lightSources: LandscapeLight[] = []
  private fixedLightCount = 0
  private data: LandscapeData | null = null
  private radius = 1
  private readonly fill = new THREE.DirectionalLight('#fff3dd', 1.2)
  private daylight = 1
  constructor(parent: THREE.Group) {
    this.group.name = 'authored-world-landscape'
    parent.add(this.group)
  }

  rebuild(id: AuthoredWorldId | null, data: LandscapeData | null, radius: number, additionalLights: LandscapeLight[] = []) {
    this.clear(); this.data = data; this.radius = radius
    if (!data || !id) return
    this.lightSources = [...(data.lights ?? []), ...additionalLights]
    this.fixedLightCount = this.lightSources.length
    // Each habitat retains its mirror/end-cap rig; local lights have a fixed
    // shadow-free pool so district growth cannot add unbounded GPU lights.
    this.fill.position.set(0, radius * .25, radius * .4)
    this.fill.target.position.set(radius, 0, 0)
    this.group.add(this.fill, this.fill.target)
    const textures = new Map<string, THREE.DataTexture>()
    const materials = new Map(Object.entries(data.palette).map(([name, color]) => {
      const detail = data.materialDetails?.[name]
      if (detail?.surface && !textures.has(detail.surface)) {
        const texture = landscapeTexture(detail.surface)
        textures.set(detail.surface, texture); this.textures.push(texture)
      }
      const material = new THREE.MeshStandardMaterial({ color, roughness: name === 'water' ? .28 : .93,
        metalness: name === 'water' ? .12 : 0, side: THREE.DoubleSide,
        transparent: detail?.opacity !== undefined, opacity: detail?.opacity ?? 1, depthWrite: detail?.opacity === undefined,
        map: detail?.surface ? textures.get(detail.surface) : null })
      if (detail?.emission) {
        material.emissive.set(detail.emission.color)
        material.emissiveMap = material.map
        this.emissive.push({ material, intensity: detail.emission.intensity })
      }
      this.materials.push(material)
      return [name, material] as const
    }))
    for (const [lod, groups] of data.lods.entries()) {
      const level = new THREE.Group(); level.name = `landscape-lod-${lod}`
      for (const [name, positions] of Object.entries(groups)) {
        let geometry = new THREE.BufferGeometry().setAttribute('position',
          new THREE.BufferAttribute(citySurfaceVertices(positions, radius), 3))
        geometry.translate(radius, 0, 0)
        const surface = data.materialDetails?.[name]?.surface
        if (surface) geometry.setAttribute('uv', new THREE.BufferAttribute(landscapeUVs(positions, surface), 2))
        if (['leaf','leaf_light','leaf_dark'].includes(name) && data.materialDetails) {
          const original = geometry; geometry = mergeVertices(original); original.dispose()
        }
        geometry.computeVertexNormals(); geometry.computeBoundingSphere()
        const mesh = new THREE.Mesh(geometry, materials.get(name))
        mesh.name = `landscape-${name}`; mesh.receiveShadow = true
        level.add(mesh)
      }
      level.visible = lod === 0; this.group.add(level); this.levels.push(level)
    }
    this.group.userData = { world: id, district: data.name, lod: 0,
      triangles: data.lods.map(l => Object.values(l).reduce((n, a) => n + a.length / 9, 0)),
      surfaceTiles: data.surfaces.length, solids: data.solids.length, extent: data.extent }
    if (this.lightSources.length) for (let i = 0; i < LANDSCAPE_LIGHT_BUDGET; i++) {
      const light = new THREE.PointLight('#ffffff', 0, 18, 2)
      light.name = 'landscape-local-light-' + i
      this.lightPool.push(light); this.group.add(light)
    }
    this.update(data.spawn[0] / radius, data.spawn[1], data.spawn[2])
    this.setDaylight(this.daylight)
  }

  setMovingLights(lights: readonly LandscapeLight[]) {
    this.lightSources.length = this.fixedLightCount
    this.lightSources.push(...lights)
  }

  visit(kind = 'landscape') {
    if (!this.data) return null
    const destination = kind === 'landscape' ? { position: this.data.spawn, lookAt: this.data.lookAt } : this.data.visits?.[kind]
    if (!destination) return null
    const [x, y, groundHeight] = destination.position
    const azimuth = x / this.radius
    const up = new THREE.Vector3(-Math.cos(azimuth), 0, -Math.sin(azimuth))
    const point = (x: number, y: number, h: number) => new THREE.Vector3(
      Math.cos(x / this.radius) * (this.radius - h), y, Math.sin(x / this.radius) * (this.radius - h))
    const eye = point(x, y, groundHeight + 1.8), target = point(...destination.lookAt)
    return { azimuth, axial: y, groundHeight,
      orientation: new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().lookAt(eye, target, up)) }
  }

  update(azimuth: number, axial: number, altitude: number) {
    if (!this.data) return
    const distance = Math.hypot(Math.atan2(Math.sin(azimuth), Math.cos(azimuth)) * this.radius, axial, altitude)
    // Keep the entire playable district on the collision-identical near mesh.
    const lod = distance < 1200 ? 0 : distance < 3500 ? 1 : 2
    this.levels.forEach((level, i) => { level.visible = i === lod })
    this.group.userData.lod = lod
    this.lightSelection = this.lightSources.map((light, index) => {
      const angle = light.position[0] / this.radius - azimuth
      const distance = Math.hypot(Math.atan2(Math.sin(angle), Math.cos(angle)) * this.radius, light.position[1] - axial,
        light.position[2] - altitude)
      return { index, distance, fade: 1 - THREE.MathUtils.smoothstep(distance, light.distance * .65, light.distance * 1.3) }
    }).filter(l => l.fade > 0).sort((a, b) => a.distance - b.distance).slice(0, LANDSCAPE_LIGHT_BUDGET)
    this.updateLights()
  }

  setDaylight(daylight: number) {
    this.daylight = THREE.MathUtils.clamp(daylight, 0, 1)
    this.fill.intensity = .04 + this.daylight * 1.16
    const night = THREE.MathUtils.smoothstep(1 - this.daylight, .3, .85)
    for (const { material, intensity } of this.emissive) material.emissiveIntensity = intensity * night
    this.updateLights()
  }

  private updateLights() {
    const night = THREE.MathUtils.smoothstep(1 - this.daylight, .3, .85)
    this.lightPool.forEach((light, i) => {
      const selected = this.lightSelection[i], source = selected && this.lightSources[selected.index]
      if (!source) { light.intensity = 0; return }
      const [x, y, h] = source.position, a = x / this.radius
      light.position.set(Math.cos(a) * (this.radius - h), y, Math.sin(a) * (this.radius - h))
      light.color.set(source.color); light.distance = source.distance
      light.intensity = source.intensity * selected.fade * night
    })
    this.group.userData.activeLights = this.lightPool.filter(l => l.intensity > 0).length
  }

  clear() {
    for (const level of this.levels) level.traverse(o => { if (o instanceof THREE.Mesh) o.geometry.dispose() })
    for (const material of this.materials) material.dispose()
    for (const texture of this.textures) texture.dispose()
    this.textures = []; this.emissive = []; this.lightPool = []; this.lightSelection = []; this.lightSources = []; this.fixedLightCount = 0
    this.group.clear(); this.group.userData = {}; this.levels = []; this.materials = []; this.data = null
  }
  dispose() { this.clear(); this.group.removeFromParent() }
}
