import * as THREE from 'three'
import { civicSign } from './civicSign'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import { getArterialRoadWidth, type CityBuilding, type CityPlan } from './cityLayout'
import { fitSuburbanHouse } from './buildingAssets'
import type { RoomSeat } from '../app/roomSeating'
import { createLandscapeCrown } from './landscapeVegetation'
import { PARK_PATH_HEIGHT, parkPathTiles, planPublicPark, type PublicPark } from './publicPark'
import type { StreetLampSource } from './streetLampLighting'

// A small authored layer around the plaza, public garden and observation deck. All
// pieces merge by material; no lights, textures or per-frame object creation.
// Public benches and garden trunks share their placement with collision.
// The tower bench remains decorative, without a certified landing floor.
export class CivicDetails {
  readonly group = new THREE.Group()
  readonly seats: RoomSeat[] = []
  readonly colliders: CityBuilding[] = []
  readonly lamps: StreetLampSource[] = []
  park: PublicPark | null = null
  private signs: THREE.Group[] = []
  private readonly materials = [
    new THREE.MeshStandardMaterial({ color: 0xb5b5a4, roughness: 0.86 }),
    new THREE.MeshStandardMaterial({ color: 0x35444a, roughness: 0.55, metalness: 0.4 }),
    new THREE.MeshStandardMaterial({ color: 0x8b684b, roughness: 0.9 }),
    new THREE.MeshStandardMaterial({ color: 0x587548, roughness: 1 }),
    new THREE.MeshStandardMaterial({ color: 0x476677, roughness: 0.22, metalness: 0.3 }),
    new THREE.MeshStandardMaterial({ color: 0xffdb9b, emissive: 0xffbc69, roughness: 0.5 })
  ]

  constructor(parent: THREE.Group) { parent.add(this.group) }

  rebuild(plan: CityPlan, radius: number, park = planPublicPark(plan, radius)) {
    this.clear()
    // Small physics playgrounds need open space; keep city dressing at city scale.
    if (radius < 800) return
    this.park = park
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
    const bench = (frame: THREE.Matrix4, x: number, z: number, solid = false, baseHeight = 0) => {
      const parts = [
        [2, x, .48, z, 1.8, .1, .5],
        [2, x, .86, z + .22, 1.8, .55, .08],
        ...[-.65, .65].map(side => [1, x + side, .23, z, .08, .46, .42])
      ]
      for (const [material, px, y, pz, width, height, depth] of parts) {
        box(frame, material, px, y, pz, width, height, depth)
        if (solid) {
          const centre = new THREE.Vector3(px, 0, pz).applyMatrix4(frame)
          this.colliders.push({ azimuth: Math.atan2(centre.z, centre.x), axial: centre.y,
            width, depth, height, baseHeight: baseHeight + y - height / 2, collisionMargin: 0, groundMargin: 0, tone: .5, kind: 'block' })
        }
      }
    }

    if (park) {
      for (const tile of parkPathTiles(park.paths)) {
        const geometry = new THREE.PlaneGeometry(tile.width, tile.depth, Math.ceil(tile.width / 4), Math.ceil(tile.depth / 4))
        const positions = geometry.getAttribute('position'), normals = geometry.getAttribute('normal')
        for (let i = 0; i < positions.count; i++) {
          const azimuth = park.azimuth + (tile.x + positions.getX(i)) / radius
          const axial = park.axial + tile.y + positions.getY(i)
          const c = Math.cos(azimuth), s = Math.sin(azimuth)
          positions.setXYZ(i, c * (radius - PARK_PATH_HEIGHT), axial, s * (radius - PARK_PATH_HEIGHT))
          normals.setXYZ(i, -c, 0, -s)
        }
        parts[0].push(geometry)
      }
      for (const [i, b] of park.benches.entries()) {
        const azimuth = park.azimuth + b.x / radius, axial = park.axial + b.y
        bench(surface(azimuth, axial, PARK_PATH_HEIGHT), 0, 0, true, PARK_PATH_HEIGHT)
        this.seats.push({ id: `park-bench-${i}`, label: 'Park bench', radius, azimuth,
          axialPosition: axial + .18, seatHeight: PARK_PATH_HEIGHT + .53,
          exit: { azimuth, axialPosition: axial + .95 } })
      }
      for (const [i, p] of park.lamps.entries()) {
        const azimuth = park.azimuth + p.x / radius, axial = park.axial + p.y, frame = surface(azimuth, axial, .1)
        box(frame, 1, 0, 1.73, 0, .12, 3.46, .12)
        box(frame, 5, 0, 3.46, 0, .34, .1, .34)
        box(frame, 1, 0, 3.54, 0, .5, .07, .5)
        this.lamps.push({ id: `park-${i}`, position: new THREE.Vector3(0, 3.46, 0).applyMatrix4(frame),
          down: new THREE.Vector3(Math.cos(azimuth), 0, Math.sin(azimuth)), intensity: 65, distance: 15, angle: Math.PI / 2.4 })
        this.colliders.push({ azimuth, axial, width: .12, depth: .12, height: 3.6, baseHeight: .1,
          collisionMargin: 0, groundMargin: 0, tone: .5, kind: 'block' })
      }
      const crown = createLandscapeCrown()
      crown.setIndex(Array.from({ length: crown.getAttribute('position').count }, (_, i) => i))
      const trunk = new THREE.CylinderGeometry(.06, .085, 1, 6).translate(0, .5, 0)
      for (const tree of park.trees) {
        const frame = surface(tree.azimuth, tree.axial, .1), width = tree.height * (.62 + .16 * tree.tone)
        const foliage = crown.clone().scale(width, tree.height * .78, width * (.9 + .2 * tree.tone))
          .rotateY(tree.tone * Math.PI * 2).applyMatrix4(frame)
        const stem = trunk.clone().scale(tree.height * .16, tree.height * .62, tree.height * .16).applyMatrix4(frame)
        parts[3].push(foliage); parts[2].push(stem)
        // Trunks have a small physical footprint; the canopy stays overhead.
        this.colliders.push({ azimuth: tree.azimuth, axial: tree.axial, width: .19, depth: .19,
          height: tree.height * .62, baseHeight: .1, collisionMargin: 0, groundMargin: 0, tone: tree.tone, kind: 'block' })
      }
      crown.dispose(); trunk.dispose()
    }
    const edge = getArterialRoadWidth(radius) / 2
    // The arrival corner shares the square's paving; no special spawn decal.
    box(surface(0, 0), 0, edge + 3.25, .012, -edge - 2.1, 6.3, .024, 4.1)
    const guide = civicSign('CENTRAL SQUARE', ['Public garden · Ball practice', 'Neighbourhood car share'], 1.65)
    guide.applyMatrix4(surface((edge + 5) / radius, edge + 3.5))
    this.signs.push(guide); this.group.add(guide)
    const planter = (frame: THREE.Matrix4, x: number, z: number, width = 1.2) => {
      box(frame, 0, x, 0.28, z, width, 0.56, 0.85)
      box(frame, 3, x, 0.7, z, width * 0.9, 0.45, 0.72)
    }
    // Resting places on the pedestrian corners of the central square.
    const plaza = surface(0, 0)
    const corner = getArterialRoadWidth(radius) * 0.5 + 1.5
    for (const side of [-1, 1]) {
      const azimuth = side * (corner + .4) / radius, axial = side === 1 ? corner + 1.35 : -corner
      // Give each bench its own radial frame; a shared tangent plane would
      // bury its feet slightly below the curved floor away from the origin.
      bench(surface(azimuth, axial), 0, 0, true)
      this.seats.push({ id: `plaza-bench-${side}`, label: 'Plaza bench', radius,
        azimuth, axialPosition: axial + .18, seatHeight: .53,
        exit: { azimuth, axialPosition: axial + .95 } })
      planter(plaza, side * (corner + 0.4), -corner)
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
    for (const sign of this.signs) sign.userData.dispose()
    this.signs = []
    this.park = null
    this.lamps.length = 0
    this.seats.length = 0
    this.colliders.length = 0
    for (const mesh of this.group.children as THREE.Mesh[]) mesh.geometry.dispose()
    this.group.clear()
  }

  dispose() {
    this.clear()
    for (const material of this.materials) material.dispose()
    this.group.removeFromParent()
  }
}
