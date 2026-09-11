import * as THREE from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import { getArterialRoadWidth, type CityBuilding, type CityPlan } from './cityLayout'
import { fitSuburbanHouse } from './buildingAssets'
import type { RoomSeat } from '../app/roomSeating'

// A small authored layer around the arrival plaza and observation deck. All
// pieces merge by material; no lights, textures or per-frame object creation.
// Plaza benches share their placement with interaction/collision. The remaining
// details are decorative; the tower bench is not a certified landing floor.
export class CivicDetails {
  readonly group = new THREE.Group()
  readonly seats: RoomSeat[] = []
  readonly benchColliders: CityBuilding[] = []
  private readonly materials = [
    new THREE.MeshStandardMaterial({ color: 0xb5b5a4, roughness: 0.86 }),
    new THREE.MeshStandardMaterial({ color: 0x35444a, roughness: 0.55, metalness: 0.4 }),
    new THREE.MeshStandardMaterial({ color: 0x8b684b, roughness: 0.9 }),
    new THREE.MeshStandardMaterial({ color: 0x587548, roughness: 1 }),
    new THREE.MeshStandardMaterial({ color: 0x476677, roughness: 0.22, metalness: 0.3 }),
    new THREE.MeshStandardMaterial({ color: 0xffdb9b, emissive: 0xffbc69, roughness: 0.5 })
  ]

  constructor(parent: THREE.Group) { parent.add(this.group) }

  rebuild(plan: CityPlan, radius: number) {
    this.clear()
    // Small physics playgrounds need open space; keep city dressing at city scale.
    if (radius < 800) return
    const parts: THREE.BufferGeometry[][] = this.materials.map(() => [])
    const surface = (azimuth: number, axial: number, height = 0) => {
      const c = Math.cos(azimuth), s = Math.sin(azimuth)
      return new THREE.Matrix4().makeBasis(
        new THREE.Vector3(-s, 0, c), new THREE.Vector3(-c, 0, -s), new THREE.Vector3(0, -1, 0)
      ).setPosition(c * (radius - height), axial, s * (radius - height))
    }
    const box = (frame: THREE.Matrix4, material: number,
      x: number, y: number, z: number, w: number, h: number, d: number, tilt = 0) => {
      const geometry = new THREE.BoxGeometry(w, h, d)
      geometry.rotateX(tilt)
      geometry.translate(x, y, z)
      geometry.applyMatrix4(frame)
      parts[material].push(geometry)
    }
    const bench = (frame: THREE.Matrix4, x: number, z: number, solid = false) => {
      const parts = [
        [2, x, .48, z, 1.8, .1, .5],
        [2, x, .86, z + .22, 1.8, .55, .08],
        ...[-.65, .65].map(side => [1, x + side, .23, z, .08, .46, .42])
      ]
      for (const [material, px, y, pz, width, height, depth] of parts) {
        box(frame, material, px, y, pz, width, height, depth)
        if (solid) {
          const centre = new THREE.Vector3(px, 0, pz).applyMatrix4(frame)
          this.benchColliders.push({ azimuth: Math.atan2(centre.z, centre.x), axial: centre.y,
            width, depth, height, baseHeight: y - height / 2, collisionMargin: 0, groundMargin: 0, tone: .5, kind: 'block' })
        }
      }
    }
    const planter = (frame: THREE.Matrix4, x: number, z: number, width = 1.2) => {
      box(frame, 0, x, 0.28, z, width, 0.56, 0.85)
      box(frame, 3, x, 0.7, z, width * 0.9, 0.45, 0.72)
    }
    // Human-scale resting places beside, not across, the central throwing lane.
    const plaza = surface(0, 0)
    const corner = getArterialRoadWidth(radius) * 0.5 + 1.5
    for (const side of [-1, 1]) {
      const azimuth = side * (corner + .4) / radius, axial = -corner
      // Give each bench its own radial frame; a shared tangent plane would
      // bury its feet slightly below the curved floor away from the origin.
      bench(surface(azimuth, axial), 0, 0, true)
      this.seats.push({ id: `plaza-bench-${side}`, label: 'Plaza bench', radius,
        azimuth, axialPosition: axial + .18, seatHeight: .53,
        exit: { azimuth, axialPosition: axial + .95 } })
      planter(plaza, side * (corner + 0.4), -corner)
      box(plaza, 1, side * (corner + 1.5), 0.7, corner, 0.12, 1.4, 0.12)
      box(plaza, 0, side * (corner + 1.5), 1.4, corner, 0.7, 0.42, 0.1)
    }

    // An observation deck is a destination: seating, a planter and an
    // upward-pointing public telescope make its purpose visible without UI.
    if (plan.tower !== null) {
      const tower = plan.tower
      const deck = surface(tower.azimuth, tower.axial, tower.height + 0.08)
      const offset = Math.min(2.2, tower.deckRadius * 0.35)
      bench(deck, -offset, 0)
      planter(deck, offset, -offset)
      box(deck, 1, 0, 0.65, -offset, 0.12, 1.3, 0.12)
      const tube = new THREE.CylinderGeometry(0.13, 0.1, 1.05, 12)
      tube.rotateX(Math.PI / 4)
      tube.translate(0, 1.45, -offset)
      tube.applyMatrix4(deck)
      parts[0].push(tube)
      const lens = new THREE.CylinderGeometry(0.115, 0.115, 0.025, 12)
      lens.rotateX(Math.PI / 4)
      lens.translate(0, 1.83, -offset + 0.38)
      lens.applyMatrix4(deck)
      parts[4].push(lens)
      for (const x of [-0.32, 0.32]) box(deck, 1, x, 0.06, -offset, 0.12, 0.12, 0.75)
    }

    // A bounded set of street-facing details. Dimensions stay in metres:
    // a door is human-sized even when the habitat or building is enormous.
    const near = plan.buildings.filter(b =>
      Math.hypot(b.azimuth * radius, b.axial) < 120 && b.height >= 8 && b.kind === 'block'
    ).sort((a, b) => Math.hypot(a.azimuth * radius, a.axial) - Math.hypot(b.azimuth * radius, b.axial)).slice(0, 24)
    for (const building of near) {
      // Generated buildings must carry certified frontage. Never invent an
      // entrance direction for unverified/synthetic footprints.
      if (!building.front || !building.access || fitSuburbanHouse(building)) continue
      const base = surface(building.azimuth, building.axial)
      const front = building.front
      const yaw = front.axis === 'tangent' ? front.side * Math.PI / 2 : front.side === 1 ? Math.PI : 0
      const facade = base.clone().multiply(new THREE.Matrix4().makeRotationY(yaw))
      const width = front.axis === 'tangent' ? building.depth : building.width
      const depth = front.axis === 'tangent' ? building.width : building.depth
      const z = depth * 0.5 + 0.035
      const entryWidth = Math.min(2.2, width * 0.3)
      // Dark glazing with a projecting portal, two columns and a real canopy.
      box(facade, 4, 0, 1.25, z, entryWidth, 2.5, 0.08)
      for (const side of [-1, 1]) box(facade, 0, side * (entryWidth * 0.5 + 0.1), 1.35, z + 0.3, 0.18, 2.7, 0.65)
      box(facade, 0, 0, 2.8, z + 0.5, entryWidth + 1, 0.2, 1.25)
      box(facade, 5, 0, 2.65, z + 0.4, entryWidth * 0.8, 0.05, 0.35)
      // Residential bands get balconies; the office core gets a taller,
      // repeated vertical frame. Both tie the base to the upper mass.
      const residential = (building.urban ?? 0) < 0.78 || building.tone < 0.5
      const upperFloors = Math.min(4, Math.floor((building.height - 4) / 3.2))
      for (let floor = 0; floor < upperFloors; floor++) {
        const y = 4.2 + floor * 3.2
        const span = Math.min(width * 0.7, 8)
        if (residential) {
          box(facade, 0, 0, y, z + 0.5, span, 0.16, 1.15)
          box(facade, 1, 0, y + 1, z + 1, span, 0.06, 0.06)
          for (const side of [-1, 0, 1]) box(facade, 1, side * span * 0.45, y + 0.5, z + 1, 0.05, 1, 0.05)
        } else {
          for (const side of [-1, 1]) box(facade, 0, side * span * 0.5, y + 1.2, z + 0.12, 0.2, 2.8, 0.25)
        }
        // Recess is suggested by opaque surrounds; glazing has its own
        // roughness. A ledge casts a genuine geometric silhouette nearby.
        box(facade, 4, 0, y + 1.45, z + 0.015, Math.min(span * 0.7, 3.8), 1.7, 0.04)
        box(facade, 0, 0, y + 2.35, z + 0.17, Math.min(span * 0.7, 3.8) + 0.2, 0.12, 0.35)
      }
      // Roof gardens and angled skylights use the roof as a fifth facade.
      // Stay within the footprint; no new playable roof height is introduced.
      const roof = surface(building.azimuth, building.axial, building.height + 0.08)
      if (building.width > 7 && building.depth > 7) {
        const w = Math.min(building.width * 0.55, 8)
        box(roof, 3, -building.width * 0.13, 0.12, 0, w, 0.24, Math.min(building.depth * 0.5, 6))
        for (const side of [-1, 1]) {
          box(roof, 0, side * building.width * 0.28, 0.25, building.depth * 0.25, 1.8, 0.5, 1.3)
          box(roof, 4, side * building.width * 0.28, 0.6, building.depth * 0.25, 1.65, 0.06, 1.2, Math.PI / 7)
        }
      }
    }
    for (let i = 0; i < parts.length; i++) {
      if (parts[i].length === 0) continue
      const geometry = mergeGeometries(parts[i])
      for (const part of parts[i]) part.dispose()
      if (geometry !== null) {
        const mesh = new THREE.Mesh(geometry, this.materials[i])
        mesh.castShadow = true
        mesh.receiveShadow = true
        this.group.add(mesh)
      }
    }
  }

  setDaylight(daylight: number) {
    this.materials[5].emissiveIntensity = 0.15 + (1 - daylight) * 1.4
  }

  clear() {
    this.seats.length = 0
    this.benchColliders.length = 0
    for (const mesh of this.group.children as THREE.Mesh[]) mesh.geometry.dispose()
    this.group.clear()
  }

  dispose() {
    this.clear()
    for (const material of this.materials) material.dispose()
    this.group.removeFromParent()
  }
}
