import * as THREE from 'three'

import { mergeBufferGeometries } from './cylinder'

// The player's car: a colony rover. Local axes: +Z forward, +Y up, base at
// y = 0; footprint ≈ 1.9 × 4.2 m (wheels at x = ±0.95, z = ±1.45), roof at
// ~1.36 m so the driver eye (standing eye + DRIVER_VIEW_RAISE) clears it.
//
// 2026-09-03 rebuild (toming「自分の車どうにかしたい」): the old two boxes
// became a bevelled monocoque extruded from a side profile with wheel-arch
// cutouts, a tinted glass greenhouse on body-colour pillars, sculpted tyres
// with metal rims, full-width light bars front and back, mirrors, roof rails
// and an aerial. Everything is procedural (no assets) and ~4k triangles.

const outward = new THREE.Vector3()
const inward = new THREE.Vector3()
const axial = new THREE.Vector3(0, 1, 0)
const tangentDir = new THREE.Vector3()
const forward = new THREE.Vector3()
const right = new THREE.Vector3()
const basis = new THREE.Matrix4()

// Cyan glow laid over the body's emissive while the VR pointer is on the car.
const HIGHLIGHT_EMISSIVE = new THREE.Color(0x2aa0b4)
const BASE_EMISSIVE = new THREE.Color(0x000000)

const BODY_WIDTH = 1.62
const CABIN_WIDTH = 1.46
const WHEEL_TRACK = 0.95
const WHEEL_BASE_HALF = 1.45
const WHEEL_RADIUS = 0.36
const BELT_LINE = 0.92
const ROOF = 1.36

// Side profile in (forward z, up y). Drawn counter-clockwise from the rear
// sill; wheel arches are notched into the underside with arcs.
const bodyProfile = (): THREE.Shape => {
  const s = new THREE.Shape()
  const sill = 0.34
  const arch = WHEEL_RADIUS + 0.07
  s.moveTo(-2.1, sill)
  // underside with two wheel arches (rear, front)
  s.lineTo(-WHEEL_BASE_HALF - arch, sill)
  s.absarc(-WHEEL_BASE_HALF, sill, arch, Math.PI, 0, true)
  s.lineTo(WHEEL_BASE_HALF - arch, sill)
  s.absarc(WHEEL_BASE_HALF, sill, arch, Math.PI, 0, true)
  s.lineTo(2.05, sill)
  // front bumper, nose, bonnet
  s.lineTo(2.12, 0.52)
  s.lineTo(2.08, 0.78)
  s.lineTo(1.75, BELT_LINE - 0.04)
  // belt line continues under the glasshouse (the cabin is a separate part)
  s.lineTo(0.55, BELT_LINE)
  s.lineTo(-1.35, BELT_LINE)
  s.lineTo(-1.95, BELT_LINE - 0.06)
  // tail
  s.lineTo(-2.12, 0.62)
  s.lineTo(-2.1, sill)
  return s
}

// Greenhouse profile: raked windscreen, flat roof, sloped rear glass.
const cabinProfile = (): THREE.Shape => {
  const s = new THREE.Shape()
  s.moveTo(-1.32, BELT_LINE)
  s.lineTo(0.5, BELT_LINE)
  s.lineTo(-0.05, ROOF)
  s.lineTo(-1.05, ROOF)
  s.lineTo(-1.32, BELT_LINE)
  return s
}

// Extrude a (forward, up) profile across the car's width, centred on x = 0.
const extrudeAcross = (
  shape: THREE.Shape,
  width: number,
  bevel: number
): THREE.BufferGeometry => {
  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth: width,
    bevelEnabled: bevel > 0,
    bevelThickness: bevel,
    bevelSize: bevel,
    bevelSegments: 3,
    steps: 1,
    curveSegments: 10
  })
  // Shape x (forward) → world z, extrusion z → world x.
  geometry.rotateY(-Math.PI / 2)
  geometry.translate(width * 0.5, 0, 0)
  geometry.computeVertexNormals()
  return geometry
}

const box = (w: number, h: number, d: number, x: number, y: number, z: number) => {
  const g = new THREE.BoxGeometry(w, h, d)
  g.translate(x, y, z)
  return g
}

const merged = (parts: THREE.BufferGeometry[]): THREE.BufferGeometry | null => {
  const result = mergeBufferGeometries(parts)
  for (const part of parts) part.dispose()
  return result
}

export class Car {
  readonly group = new THREE.Group()

  private highlighted = false

  private readonly bodyMaterial = new THREE.MeshPhysicalMaterial({
    color: 0x5fb3c2,
    roughness: 0.32,
    metalness: 0.55,
    clearcoat: 1,
    clearcoatRoughness: 0.12
  })

  private readonly trimMaterial = new THREE.MeshStandardMaterial({
    color: 0x1a2027,
    roughness: 0.7,
    metalness: 0.2
  })

  private readonly glassMaterial = new THREE.MeshPhysicalMaterial({
    color: 0x1b3140,
    roughness: 0.06,
    metalness: 0.1,
    clearcoat: 1,
    clearcoatRoughness: 0.05,
    transparent: true,
    opacity: 0.72,
    depthWrite: false,
    side: THREE.DoubleSide
  })

  private readonly tyreMaterial = new THREE.MeshStandardMaterial({
    color: 0x14181d,
    roughness: 0.95,
    metalness: 0.05
  })

  private readonly rimMaterial = new THREE.MeshStandardMaterial({
    color: 0xb9c2cc,
    roughness: 0.35,
    metalness: 0.9
  })

  private readonly headlightMaterial = new THREE.MeshBasicMaterial({
    color: 0xfff1c4,
    toneMapped: false
  })

  private readonly taillightMaterial = new THREE.MeshBasicMaterial({
    color: 0xff3b2f,
    toneMapped: false
  })

  private readonly materials: THREE.Material[] = [
    this.bodyMaterial,
    this.trimMaterial,
    this.glassMaterial,
    this.tyreMaterial,
    this.rimMaterial,
    this.headlightMaterial,
    this.taillightMaterial
  ]

  constructor() {
    const add = (geometry: THREE.BufferGeometry | null, material: THREE.Material) => {
      if (geometry !== null) {
        this.group.add(new THREE.Mesh(geometry, material))
      }
    }

    // Monocoque + roof rails + mirror housings + pillars (body colour).
    add(
      merged([
        extrudeAcross(bodyProfile(), BODY_WIDTH, 0.07),
        // solid roof panel over the glasshouse (real cars are glass on the
        // sides, painted on top — a fully glazed cabin read as "no roof")
        box(CABIN_WIDTH - 0.02, 0.05, 1.02, 0, ROOF + 0.01, -0.55),
        // roof rails
        box(0.06, 0.05, 1.0, -0.62, ROOF + 0.06, -0.55),
        box(0.06, 0.05, 1.0, 0.62, ROOF + 0.06, -0.55),
        // A / C pillars, so the glasshouse reads as glass IN a frame
        box(0.07, ROOF - BELT_LINE + 0.02, 0.09, -CABIN_WIDTH * 0.5, (ROOF + BELT_LINE) * 0.5, 0.24),
        box(0.07, ROOF - BELT_LINE + 0.02, 0.09, CABIN_WIDTH * 0.5, (ROOF + BELT_LINE) * 0.5, 0.24),
        box(0.07, ROOF - BELT_LINE + 0.02, 0.09, -CABIN_WIDTH * 0.5, (ROOF + BELT_LINE) * 0.5, -1.18),
        box(0.07, ROOF - BELT_LINE + 0.02, 0.09, CABIN_WIDTH * 0.5, (ROOF + BELT_LINE) * 0.5, -1.18),
        // mirror housings on short stalks
        box(0.18, 0.1, 0.12, -0.98, BELT_LINE + 0.12, 0.42),
        box(0.18, 0.1, 0.12, 0.98, BELT_LINE + 0.12, 0.42)
      ]),
      this.bodyMaterial
    )

    // Dark trim: sill skirt, grille, rear diffuser, mirror stalks, aerial base,
    // and the cabin interior (dash, bench seats, rear shelf) — a tinted
    // glasshouse over an EMPTY cabin reads as a convertible seen through
    // both windows; the interior is what makes glass read as glass.
    add(
      merged([
        box(BODY_WIDTH + 0.1, 0.16, 3.9, 0, 0.3, 0),
        box(CABIN_WIDTH - 0.1, 0.22, 0.5, 0, BELT_LINE + 0.1, 0.22),
        box(CABIN_WIDTH - 0.16, 0.34, 0.42, 0, BELT_LINE + 0.16, -0.3),
        box(CABIN_WIDTH - 0.16, 0.34, 0.42, 0, BELT_LINE + 0.16, -0.95),
        box(CABIN_WIDTH - 0.1, 0.08, 0.3, 0, BELT_LINE + 0.03, -1.2),
        box(0.9, 0.14, 0.06, 0, 0.62, 2.12),
        box(1.2, 0.12, 0.06, 0, 0.42, -2.13),
        box(0.16, 0.03, 0.03, -0.9, BELT_LINE + 0.07, 0.42),
        box(0.16, 0.03, 0.03, 0.9, BELT_LINE + 0.07, 0.42),
        box(0.05, 0.05, 0.05, 0.55, ROOF + 0.08, -1.0)
      ]),
      this.trimMaterial
    )

    // Aerial.
    const aerial = new THREE.CylinderGeometry(0.008, 0.012, 0.42, 6)
    aerial.translate(0.55, ROOF + 0.3, -1.0)
    add(aerial, this.rimMaterial)

    // Glasshouse: one tinted extrude, slightly narrower than the body.
    add(extrudeAcross(cabinProfile(), CABIN_WIDTH, 0.03), this.glassMaterial)

    // Wheels: tyre + rim + hub, per corner.
    const tyres: THREE.BufferGeometry[] = []
    const rims: THREE.BufferGeometry[] = []
    for (const [x, z] of [
      [-WHEEL_TRACK, WHEEL_BASE_HALF],
      [WHEEL_TRACK, WHEEL_BASE_HALF],
      [-WHEEL_TRACK, -WHEEL_BASE_HALF],
      [WHEEL_TRACK, -WHEEL_BASE_HALF]
    ]) {
      const tyre = new THREE.CylinderGeometry(WHEEL_RADIUS, WHEEL_RADIUS, 0.26, 24)
      tyre.rotateZ(Math.PI / 2)
      tyre.translate(x, WHEEL_RADIUS, z)
      tyres.push(tyre)
      const outer = Math.sign(x)
      const rim = new THREE.CylinderGeometry(0.23, 0.23, 0.05, 14)
      rim.rotateZ(Math.PI / 2)
      rim.translate(x + outer * 0.115, WHEEL_RADIUS, z)
      rims.push(rim)
      const hub = new THREE.CylinderGeometry(0.07, 0.07, 0.06, 10)
      hub.rotateZ(Math.PI / 2)
      hub.translate(x + outer * 0.13, WHEEL_RADIUS, z)
      rims.push(hub)
    }
    add(merged(tyres), this.tyreMaterial)
    add(merged(rims), this.rimMaterial)

    // Light bars: a slim full-width strip at the nose and tail, plus the two
    // headlamp blocks the old car had (they still read as eyes at night).
    add(
      merged([
        box(BODY_WIDTH * 0.82, 0.05, 0.03, 0, 0.8, 2.11),
        box(0.3, 0.14, 0.05, -0.55, 0.66, 2.12),
        box(0.3, 0.14, 0.05, 0.55, 0.66, 2.12)
      ]),
      this.headlightMaterial
    )
    add(box(BODY_WIDTH * 0.86, 0.06, 0.03, 0, 0.72, -2.13), this.taillightMaterial)
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

  // Cyan glow when the right VR pointer is aimed at the car — signals it can be
  // entered. Mutates the existing emissive in place; allocates nothing per call.
  setHighlighted(on: boolean) {
    if (on === this.highlighted) {
      return
    }
    this.highlighted = on
    this.bodyMaterial.emissive.copy(on ? HIGHLIGHT_EMISSIVE : BASE_EMISSIVE)
  }

  dispose() {
    for (const child of this.group.children) {
      ;(child as THREE.Mesh).geometry?.dispose()
    }
    for (const material of this.materials) {
      material.dispose()
    }
  }
}
