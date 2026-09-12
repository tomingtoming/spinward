import * as THREE from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import type { KenneyCarGeometryPack } from './buildingAssets'

const outward = new THREE.Vector3(), inward = new THREE.Vector3(), axial = new THREE.Vector3(0, 1, 0)
const tangentDir = new THREE.Vector3(), forward = new THREE.Vector3(), right = new THREE.Vector3(), basis = new THREE.Matrix4()

/** Same sedan and palette as the parked/traffic fleet. Only the near driver's
 * cabin is additional geometry. The city owns the shared texture and pack. */
export class Car {
  static readonly DRIVER_EYE = new THREE.Vector3(.28, 1.19, -.28)
  readonly group = new THREE.Group()
  private readonly cabin = new THREE.Group()
  private pack: KenneyCarGeometryPack | null = null
  private body: THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial> | null = null
  private readonly trim = new THREE.MeshStandardMaterial({ color: 0x333b3c, roughness: .88 })
  private readonly upholstery = new THREE.MeshStandardMaterial({ color: 0x6b7169, roughness: 1 })
  private readonly headlamp = new THREE.MeshBasicMaterial({ color: 0xffebbf })
  private readonly taillamp = new THREE.MeshBasicMaterial({ color: 0xc33729 })
  private readonly lamps = new THREE.Group()
  private wheel: THREE.Mesh

  constructor() {
    this.group.name = 'shared-city-sedan'
    this.group.visible = false
    const parts: THREE.BufferGeometry[][] = [[], []]
    const box = (m: number, w: number, h: number, d: number, x: number, y: number, z: number) => {
      parts[m].push(new THREE.BoxGeometry(w, h, d).translate(x, y, z))
    }
    // Dimensions fitted to the kit sedan, inspected with Blender MCP.
    box(0, 1.22, .17, .38, 0, .85, .51) // dashboard below the windscreen
    box(0, .14, .27, .8, 0, .55, -.12) // centre console
    box(0, 1.2, .035, 1.08, 0, .32, -.27)
    box(1, 1.01, .035, .9, 0, 1.408, -.26) // headlining
    for (const x of [-.64, .64]) box(0, .065, .42, 1.28, x, .61, -.24)
    for (const x of [-.28, .28]) {
      box(1, .43, .13, .48, x, .49, -.35)
      box(1, .43, .51, .11, x, .76, -.64)
      box(1, .22, .15, .11, x, 1.07, -.64)
    }
    // Follow the kit's raked windscreen and narrow roof with visible inner
    // pillars. These connect the headlining to the doors in the driving view.
    const strut = (a: THREE.Vector3, b: THREE.Vector3, width: number) => {
      const geometry = new THREE.CylinderGeometry(width / 2, width / 2, a.distanceTo(b), 6)
      geometry.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize()))
      geometry.translate((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2)
      parts[0].push(geometry)
    }
    for (const side of [-1, 1]) {
      strut(new THREE.Vector3(side * .62, .86, .7), new THREE.Vector3(side * .48, 1.408, .27), .06)
      strut(new THREE.Vector3(side * .64, .84, -.27), new THREE.Vector3(side * .5, 1.408, -.27), .055)
      strut(new THREE.Vector3(side * .62, .85, -1.02), new THREE.Vector3(side * .49, 1.408, -.72), .065)
    }
    box(0, 1.01, .065, .07, 0, 1.397, .27)
    const materials = [this.trim, this.upholstery]
    parts.forEach((geometries, i) => {
      const geometry = mergeGeometries(geometries)
      geometries.forEach(g => g.dispose())
      if (geometry) this.cabin.add(new THREE.Mesh(geometry, materials[i]))
    })
    this.wheel = new THREE.Mesh(new THREE.TorusGeometry(.165, .023, 6, 24), this.trim)
    this.wheel.position.set(.28, .89, .25); this.wheel.rotation.x = -.28
    this.cabin.add(this.wheel)
    const hub = new THREE.Mesh(new THREE.BoxGeometry(.23, .055, .045), this.trim)
    this.wheel.add(hub)
    for (const [z, material] of [[2.055, this.headlamp], [-2.055, this.taillamp]] as const) {
      const lamp = new THREE.Mesh(new THREE.BoxGeometry(1.05, .09, .035), material)
      lamp.position.set(0, .58, z); this.lamps.add(lamp)
    }
    this.lamps.visible = false
    this.group.add(this.cabin, this.lamps)
  }

  setPack(pack: KenneyCarGeometryPack | null) {
    if (!pack || pack === this.pack) return
    this.body?.geometry.dispose(); this.body?.material.dispose(); this.body?.removeFromParent()
    this.pack = pack
    const geometry = pack.cars[0].clone()
    const bodyGroup = geometry.groups.find(g => g.materialIndex === 0)
    if (bodyGroup) geometry.setDrawRange(bodyGroup.start, bodyGroup.count)
    geometry.clearGroups()
    // Cull the outside-facing opaque kit glazing from within the cabin.
    // The physical headlining, seats and dashboard supply its inside surfaces.
    const material = pack.material.clone(); material.side = THREE.FrontSide
    this.body = new THREE.Mesh(geometry, material)
    this.group.add(this.body); this.group.visible = true
    this.group.userData.ready = true
  }

  update(driving: boolean, daylight: number, steering: number) {
    this.lamps.visible = driving && daylight < .45
    this.wheel.rotation.z = driving ? steering * .55 : 0
  }

  // Places the car on the inner wall in rotating-frame coordinates.
  setPose(azimuth: number, axialPosition: number, heading: number, radius: number) {
    const cos = Math.cos(azimuth)
    const sin = Math.sin(azimuth)
    outward.set(cos, 0, sin)
    inward.copy(outward).multiplyScalar(-1)
    tangentDir.set(-sin, 0, cos)

    forward
      .copy(axial)
      .multiplyScalar(Math.cos(heading))
      .addScaledVector(tangentDir, Math.sin(heading))
    right.crossVectors(inward, forward)
    basis.makeBasis(right, inward, forward)
    this.group.quaternion.setFromRotationMatrix(basis)
    this.group.position.copy(outward).multiplyScalar(radius).setY(axialPosition)
  }

  setHighlighted(on: boolean) {
    // A restrained response to the XR pointer, with no permanent beacon.
    this.body?.material.emissive.setHex(on ? 0x18302b : 0)
  }

  dispose() {
    this.group.traverse(o => { if (o instanceof THREE.Mesh) o.geometry.dispose() })
    this.body?.material.dispose()
    this.trim.dispose(); this.upholstery.dispose(); this.headlamp.dispose(); this.taillamp.dispose()
    this.group.removeFromParent()
  }
}
