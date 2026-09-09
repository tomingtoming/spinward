import * as THREE from 'three'
import type { CityPlan } from './cityLayout'

const wrap = (a: number) => ((a + Math.PI) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI) - Math.PI

// Pavement is a thin visual skin on the existing walkable cylinder. It uses
// exactly the certified entrance corridors. The continuous kerbed bands
// belong to Sidewalks; a second skin here would have different clipping/LOD.
export class StreetAccessLayer {
  readonly group = new THREE.Group()
  private readonly pathMaterial = new THREE.MeshStandardMaterial({ color: 0xb2aca0, roughness: 0.95, side: THREE.DoubleSide })
  private readonly validMaterial = new THREE.LineBasicMaterial({ color: 0x55ffaa, depthTest: false })
  private readonly rejectedMaterial = new THREE.LineBasicMaterial({ color: 0xff4455, depthTest: false })
  constructor(parent: THREE.Group, private readonly debug = false) { parent.add(this.group) }

  rebuild(plan: CityPlan, radius: number, azimuth: number, axial: number) {
    this.clear()
    const path: number[] = [], valid: number[] = [], rejected: number[] = []
    // Above fields (0.1 m), below alleys (0.15 m) and roads (0.2 m).
    const position = (t: number, a: number, lift = 0.12) => {
      const angle = azimuth + t / radius
      return [Math.cos(angle) * (radius - lift), a + axial, Math.sin(angle) * (radius - lift)]
    }
    const rect = (out: number[], t: number, a: number, w: number, h: number, lift = 0.12) => {
      const left = Math.max(-180, t - w / 2), right = Math.min(180, t + w / 2)
      const bottom = Math.max(-180, a - h / 2), top = Math.min(180, a + h / 2)
      if (left >= right || bottom >= top) return
      // Follow curvature rather than drawing a long chord under the ground.
      const segments = Math.max(1, Math.ceil((right - left) / Math.min(4, radius * 0.025)))
      for (let i = 0; i < segments; i++) {
        const x0 = left + (right - left) * i / segments
        const x1 = left + (right - left) * (i + 1) / segments
        const p = [position(x0, bottom, lift), position(x1, bottom, lift), position(x1, top, lift), position(x0, top, lift)]
        for (const index of [0, 1, 2, 0, 2, 3]) out.push(...p[index])
      }
    }
    for (const building of plan.buildings) {
      const { access, front } = building
      if (!access || !front) continue
      const t = wrap(access.entrance.azimuth - azimuth) * radius
      const a = access.entrance.axial - axial
      if (Math.abs(t) > 180 || Math.abs(a) > 180) continue
      rect(path, t + (front.axis === 'tangent' ? front.side * access.length / 2 : 0),
        a + (front.axis === 'axial' ? front.side * access.length / 2 : 0),
        front.axis === 'tangent' ? access.length : access.width,
        front.axis === 'axial' ? access.length : access.width)
      if (this.debug) {
        valid.push(...position(t, a, 0.3), ...position(t + (front.axis === 'tangent' ? front.side * access.length : 0),
          a + (front.axis === 'axial' ? front.side * access.length : 0), 0.3))
      }
    }
    if (this.debug) for (const item of plan.accessRejected ?? []) {
      const t = wrap(item.building.azimuth - azimuth) * radius, a = item.building.axial - axial
      if (Math.abs(t) > 180 || Math.abs(a) > 180) continue
      rejected.push(...position(t - 1, a - 1, 0.4), ...position(t + 1, a + 1, 0.4),
        ...position(t - 1, a + 1, 0.4), ...position(t + 1, a - 1, 0.4))
    }
    for (const [vertices, material] of [[path, this.pathMaterial]] as const) {
      if (!vertices.length) continue
      const geometry = new THREE.BufferGeometry()
      geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3))
      geometry.computeVertexNormals()
      const mesh = new THREE.Mesh(geometry, material)
      mesh.receiveShadow = true
      this.group.add(mesh)
    }
    for (const [vertices, material] of [[valid, this.validMaterial], [rejected, this.rejectedMaterial]] as const) {
      if (!vertices.length) continue
      const geometry = new THREE.BufferGeometry()
      geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3))
      const lines = new THREE.LineSegments(geometry, material)
      lines.renderOrder = 20
      this.group.add(lines)
    }
  }
  clear() {
    for (const child of this.group.children as THREE.Mesh[]) child.geometry.dispose()
    this.group.clear()
  }
  dispose() {
    this.clear()
    this.pathMaterial.dispose()
    this.validMaterial.dispose(); this.rejectedMaterial.dispose()
    this.group.removeFromParent()
  }
}
