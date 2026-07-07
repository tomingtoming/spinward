import * as THREE from 'three'

import {
  CAP_RIDE_CLEARANCE,
  getCapRideTrack,
  type CapRideTrack
} from '../gameplay/capRide'

// Visuals for the end-cap funicular: a glowing guide rail down the -Y cap's
// inner face, an open glass cabin, and a boarding pad at the rim. All static
// except the cabin, which main.ts moves along the ride each frame (parked at
// the rim while idle). Scales are habitat-relative so Playground stays
// believable.
//
// The cabin is deliberately OPEN (floor, corner pillars, waist-high glass, no
// roof): the rider's camera sits inside it, and the whole point of the ride is
// the unobstructed view of the colony opening up.

const RAIL_COLOR = 0x67e8f9
const CABIN_GLASS_COLOR = 0x9fd6ef

export class CapRideLine {
  readonly group = new THREE.Group()
  readonly cabin = new THREE.Group()

  private track: CapRideTrack | null = null
  private statics: THREE.Object3D[] = []
  private readonly materials: THREE.Material[] = []
  private readonly geometries: THREE.BufferGeometry[] = []

  constructor(habitat: { radius: number; span: number }) {
    this.group.add(this.cabin)
    this.setDimensions(habitat)
  }

  getTrack() {
    return this.track
  }

  // Park the cabin at the boarding pad (idle) — main.ts overrides while riding.
  parkCabin() {
    if (this.track !== null) {
      this.cabin.position.set(
        this.track.baseRadial * Math.cos(this.track.azimuth),
        this.track.axial,
        this.track.baseRadial * Math.sin(this.track.azimuth)
      )
    }
  }

  placeCabinAt(position: THREE.Vector3) {
    this.cabin.position.copy(position)
  }

  setDimensions(habitat: { radius: number; span: number }) {
    this.disposeStatics()
    this.track = getCapRideTrack(habitat)
    const track = this.track

    const cos = Math.cos(track.azimuth)
    const sin = Math.sin(track.azimuth)

    const frameMaterial = new THREE.MeshStandardMaterial({
      color: 0x22343f,
      emissive: RAIL_COLOR,
      emissiveIntensity: 0.25
    })
    this.materials.push(frameMaterial)

    // Guide rail: one thin emissive box spanning rim → hub along the radius,
    // half the cabin clearance behind the car line (toward the cap face).
    const railLength = track.baseRadial - track.hubRadial
    const railThickness = THREE.MathUtils.clamp(habitat.radius * 0.0012, 0.15, 3)
    const railGeometry = new THREE.BoxGeometry(railLength, railThickness, railThickness)
    const railMaterial = new THREE.MeshStandardMaterial({
      color: 0x1c2b36,
      emissive: RAIL_COLOR,
      emissiveIntensity: 0.9
    })
    this.materials.push(railMaterial)
    const rail = new THREE.Mesh(railGeometry, railMaterial)
    const railMid = (track.baseRadial + track.hubRadial) * 0.5
    rail.position.set(railMid * cos, track.axial - CAP_RIDE_CLEARANCE * 0.5, railMid * sin)
    rail.rotation.y = -track.azimuth
    this.addStatic(rail, railGeometry)

    // Boarding pad: an emissive disc flush with the floor at the station.
    const padRadius = THREE.MathUtils.clamp(habitat.radius * 0.004, 1.2, 14)
    const padGeometry = new THREE.CylinderGeometry(padRadius, padRadius, 0.5, 24)
    const padMaterial = new THREE.MeshStandardMaterial({
      color: 0x16303c,
      emissive: RAIL_COLOR,
      emissiveIntensity: 0.5
    })
    this.materials.push(padMaterial)
    const pad = new THREE.Mesh(padGeometry, padMaterial)
    // Cylinder axis local Y → rotate so it points radially (the floor normal).
    pad.position.set((track.baseRadial - 0.1) * cos, track.axial, (track.baseRadial - 0.1) * sin)
    pad.rotation.z = Math.PI / 2
    pad.rotation.y = -track.azimuth
    this.addStatic(pad, padGeometry)

    // Cabin, built in a local frame whose +Y is the rider's up (inward radial).
    this.cabin.clear()
    const up = new THREE.Vector3(-cos, 0, -sin)
    const axis = new THREE.Vector3(0, 1, 0)
    const tangent = new THREE.Vector3(-sin, 0, cos)
    this.cabin.quaternion.setFromRotationMatrix(
      new THREE.Matrix4().makeBasis(axis, up, tangent)
    )

    const cabinSize = THREE.MathUtils.clamp(habitat.radius * 0.002, 2.4, 6)
    const floorGeometry = new THREE.BoxGeometry(cabinSize, 0.14, cabinSize)
    const floor = new THREE.Mesh(floorGeometry, frameMaterial)
    floor.position.y = -1.55
    this.geometries.push(floorGeometry)
    this.cabin.add(floor)

    const pillarGeometry = new THREE.BoxGeometry(0.12, 2.6, 0.12)
    this.geometries.push(pillarGeometry)
    const half = cabinSize * 0.5 - 0.1
    for (const [px, pz] of [
      [half, half],
      [half, -half],
      [-half, half],
      [-half, -half]
    ]) {
      const pillar = new THREE.Mesh(pillarGeometry, frameMaterial)
      pillar.position.set(px, -0.35, pz)
      this.cabin.add(pillar)
    }

    const glassMaterial = new THREE.MeshStandardMaterial({
      color: CABIN_GLASS_COLOR,
      transparent: true,
      // Near-invisible: the rider's camera lives inside this cabin and the
      // ride IS the view — the glass only needs to catch a hint of light.
      opacity: 0.12,
      roughness: 0.05,
      metalness: 0.1,
      side: THREE.DoubleSide,
      depthWrite: false
    })
    this.materials.push(glassMaterial)
    const wallGeometry = new THREE.BoxGeometry(cabinSize, 1.1, 0.05)
    this.geometries.push(wallGeometry)
    for (const [rotY, ox, oz] of [
      [0, 0, half],
      [0, 0, -half],
      [Math.PI / 2, half, 0],
      [Math.PI / 2, -half, 0]
    ]) {
      const wall = new THREE.Mesh(wallGeometry, glassMaterial)
      wall.position.set(ox, -0.9, oz)
      wall.rotation.y = rotY
      this.cabin.add(wall)
    }

    this.parkCabin()
  }

  private addStatic(mesh: THREE.Mesh, geometry: THREE.BufferGeometry) {
    this.group.add(mesh)
    this.statics.push(mesh)
    this.geometries.push(geometry)
  }

  private disposeStatics() {
    for (const object of this.statics) {
      this.group.remove(object)
    }
    this.statics = []
    this.cabin.clear()
    for (const geometry of this.geometries) {
      geometry.dispose()
    }
    this.geometries.length = 0
    for (const material of this.materials) {
      material.dispose()
    }
    this.materials.length = 0
  }

  dispose() {
    this.disposeStatics()
  }
}
