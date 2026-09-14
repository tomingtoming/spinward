import * as THREE from 'three'
import type { CityPlan } from './cityLayout'
import { streetAccessPolygons } from './streetFrontage'
import { buildStreetSurfaceGeometry, type StreetSurfaceGeometryInput } from './streetSurfaceGeometry'
import { clipStreetPolygon } from './streetPolygon'
import { buildEntranceWalkGeometry } from './streetEntranceWalkGeometry'

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

  getPavementMaterials() { return [this.pathMaterial] }

  rebuild(plan: CityPlan, radius: number, azimuth: number, axial: number) {
    this.clear()
    const path: StreetSurfaceGeometryInput[] = [], valid: number[] = [], rejected: number[] = []
    // Above fields (0.1 m), below alleys (0.15 m) and roads (0.2 m).
    const position = (t: number, a: number, lift = 0.12) => {
      const angle = azimuth + t / radius
      return [Math.cos(angle) * (radius - lift), a + axial, Math.sin(angle) * (radius - lift)]
    }
    for (const building of plan.buildings) {
      const { access } = building
      if (!access) continue
      if(plan.entranceWalks?.some(w=>Math.abs(wrap(w.source.azimuth-access.entrance.azimuth))*radius<1e-5&&Math.abs(w.source.axial-access.entrance.axial)<1e-5))continue
      const t = wrap(access.entrance.azimuth - azimuth) * radius
      const a = access.entrance.axial - axial
      if (Math.abs(t) > 180 || Math.abs(a) > 180) continue
      for (const polygon of streetAccessPolygons(access, radius)) {
        const local = polygon.map(p => ({ ...p, x: p.x + t, y: p.y + a }))
        const clipped = clipStreetPolygon(clipStreetPolygon(clipStreetPolygon(clipStreetPolygon(local,
          1, 0, 180), -1, 0, 180), 0, 1, 180), 0, -1, 180)
        if (clipped.length) path.push({ source: { azimuth, axial }, polygon: clipped, lift: (building.baseHeight ?? 0) + .12 })
      }
      if (this.debug) valid.push(...position(t, a, .3),
        ...position(wrap(access.roadEdge.azimuth - azimuth) * radius, access.roadEdge.axial - axial, .3))
    }

    if (this.debug) for (const item of plan.accessRejected ?? []) {
      const t = wrap(item.building.azimuth - azimuth) * radius, a = item.building.axial - axial
      if (Math.abs(t) > 180 || Math.abs(a) > 180) continue
      rejected.push(...position(t - 1, a - 1, 0.4), ...position(t + 1, a + 1, 0.4),
        ...position(t - 1, a + 1, 0.4), ...position(t + 1, a - 1, 0.4))
    }
    const geometry = buildStreetSurfaceGeometry(path, radius, 4)
    if (geometry) {
      const mesh = new THREE.Mesh(geometry, this.pathMaterial)
      mesh.name = 'street-access-corridors'
      mesh.userData.pieces = path.length
      mesh.receiveShadow = true
      this.group.add(mesh)
    }
    for(const walk of plan.entranceWalks??[]){
      if(Math.abs(wrap(walk.source.azimuth-azimuth))*radius>180||Math.abs(walk.source.axial-axial)>180)continue
      const mesh=new THREE.Mesh(buildEntranceWalkGeometry(walk,radius),this.pathMaterial)
      mesh.name='certified-entrance-'+walk.id;mesh.receiveShadow=true;this.group.add(mesh)
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
