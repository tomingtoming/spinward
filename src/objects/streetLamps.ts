import * as THREE from 'three'

import type { CityIntersection, CityRoad } from './cityLayout'
import { getArterialRoadWidth, getLocalRoadWidth } from './cityLayout'

// Near-field street lamps (2026-09-03, toming「街路灯の間隔」): posts with an
// arm, a warm head and a light pool on the road, on EVERY grid road at real
// street-lighting spacing, laid out only around the player (same scheme as
// intersectionFurniture / parkedCars). The far city keeps cityscape's sparse
// global dots (one every 2.2 cells on the arterial avenues) for the glow
// network seen from across the cylinder; up close those are too far apart
// (176 m) to read as street lighting, and posts/pools for all ~40k spots
// would not fit a phone.
//
// Frame: rotating, axis = +Y. A lamp sits at the kerb of its road, alternating
// sides; the arm reaches over the road; the pool is centred under the head.

export const LAMP_RANGE_METERS = 450
export const LAMP_REFOCUS_METERS = 50
export const LAMP_SPACING_ARTERIAL = 44
export const LAMP_SPACING_LOCAL = 60
export const LAMP_CROSSING_CLEARANCE = 7

export type LampSpot = {
  azimuth: number
  axial: number
  // Road orientation: avenues run axially (lamp arm reaches tangentially).
  isAvenue: boolean
  // Which side of the road the post stands on (±tangent for avenues, ±axial
  // for streets).
  side: 1 | -1
  roadHalfWidth: number
  kind: 'arterial' | 'local'
}

const TWO_PI = Math.PI * 2
const wrapToPi = (angle: number) => {
  const wrapped = ((angle % TWO_PI) + TWO_PI) % TWO_PI
  return wrapped > Math.PI ? wrapped - TWO_PI : wrapped
}

// Pure: every lamp position in the plan (no RNG). Alternating kerb sides
// along each road; nothing within a crossing's clearance so posts never
// stand in a crosswalk.
export const planLampSpots = (
  roads: CityRoad[],
  intersections: CityIntersection[],
  radius: number
): LampSpot[] => {
  const out: LampSpot[] = []
  if (radius <= 0) return out
  for (const road of roads) {
    if (road.kind === 'alley') continue
    const isAvenue = road.axialLength > road.tangentWidth
    const spacing = road.kind === 'arterial' ? LAMP_SPACING_ARTERIAL : LAMP_SPACING_LOCAL
    const halfWidth = (isAvenue ? road.tangentWidth : road.axialLength) * 0.5
    const length = isAvenue ? road.axialLength : road.tangentWidth
    const count = Math.floor(length / spacing)
    if (count < 1) continue
    const crossings = isAvenue
      ? intersections
          .filter((x) => Math.abs(wrapToPi(x.azimuth - road.azimuth)) * radius < 0.5)
          .map((x) => ({ at: x.axial, half: x.streetWidth * 0.5 }))
      : intersections
          .filter((x) => Math.abs(x.axial - road.axial) < 0.5)
          .map((x) => ({ at: wrapToPi(x.azimuth - road.azimuth) * radius, half: x.avenueWidth * 0.5 }))
    for (let index = 0; index < count; index += 1) {
      const along = -length * 0.5 + (index + 0.5) * spacing
      if (crossings.some((c) => Math.abs(along - c.at) < c.half + LAMP_CROSSING_CLEARANCE)) continue
      const side: 1 | -1 = index % 2 === 0 ? 1 : -1
      out.push({
        azimuth: isAvenue ? road.azimuth : road.azimuth + along / radius,
        axial: isAvenue ? road.axial + along : road.axial,
        isAvenue,
        side,
        roadHalfWidth: halfWidth,
        kind: road.kind === 'arterial' ? 'arterial' : 'local'
      })
    }
  }
  return out
}

export const selectNearbyLamps = (
  spots: LampSpot[],
  radius: number,
  focusAzimuth: number,
  focusAxial: number,
  rangeMeters: number = LAMP_RANGE_METERS
): LampSpot[] => {
  const out: LampSpot[] = []
  for (const s of spots) {
    if (Math.abs(s.axial - focusAxial) > rangeMeters) continue
    const tangent = Math.abs(wrapToPi(s.azimuth - focusAzimuth)) * radius
    if (tangent > rangeMeters) continue
    if (Math.hypot(tangent, s.axial - focusAxial) <= rangeMeters) out.push(s)
  }
  return out
}

// Radial falloff for the light pools: bright centre, gone by the rim.
export const createLampPoolTexture = () => {
  const size = 128
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const context = canvas.getContext('2d')
  if (context === null) throw new Error('2D canvas context is required for the lamp pool texture')
  const gradient = context.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2)
  gradient.addColorStop(0, 'rgba(255, 255, 255, 0.9)')
  gradient.addColorStop(0.3, 'rgba(255, 255, 255, 0.45)')
  gradient.addColorStop(0.65, 'rgba(255, 255, 255, 0.12)')
  gradient.addColorStop(1, 'rgba(255, 255, 255, 0)')
  context.fillStyle = gradient
  context.fillRect(0, 0, size, size)
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  return texture
}

const LAMP_DAY = new THREE.Color(0x6b5a40)
const LAMP_NIGHT = new THREE.Color(0xffe2b0)
const junctionGapFor = (radius: number) => Math.max(0.03, radius * 1.5e-5)

const tangent = new THREE.Vector3()
const inward = new THREE.Vector3()
const unitY = new THREE.Vector3(0, 1, 0)
const unitZ = new THREE.Vector3(0, 0, 1)
const basis = new THREE.Matrix4()
const postQuaternion = new THREE.Quaternion()
const armQuaternion = new THREE.Quaternion()
const poolQuaternion = new THREE.Quaternion()
const yawScratch = new THREE.Quaternion()
const identity = new THREE.Quaternion()
const position = new THREE.Vector3()
const scale = new THREE.Vector3()
const matrix = new THREE.Matrix4()

type Part = { mesh: THREE.InstancedMesh; capacity: number }

export class StreetLamps {
  readonly group = new THREE.Group()

  private spots: LampSpot[] = []
  private radius = 0
  private lampHeight = 8
  private focusAzimuth = Number.NaN
  private focusAxial = Number.NaN

  private readonly poleMaterial = new THREE.MeshStandardMaterial({ color: 0x3b4149, roughness: 0.6, metalness: 0.6 })
  private readonly headMaterial = new THREE.MeshBasicMaterial({ color: 0xffe2b0, toneMapped: false })
  private readonly poolMaterial = new THREE.MeshBasicMaterial({
    map: createLampPoolTexture(),
    // HDR warm: must beat the tone-mapped asphalt and feed the desktop bloom.
    color: new THREE.Color(2.3, 1.9, 1.35),
    transparent: true,
    opacity: 0,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
    toneMapped: false
  })

  private readonly posts: Part
  private readonly arms: Part
  private readonly heads: Part
  private readonly pools: Part

  constructor() {
    const make = (geometry: THREE.BufferGeometry, material: THREE.Material, capacity: number): Part => {
      const mesh = new THREE.InstancedMesh(geometry, material, capacity)
      mesh.count = 0
      mesh.frustumCulled = false
      this.group.add(mesh)
      return { mesh, capacity }
    }
    const post = new THREE.CylinderGeometry(0.07, 0.1, 1, 8)
    post.translate(0, 0.5, 0)
    const arm = new THREE.CylinderGeometry(0.05, 0.05, 1, 8)
    arm.translate(0, 0.5, 0)
    const head = new THREE.BoxGeometry(0.5, 0.18, 0.28)
    const pool = new THREE.CircleGeometry(1, 24)
    this.posts = make(post, this.poleMaterial, 512)
    this.arms = make(arm, this.poleMaterial, 512)
    this.heads = make(head, this.headMaterial, 512)
    this.pools = make(pool, this.poolMaterial, 512)
    // Transparent pass sorts by object origin (here the cylinder axis, 3 km
    // away): draw the pools late so nearer transparents do not cover them.
    this.pools.mesh.renderOrder = 20
  }

  setPlan(roads: CityRoad[], intersections: CityIntersection[], radius: number, length: number) {
    this.spots = planLampSpots(roads, intersections, radius)
    this.radius = radius
    // Same height rule as the far dots (cityscape buildLamps) so near and far
    // lamps agree where the light is.
    const cell = Math.max(getArterialRoadWidth(radius, length) * 2, 20)
    this.lampHeight = THREE.MathUtils.clamp(cell * 0.55, 3, 12)
    void getLocalRoadWidth
    this.focusAzimuth = Number.NaN
    this.focusAxial = Number.NaN
  }

  setDaylight(daylight: number) {
    const night = 1 - THREE.MathUtils.clamp(daylight, 0, 1)
    this.headMaterial.color.lerpColors(LAMP_NIGHT, LAMP_DAY, daylight)
    this.poolMaterial.opacity = night * night
  }

  update(focusAzimuth: number, focusAxial: number) {
    if (this.radius <= 0 || this.spots.length === 0) return
    const moved =
      Number.isNaN(this.focusAzimuth) ||
      Math.hypot(Math.abs(wrapToPi(focusAzimuth - this.focusAzimuth)) * this.radius, focusAxial - this.focusAxial) >
        LAMP_REFOCUS_METERS
    if (!moved) return
    this.focusAzimuth = focusAzimuth
    this.focusAxial = focusAxial
    this.relayout()
  }

  private relayout() {
    const nearby = selectNearbyLamps(this.spots, this.radius, this.focusAzimuth, this.focusAxial)
    const gap = junctionGapFor(this.radius)
    const h = this.lampHeight
    const armLength = Math.min(4, h * 0.35)
    const poolRadius = Math.max(4, h * 0.9)
    let n = 0
    for (const s of nearby) {
      if (n >= this.posts.capacity) break
      const cos = Math.cos(s.azimuth)
      const sin = Math.sin(s.azimuth)
      tangent.set(-sin, 0, cos)
      inward.set(-cos, 0, -sin)
      // Proper right-handed local frame: X = −tangent, Y = up (inward), Z = axial.
      basis.makeBasis(tangent.clone().negate(), inward, unitY)
      postQuaternion.setFromRotationMatrix(basis)
      // Across-road direction for this lamp: tangent for avenues, axial for streets.
      const acrossX = s.isAvenue ? tangent.x : 0
      const acrossY = s.isAvenue ? 0 : 1
      const acrossZ = s.isAvenue ? tangent.z : 0
      const kerb = s.roadHalfWidth + 0.6
      const deck = this.radius - 0.2 - (s.isAvenue && s.kind === 'arterial' ? gap : 0)
      // Post at the kerb.
      position.set(cos, 0, sin).multiplyScalar(deck)
      position.y = s.axial
      position.x += acrossX * s.side * kerb
      position.y += acrossY * s.side * kerb
      position.z += acrossZ * s.side * kerb
      scale.set(1, h - 0.3, 1)
      matrix.compose(position, postQuaternion, scale)
      this.posts.mesh.setMatrixAt(n, matrix)
      // Arm: from the post top, horizontally over the road (toward −side).
      // The arm cylinder's +Y maps onto the across direction via a yaw of the
      // local frame: for avenues rotate about local Z (axial) so Y → ∓X...
      // simpler: build the arm's own basis with Y = −side·across.
      const acrossVec = position.set(acrossX, acrossY, acrossZ).multiplyScalar(-s.side)
      const armUp = acrossVec.clone()
      const armZ = inward.clone().cross(armUp).normalize()
      basis.makeBasis(armZ.clone().cross(armUp).normalize(), armUp, armZ)
      armQuaternion.setFromRotationMatrix(basis)
      position.set(cos, 0, sin).multiplyScalar(deck - (h - 0.3))
      position.y = s.axial
      position.x += acrossX * s.side * kerb
      position.y += acrossY * s.side * kerb
      position.z += acrossZ * s.side * kerb
      scale.set(1, armLength, 1)
      matrix.compose(position, armQuaternion, scale)
      this.arms.mesh.setMatrixAt(n, matrix)
      // Head at the arm's end, hanging just below it.
      position.set(cos, 0, sin).multiplyScalar(deck - (h - 0.45))
      position.y = s.axial
      position.x += acrossX * s.side * (kerb - armLength)
      position.y += acrossY * s.side * (kerb - armLength)
      position.z += acrossZ * s.side * (kerb - armLength)
      scale.set(1, 1, 1)
      matrix.compose(position, postQuaternion, scale)
      this.heads.mesh.setMatrixAt(n, matrix)
      // Pool on the road under the head (disc normal = inward: basis X =
      // tangent, Y = axial, Z = inward is right-handed).
      basis.makeBasis(tangent, unitY, inward)
      poolQuaternion.setFromRotationMatrix(basis)
      position.set(cos, 0, sin).multiplyScalar(deck - 0.03)
      position.y = s.axial
      position.x += acrossX * s.side * (kerb - armLength)
      position.y += acrossY * s.side * (kerb - armLength)
      position.z += acrossZ * s.side * (kerb - armLength)
      scale.set(poolRadius, poolRadius, 1)
      matrix.compose(position, poolQuaternion, scale)
      this.pools.mesh.setMatrixAt(n, matrix)
      n += 1
    }
    for (const part of [this.posts, this.arms, this.heads, this.pools]) {
      part.mesh.count = n
      part.mesh.instanceMatrix.needsUpdate = true
    }
    void yawScratch
    void unitZ
    void identity
  }

  dispose() {
    for (const part of [this.posts, this.arms, this.heads, this.pools]) {
      part.mesh.geometry.dispose()
      part.mesh.dispose()
    }
    this.poleMaterial.dispose()
    this.headMaterial.dispose()
    this.poolMaterial.map?.dispose()
    this.poolMaterial.dispose()
  }
}
