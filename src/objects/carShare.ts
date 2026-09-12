import * as THREE from 'three'
import { getSidewalkWidth, type CityPlan } from './cityLayout'
import { parkingSlotsFor, type ParkingSlot } from './parkedCars'
import { centralPlazaArrival } from './civicArrival'
import { civicSign } from './civicSign'

export type CarShareBay = { azimuth: number; axial: number; heading: number; signSide: number }
const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a))

/** Reserve a real kerb slot, clear of junctions, rather than placing the
 * player's car in the pedestrian arrival square. */
export function planCarShareBay(plan: CityPlan, radius: number): CarShareBay | null {
  if (radius < 800) return null
  const arrival = centralPlazaArrival(radius)
  const nearby = plan.buildings.filter(b => Math.hypot(wrap(b.azimuth - arrival.azimuth) * radius, b.axial - arrival.axialPosition) < 300)
    .sort((a, b) => Math.hypot(wrap(a.azimuth - arrival.azimuth) * radius, a.axial - arrival.axialPosition) - Math.hypot(wrap(b.azimuth - arrival.azimuth) * radius, b.axial - arrival.axialPosition)).slice(0, 64)
  const slots = nearby.flatMap(b => parkingSlotsFor(b, radius, plan.roads, getSidewalkWidth(radius), 6))
    .filter(slot => !plan.roads.some(road => {
      if (road.kind === 'alley' || (road.axialLength > road.tangentWidth) === (slot.along === 'axial')) return false
      return Math.abs(wrap(slot.azimuth - road.azimuth) * radius) < road.tangentWidth / 2 + 4 &&
        Math.abs(slot.axial - road.axial) < road.axialLength / 2 + 4
    }))
  const distance = (s: ParkingSlot) => Math.hypot(wrap(s.azimuth - arrival.azimuth) * radius, s.axial - arrival.axialPosition)
  slots.sort((a, b) => distance(a) - distance(b))
  const slot = slots[0]
  if (!slot) return null
  const road = plan.roads.find(r => r.kind !== 'alley' && (r.axialLength > r.tangentWidth) === (slot.along === 'axial') &&
    Math.abs(wrap(slot.azimuth - r.azimuth) * radius) < r.tangentWidth / 2 && Math.abs(slot.axial - r.axial) < r.axialLength / 2)!
  // +X in a car facing +axial is -tangent. The sign goes beyond the kerb.
  const heading = slot.along === 'axial' ? 0 : Math.PI / 2
  const side = slot.along === 'axial' ? -Math.sign(wrap(slot.azimuth - road.azimuth)) : Math.sign(slot.axial - road.axial)
  return { azimuth: slot.azimuth, axial: slot.axial, heading, signSide: side || 1 }
}

export class CarShareStation {
  readonly group = new THREE.Group()
  bay: CarShareBay | null = null
  private sign: THREE.Group | null = null
  private readonly paint = new THREE.MeshStandardMaterial({ color: 0xd6d2bb, roughness: .95 })

  configure(bay: CarShareBay | null, radius: number) {
    this.clear(); this.bay = bay
    this.group.visible = !!bay
    if (!bay) return
    const c = Math.cos(bay.azimuth), s = Math.sin(bay.azimuth)
    const up = new THREE.Vector3(-c, 0, -s)
    const forward = new THREE.Vector3(-s * Math.sin(bay.heading), Math.cos(bay.heading), c * Math.sin(bay.heading))
    this.group.matrixAutoUpdate = false
    this.group.matrix.makeBasis(up.clone().cross(forward), up, forward)
      .setPosition(c * (radius - .205), bay.axial, s * (radius - .205))
    for (const x of [-1.22, 1.22]) for (const z of [-3, 3]) {
      for (const [w, d, dx, dz] of [[.06, .8, 0, -Math.sign(z) * .4], [.6, .06, -Math.sign(x) * .3, 0]]) {
        const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, .012, d), this.paint)
        mesh.position.set(x + dx, .008, z + dz); this.group.add(mesh)
      }
    }
    this.sign = civicSign('CAR SHARE', ['Central square · 01', 'Return to a marked bay'], .9)
    this.sign.position.set(bay.signSide * 2.5, .12, -2.6)
    this.sign.rotation.y = -bay.signSide * Math.PI / 2
    this.group.add(this.sign)
  }

  private clear() {
    this.sign?.userData.dispose(); this.sign = null
    for (const child of this.group.children) if (child instanceof THREE.Mesh) child.geometry.dispose()
    this.group.clear()
  }
  dispose() { this.clear(); this.paint.dispose(); this.group.removeFromParent() }
}
