import * as THREE from 'three'

import { mergeBufferGeometries } from './cylinder'

// A small rover-styled car. Local axes: +Z forward, +Y up, base at y = 0.

const outward = new THREE.Vector3()
const inward = new THREE.Vector3()
const axial = new THREE.Vector3(0, 1, 0)
const tangentDir = new THREE.Vector3()
const forward = new THREE.Vector3()
const right = new THREE.Vector3()
const basis = new THREE.Matrix4()

export class Car {
  readonly group = new THREE.Group()

  private readonly bodyMaterial = new THREE.MeshStandardMaterial({
    color: 0x67b7c4,
    roughness: 0.4,
    metalness: 0.35
  })

  private readonly wheelMaterial = new THREE.MeshStandardMaterial({
    color: 0x14181d,
    roughness: 0.9,
    metalness: 0.1
  })

  private readonly lightMaterial = new THREE.MeshBasicMaterial({
    color: 0xfff1c4,
    toneMapped: false
  })

  constructor() {
    const bodyParts: THREE.BufferGeometry[] = []

    const chassis = new THREE.BoxGeometry(1.9, 0.6, 4.2)
    chassis.translate(0, 0.62, 0)
    bodyParts.push(chassis)

    const cabin = new THREE.BoxGeometry(1.7, 0.55, 2.0)
    cabin.translate(0, 1.18, -0.45)
    bodyParts.push(cabin)

    const bodyGeometry = mergeBufferGeometries(bodyParts)

    for (const part of bodyParts) {
      part.dispose()
    }

    if (bodyGeometry !== null) {
      this.group.add(new THREE.Mesh(bodyGeometry, this.bodyMaterial))
    }

    const wheelParts: THREE.BufferGeometry[] = []

    for (const [x, z] of [
      [-0.95, 1.45],
      [0.95, 1.45],
      [-0.95, -1.45],
      [0.95, -1.45]
    ]) {
      const wheel = new THREE.CylinderGeometry(0.36, 0.36, 0.3, 12)
      wheel.rotateZ(Math.PI / 2)
      wheel.translate(x, 0.36, z)
      wheelParts.push(wheel)
    }

    const wheelGeometry = mergeBufferGeometries(wheelParts)

    for (const part of wheelParts) {
      part.dispose()
    }

    if (wheelGeometry !== null) {
      this.group.add(new THREE.Mesh(wheelGeometry, this.wheelMaterial))
    }

    const lightParts: THREE.BufferGeometry[] = []

    for (const x of [-0.6, 0.6]) {
      const headlight = new THREE.BoxGeometry(0.3, 0.14, 0.06)
      headlight.translate(x, 0.72, 2.11)
      lightParts.push(headlight)
    }

    const lightGeometry = mergeBufferGeometries(lightParts)

    for (const part of lightParts) {
      part.dispose()
    }

    if (lightGeometry !== null) {
      this.group.add(new THREE.Mesh(lightGeometry, this.lightMaterial))
    }
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

  dispose() {
    for (const child of this.group.children) {
      ;(child as THREE.Mesh).geometry?.dispose()
    }

    this.bodyMaterial.dispose()
    this.wheelMaterial.dispose()
    this.lightMaterial.dispose()
  }
}
