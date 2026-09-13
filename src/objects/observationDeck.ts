import * as THREE from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import type { CityBuilding, CityTower } from './cityLayout'
import data from './observationDeckGeometry.json'

export const hasObservationDeck = (tower: CityTower | null, radius: number): tower is CityTower =>
  radius >= 800 && !!tower && Math.abs(tower.height - data.height) < .001 && Math.abs(tower.deckRadius - data.radius) < .001

/** Exact authored tangent-plane point, expressed in cylinder surface space. */
export function observationDeckPoint(tower: CityTower, radius: number, x: number, y: number, z: number) {
  return { azimuth: tower.azimuth + Math.atan2(x, radius - y), axial: tower.axial - z,
    height: radius - Math.hypot(radius - y, x) }
}

// Height interpolation is in unrolled cylinder space. Split only the floor's
// long radial triangles so its planar visual top does not acquire millimetre
// troughs in the ground sampler. The render mesh needs no extra triangles.
function floorTriangles(vertices: readonly number[]) {
  const out: number[] = []
  const split = (a: number[], b: number[], c: number[]) => {
    const length = (u: number[], v: number[]) => (u[0] - v[0]) ** 2 + (u[2] - v[2]) ** 2
    const edges = [length(a, b), length(b, c), length(c, a)], max = Math.max(...edges)
    if (max <= 4) { out.push(...a, ...b, ...c); return }
    const points = [a, b, c], i = edges.indexOf(max), u = points[i], v = points[(i + 1) % 3], w = points[(i + 2) % 3]
    const mid = u.map((x, j) => (x + v[j]) / 2)
    split(u, mid, w); split(mid, v, w)
  }
  for (let i = 0; i < vertices.length; i += 9) split(vertices.slice(i, i + 3), vertices.slice(i + 3, i + 6), vertices.slice(i + 6, i + 9))
  return out
}
const groundVertices = floorTriangles(data.colliders.find(c => c.ground)!.vertices)

/** Collision is available before the GLB arrives and independent of visual LOD.
 * Ground sampling sees the deck top only; rail and underside never become floors. */
export function observationDeckColliders(tower: CityTower | null, radius: number): CityBuilding[] {
  if (!hasObservationDeck(tower, radius)) return []
  return data.colliders.map(part => {
    const vertices: number[] = []
    const source = part.ground ? groundVertices : part.vertices
    for (let i = 0; i < source.length; i += 3) {
      const p = observationDeckPoint(tower, radius, source[i], source[i + 1], source[i + 2])
      vertices.push((p.azimuth - tower.azimuth) * radius, p.axial - tower.axial, p.height)
    }
    const xs = vertices.filter((_, i) => i % 3 === 0), ys = vertices.filter((_, i) => i % 3 === 1), hs = vertices.filter((_, i) => i % 3 === 2)
    const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys), low = Math.min(...hs), high = Math.max(...hs)
    const x = (x0 + x1) / 2, y = (y0 + y1) / 2
    return { azimuth: tower.azimuth + x / radius, axial: tower.axial + y,
      width: Math.max(.01, x1 - x0), depth: Math.max(.01, y1 - y0), baseHeight: low, height: high - low,
      kind: 'block', tone: .5, collisionMargin: 0, groundMargin: 0, groundSurface: part.ground,
      surfaceMesh: vertices.map((v, i) => i % 3 === 0 ? v - x : i % 3 === 1 ? v - y : v) }
  })
}

function fallbackGeometry() {
  const points: number[] = [], colors: number[] = []
  for (const part of data.colliders) {
    points.push(...part.vertices)
    const color = part.name.startsWith('guard') ? [.19, .24, .25] : [.53, .56, .54]
    for (let i = 0; i < part.vertices.length; i += 3) colors.push(...color)
  }
  const geometry = new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(points, 3))
    .setAttribute('color', new THREE.Float32BufferAttribute(colors, 3))
  geometry.computeVertexNormals(); return geometry
}

/** One landmark, one material/draw per LOD. Closed fallback parapets preserve
 * the floor and barrier if the texture-free Blender asset cannot be loaded. */
export class ObservationDeck {
  readonly group = new THREE.Group()
  private readonly lod = new THREE.LOD()
  private modules: THREE.BufferGeometry[] = [fallbackGeometry()]
  private readonly material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: .85, metalness: .12 })
  private disposed = false
  constructor(parent: THREE.Group) {
    this.group.name = 'observation-deck'; parent.add(this.group); this.group.add(this.lod)
    this.group.visible = false; this.group.userData.asset = 'fallback'; this.setMeshes()
    if (typeof document === 'undefined') return
    new GLTFLoader().loadAsync('/assets/observation-deck.glb').then(g => {
      const next: THREE.BufferGeometry[] = []
      try {
        if (this.disposed) return
        for (let i = 0; i < 3; i++) {
          const node = g.scene.getObjectByName(`observation_deck_lod${i}`)
          if (!(node instanceof THREE.Mesh)) throw Error('Missing deck LOD')
          node.updateWorldMatrix(true, false)
          const geo = node.geometry.clone().applyMatrix4(node.matrixWorld); next.push(geo); geo.computeBoundingBox()
          const box = geo.boundingBox!
          if (!geo.hasAttribute('color') || Math.abs(box.min.y) > .001 || Math.abs(box.max.x - data.radius) > .001 || box.max.y < data.height || box.max.y > data.height + 1.23) throw Error('Invalid deck geometry')
        }
        for (const geo of this.modules) geo.dispose()
        this.modules = next.splice(0); this.group.userData.asset = 'blender'; this.setMeshes()
      } finally {
        for (const geo of next) geo.dispose()
        g.scene.traverse(o => { if (o instanceof THREE.Mesh) { o.geometry.dispose(); for (const m of Array.isArray(o.material) ? o.material : [o.material]) m.dispose() } })
      }
    }).catch(e => console.warn('Observation deck unavailable; retaining supported fallback.', e))
  }
  private setMeshes() {
    this.lod.clear(); this.lod.levels.length = 0
    for (let i = 0; i < 3; i++) this.lod.addLevel(new THREE.Mesh(this.modules[i] ?? this.modules[0], this.material), [0, 95, 350][i], .15)
    this.group.userData.triangles = this.modules.map(g => (g.index?.count ?? g.getAttribute('position').count) / 3)
  }
  setPlan(tower: CityTower | null, radius: number) {
    this.group.visible = hasObservationDeck(tower, radius)
    if (!this.group.visible || !tower) return
    const c = Math.cos(tower.azimuth), s = Math.sin(tower.azimuth)
    this.group.position.set(c * radius, tower.axial, s * radius)
    this.group.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(
      new THREE.Vector3(-s, 0, c), new THREE.Vector3(-c, 0, -s), new THREE.Vector3(0, -1, 0)))
    this.group.userData.height = data.height
  }
  dispose() { this.disposed = true; for (const geo of this.modules) geo.dispose(); this.material.dispose(); this.group.removeFromParent() }
}
