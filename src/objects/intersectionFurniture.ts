import * as THREE from 'three'
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js'
import {SignalVisors} from './signalVisors'

import type { CityIntersection } from './cityLayout'
import { ROAD_SURFACE_LIFT_METERS, ROAD_SURFACE_MAX_SAGITTA_METERS } from './roadSurfaceGeometry'
import { CROSSWALK_LENGTH_METERS, CROSSWALK_SETBACK_METERS, isSignalledIntersection,
  signalAspect, signalPhaseOffset, signalStopLineOffset, type SignalRoad } from './intersectionSignals'
export { SIGNAL_CYCLE_SECONDS, signalAspect } from './intersectionSignals'

// Street furniture at road crossings (2026-09-03, 緻密さ③): zebra crosswalks
// on every leg, signal poles with lit heads at arterial junctions, name-plate
// posts at local ones. All instanced, all near-field: only the crossings
// within FURNITURE_RANGE of the player are laid out, and the layout is
// rebuilt when the player has moved REFOCUS_DISTANCE from the last focus.
//
// Frame conventions (rotating frame, habitat axis = world +Y): a crossing at
// (azimuth, axial) sits on the inner wall; its avenue runs axially (±Y), its
// street runs tangentially. Local basis at the crossing: tangent = (−sin, 0,
// cos), inward = (−cos, 0, −sin), axial = +Y. All road arms share one
// elevation. Paint must also clear the road's inward chord sagitta; a log
// depth shader writes gl_FragDepth, so polygonOffset cannot repair burial.

export const FURNITURE_RANGE_METERS = 420
export const REFOCUS_DISTANCE_METERS = 60
export const STRIPE_PITCH = 1.0
export const STRIPE_LENGTH = CROSSWALK_LENGTH_METERS
export const STRIPE_WIDTH = 0.5
export const SIGNAL_POLE_HEIGHT = 5.4
export const SIGNAL_ARM_LENGTH = 3.6
export const SIGN_POST_HEIGHT = 2.6

export type FurnitureTransform = {
  // Local offsets from the crossing centre: `t` along tangent, `a` along the
  // axis, `h` height above the road surface. `yaw` = rotation about the
  // local up (0 = the long side runs axially).
  t: number
  a: number
  h: number
  yaw: number
  // Scale of the unit part (crosswalk stripes stretch; poles do not).
  sx: number
  sy: number
  sz: number
}

export type SignalHeadTransform = FurnitureTransform & {
  // Which road this head governs: 'avenue' heads face axial traffic.
  faces: 'avenue' | 'street'
}

export type FurnitureLayout = {
  stripes: FurnitureTransform[]
  stopLines: FurnitureTransform[]
  poles: FurnitureTransform[]
  arms: FurnitureTransform[]
  heads: SignalHeadTransform[]
  plates: FurnitureTransform[]
  signalled: boolean
}

// Pure: the part transforms for ONE crossing, in its local frame.
export const layoutIntersection = (
  x: CityIntersection,
  radius: number
): FurnitureLayout => {
  const layout: FurnitureLayout = { stripes: [], stopLines: [], poles: [], arms: [], heads: [], plates: [], signalled: false }
  const halfAvenue = x.avenueWidth * 0.5
  const halfStreet = x.streetWidth * 0.5
  // Each bar follows its own position on the cylinder. Reserve clearance
  // for both the road's inward chord and the flat bar's outward corners.
  const roadRadius = radius - ROAD_SURFACE_LIFT_METERS
  const paintLift = (halfTangentSpan: number) => ROAD_SURFACE_MAX_SAGITTA_METERS + 0.01 +
    Math.hypot(roadRadius, halfTangentSpan) - roadRadius
  const avenueLift = paintLift(STRIPE_WIDTH * 0.5)
  const streetLift = paintLift(STRIPE_LENGTH * 0.5)

  // Crosswalks. Legs along the avenue (±axial) cross the AVENUE: bars run
  // axially, repeated across the avenue width. Legs along the street (±tangent)
  // cross the STREET: bars run tangentially, repeated across the street width.
  const setback = CROSSWALK_SETBACK_METERS
  const stripeAcross = (width: number) => {
    const count = Math.max(2, Math.floor(width / STRIPE_PITCH))
    const start = -((count - 1) * STRIPE_PITCH) * 0.5
    return Array.from({ length: count }, (_, i) => start + i * STRIPE_PITCH)
  }
  for (const side of [-1, 1] as const) {
    // crossing the avenue, just beyond the street's edge
    const a = side * (halfStreet + setback + STRIPE_LENGTH * 0.5)
    for (const t of stripeAcross(x.avenueWidth - 0.6)) {
      layout.stripes.push({ t, a, h: avenueLift, yaw: 0, sx: STRIPE_WIDTH, sy: 1, sz: STRIPE_LENGTH })
    }
    // crossing the street, just beyond the avenue's edge
    const t = side * (halfAvenue + setback + STRIPE_LENGTH * 0.5)
    for (const a2 of stripeAcross(x.streetWidth - 0.6)) {
      layout.stripes.push({ t, a: a2, h: streetLift, yaw: Math.PI / 2, sx: STRIPE_WIDTH, sy: 1, sz: STRIPE_LENGTH })
    }
  }

  const signalled = isSignalledIntersection(x)
  layout.signalled = signalled
  const cornerT = halfAvenue + 0.9
  const cornerA = halfStreet + 0.9
  if (signalled) {
    for (const side of [-1, 1]) {
      const avenueLineWidth = halfAvenue - .6, streetLineWidth = halfStreet - .6
      const pieces = Math.ceil(avenueLineWidth / STRIPE_LENGTH), width = avenueLineWidth / pieces
      for (let piece = 0; piece < pieces; piece++) {
        layout.stopLines.push({ t: side * halfAvenue / 2 - avenueLineWidth / 2 + (piece + .5) * width,
          a: side * signalStopLineOffset(x, 'avenue'), h: paintLift(width / 2), yaw: 0, sx: width, sy: 1, sz: .3 })
      }
      layout.stopLines.push({ t: side * signalStopLineOffset(x, 'street'), a: -side * halfStreet / 2,
        h: paintLift(.15), yaw: 0, sx: .3, sy: 1, sz: streetLineWidth })
    }
    // Each corner pole carries one head for each road. Lens normals point
    // toward the approaching driver; the opposite approaches share a phase.
    for (const st of [-1, 1] as const) {
      for (const sa of [-1, 1] as const) {
        layout.poles.push({ t: st * cornerT, a: sa * cornerA, h: 0, yaw: 0, sx: 1, sy: SIGNAL_POLE_HEIGHT, sz: 1 })
        // Arm reaches over the avenue (tangentially inward) from this corner:
        // governs axial (avenue) traffic approaching from the `sa` side.
        const armT = st * (cornerT - SIGNAL_ARM_LENGTH * 0.5)
        layout.arms.push({ t: armT, a: sa * cornerA, h: SIGNAL_POLE_HEIGHT - 0.3, yaw: Math.PI / 2, sx: 1, sy: 1, sz: SIGNAL_ARM_LENGTH })
        layout.heads.push({
          t: st * (cornerT - SIGNAL_ARM_LENGTH + 0.2),
          a: sa * cornerA,
          h: SIGNAL_POLE_HEIGHT - 0.85,
          yaw: sa > 0 ? 0 : Math.PI,
          sx: 1,
          sy: 1,
          sz: 1,
          faces: 'avenue'
        })
        layout.arms.push({ t: st * cornerT, a: sa * (cornerA - SIGNAL_ARM_LENGTH * .5),
          h: SIGNAL_POLE_HEIGHT - .3, yaw: 0, sx: 1, sy: 1, sz: SIGNAL_ARM_LENGTH })
        layout.heads.push({ t: st * cornerT, a: sa * (cornerA - SIGNAL_ARM_LENGTH + .2),
          h: SIGNAL_POLE_HEIGHT - .85, yaw: -st * Math.PI / 2, sx: 1, sy: 1, sz: 1, faces: 'street' })
      }
    }
  } else {
    // Quiet crossing: two name-plate posts on diagonal corners.
    for (const [st, sa] of [[-1, -1], [1, 1]] as const) {
      layout.poles.push({ t: st * cornerT, a: sa * cornerA, h: 0, yaw: 0, sx: 1, sy: SIGN_POST_HEIGHT, sz: 1 })
      layout.plates.push({ t: st * cornerT, a: sa * cornerA, h: SIGN_POST_HEIGHT - 0.25, yaw: Math.PI / 4, sx: 1, sy: 1, sz: 1 })
    }
  }
  return layout
}

// Pure: crossings within range of a focus, by surface distance (tangent arc
// + axial), so the renderer only lays out what can be seen up close.
export const selectNearbyIntersections = (
  all: CityIntersection[],
  radius: number,
  focusAzimuth: number,
  focusAxial: number,
  rangeMeters: number = FURNITURE_RANGE_METERS
): CityIntersection[] => {
  const out: CityIntersection[] = []
  const twoPi = Math.PI * 2
  for (const x of all) {
    if (Math.abs(x.axial - focusAxial) > rangeMeters) continue
    let d = (x.azimuth - focusAzimuth) % twoPi
    if (d > Math.PI) d -= twoPi
    if (d < -Math.PI) d += twoPi
    const tangent = Math.abs(d) * radius
    if (tangent > rangeMeters) continue
    if (Math.hypot(tangent, x.axial - focusAxial) <= rangeMeters) out.push(x)
  }
  return out
}

const ASPECT_COLORS = [new THREE.Color(0x36ff7a), new THREE.Color(0xffc23a), new THREE.Color(0xff3b30)] as const

// Pure: the rotation that takes a part from its local frame (X = −tangent,
// Y = up/inward, Z = axial — a RIGHT-handed triple; tangent × inward is
// −axial, so the naive (tangent, inward, axial) basis is improper and
// setFromRotationMatrix garbles it) to the crossing at `azimuth`.
const basisX = new THREE.Vector3()
const basisY = new THREE.Vector3()
const basisZ = new THREE.Vector3(0, 1, 0)
const basisMatrix = new THREE.Matrix4()
export const crossingQuaternionFor = (azimuth: number, target = new THREE.Quaternion()) => {
  const cos = Math.cos(azimuth)
  const sin = Math.sin(azimuth)
  basisX.set(sin, 0, -cos) // −tangent
  basisY.set(-cos, 0, -sin) // inward (the local up)
  basisZ.set(0, 1, 0) // axial
  basisMatrix.makeBasis(basisX, basisY, basisZ)
  return target.setFromRotationMatrix(basisMatrix)
}

const tangentDir = new THREE.Vector3()
const localUp = new THREE.Vector3(0, 1, 0)
const crossingQuaternion = new THREE.Quaternion()
const yawQuaternion = new THREE.Quaternion()
const partQuaternion = new THREE.Quaternion()
const position = new THREE.Vector3()
const scale = new THREE.Vector3()
const matrix = new THREE.Matrix4()
const colorScratch = new THREE.Color()

type Part = {
  mesh: THREE.InstancedMesh
  capacity: number
}

export class IntersectionFurniture {
  readonly group = new THREE.Group()
  private readonly visors = new SignalVisors(this.group)

  private intersections: CityIntersection[] = []
  private radius = 0
  private focusAzimuth = Number.NaN
  private focusAxial = Number.NaN
  private elapsed = 0
  private nearby: CityIntersection[] = []
  private headPhases: number[] = []
  private headRoads: SignalRoad[] = []
  private night = 0

  private readonly stripeMaterial = new THREE.MeshStandardMaterial({
    color: 0xe9ecef,
    roughness: 0.85,
    metalness: 0,
    emissive: 0x000000
  })
  private readonly poleMaterial = new THREE.MeshStandardMaterial({
    color: 0x3b4149,
    roughness: 0.6,
    metalness: 0.6
  })
  private readonly headMaterial = new THREE.MeshStandardMaterial({
    color: 0x14181d,
    roughness: 0.7,
    metalness: 0.2
  })
  private readonly lampMaterial = new THREE.MeshBasicMaterial({
    color: 0xffffff,
    toneMapped: false
  })
  private readonly plateMaterial = new THREE.MeshStandardMaterial({
    color: 0x2a5fb4,
    roughness: 0.5,
    metalness: 0.2,
    emissive: 0x0a1a3a,
    emissiveIntensity: 0
  })

  private readonly stripes: Part
  private readonly poles: Part
  private readonly arms: Part
  private readonly heads: Part
  private readonly lamps: Part
  private readonly plates: Part

  constructor() {
    const make = (geometry: THREE.BufferGeometry, material: THREE.Material, capacity: number): Part => {
      const mesh = new THREE.InstancedMesh(geometry, material, capacity)
      mesh.count = 0
      mesh.frustumCulled = false
      mesh.castShadow = false
      this.group.add(mesh)
      return { mesh, capacity }
    }
    // Unit parts: stripe 1×0.02×1 scaled per instance; pole 1 m tall scaled
    // in y; arm 1 m long in z; head/lamp/plate fixed size.
    const stripe = new THREE.BoxGeometry(1, 0.02, 1)
    stripe.translate(0, 0.01, 0)
    const pole = new THREE.CylinderGeometry(0.09, 0.11, 1, 10)
    pole.translate(0, 0.5, 0)
    const arm = new THREE.CylinderGeometry(0.06, 0.06, 1, 8)
    arm.rotateX(Math.PI / 2)
    const body = new THREE.BoxGeometry(0.36, 0.95, 0.3)
    // A short hanger intersects both the housing and its supporting arm.
    const hanger = new THREE.BoxGeometry(.1,.15,.1).translate(0,.5,0)
    const head = mergeGeometries([body,hanger])!;body.dispose();hanger.dispose()
    const lamp = new THREE.CircleGeometry(.105,12).translate(0,0,.156)
    const plate = new THREE.BoxGeometry(0.7, 0.24, 0.03)
    this.stripes = make(stripe, this.stripeMaterial, 4096)
    this.stripes.mesh.name = 'crosswalk-stripes'
    this.poles = make(pole, this.poleMaterial, 512)
    this.arms = make(arm, this.poleMaterial, 512)
    this.arms.mesh.name = 'intersection-signal-arms'
    this.heads = make(head, this.headMaterial, 512)
    this.heads.mesh.name = 'intersection-signal-heads'
    this.lamps = make(lamp, this.lampMaterial, 512 * 3)
    this.lamps.mesh.name = 'intersection-signal-lamps'
    this.plates = make(plate, this.plateMaterial, 256)
    this.lamps.mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(512 * 3 * 3), 3)
  }

  setPlan(intersections: CityIntersection[], radius: number) {
    this.intersections = intersections
    this.radius = radius
    this.focusAzimuth = Number.NaN
    this.focusAxial = Number.NaN
    this.nearby = []
    this.headPhases.length = 0
    this.headRoads.length = 0
    this.visors.setHeads(null)
    for (const part of [this.stripes, this.poles, this.arms, this.heads, this.lamps, this.plates]) part.mesh.count = 0
  }

  setDaylight(daylight: number) {
    this.night = 1 - THREE.MathUtils.clamp(daylight, 0, 1)
    this.plateMaterial.emissiveIntensity = this.night * 0.5
  }

  // Called every frame with the player's surface position. Relayout only
  // when the focus has moved far enough; the signal lamps animate always.
  update(focusAzimuth: number, focusAxial: number, deltaSeconds: number, clockSeconds?: number) {
    this.elapsed = clockSeconds ?? this.elapsed + Math.max(0, deltaSeconds)
    if (this.radius <= 0 || this.intersections.length === 0) {
      return
    }
    const moved =
      Number.isNaN(this.focusAzimuth) ||
      Math.hypot(
        Math.abs(THREE.MathUtils.euclideanModulo(focusAzimuth - this.focusAzimuth + Math.PI, Math.PI * 2) - Math.PI) *
          this.radius,
        focusAxial - this.focusAxial
      ) > REFOCUS_DISTANCE_METERS
    if (moved) {
      this.focusAzimuth = focusAzimuth
      this.focusAxial = focusAxial
      this.relayout()
    }
    this.animateLamps()
    this.visors.update(focusAzimuth,focusAxial,this.radius)
  }

  private place(part: Part, index: number, x: CityIntersection, transform: FurnitureTransform, surfaceDrop: number) {
    // Crosswalks hug the cylinder instead of the crossing's tangent plane.
    // Signals retain one shared frame so their poles, arms and heads join.
    const curved = part === this.stripes
    const azimuth = x.azimuth + (curved ? transform.t / this.radius : 0)
    const cos = Math.cos(azimuth)
    const sin = Math.sin(azimuth)
    tangentDir.set(-sin, 0, cos)
    crossingQuaternionFor(azimuth, crossingQuaternion)
    yawQuaternion.setFromAxisAngle(localUp, transform.yaw)
    partQuaternion.copy(crossingQuaternion).multiply(yawQuaternion)
    // Position: wall point at the crossing, then local offsets (t along the
    // tangent, a along the axis, h inward).
    const radial = this.radius - surfaceDrop - transform.h
    position.set(cos * radial, x.axial, sin * radial)
    if (!curved) position.addScaledVector(tangentDir, transform.t)
    position.y += transform.a
    scale.set(transform.sx, transform.sy, transform.sz)
    matrix.compose(position, partQuaternion, scale)
    part.mesh.setMatrixAt(index, matrix)
  }

  private relayout() {
    this.nearby = selectNearbyIntersections(this.intersections, this.radius, this.focusAzimuth, this.focusAxial)
    let nStripe = 0
    let nPole = 0
    let nArm = 0
    let nHead = 0
    let nPlate = 0
    this.headPhases.length = 0
    this.headRoads.length = 0
    for (const x of this.nearby) {
      const layout = layoutIntersection(x, this.radius)
      for (const s of [...layout.stripes, ...layout.stopLines]) {
        if (nStripe >= this.stripes.capacity) break
        this.place(this.stripes, nStripe++, x, s, ROAD_SURFACE_LIFT_METERS)
      }
      for (const p of layout.poles) {
        if (nPole >= this.poles.capacity) break
        this.place(this.poles, nPole++, x, p, ROAD_SURFACE_LIFT_METERS - 0.06)
      }
      for (const a of layout.arms) {
        if (nArm >= this.arms.capacity) break
        this.place(this.arms, nArm++, x, a, ROAD_SURFACE_LIFT_METERS - 0.06)
      }
      const phase = signalPhaseOffset(x)
      for (const h of layout.heads) {
        if (nHead >= this.heads.capacity) break
        this.place(this.heads, nHead, x, h, ROAD_SURFACE_LIFT_METERS - 0.06)
        for (let aspect = 0; aspect < 3; aspect++) {
          this.place(this.lamps, nHead * 3 + aspect, x, { ...h, h: h.h + (aspect - 1) * .28 }, ROAD_SURFACE_LIFT_METERS - .06)
        }
        this.headPhases.push(phase)
        this.headRoads.push(h.faces)
        nHead++
      }
      for (const p of layout.plates) {
        if (nPlate >= this.plates.capacity) break
        this.place(this.plates, nPlate++, x, p, ROAD_SURFACE_LIFT_METERS - 0.06)
      }
    }
    for (const [part, count] of [
      [this.stripes, nStripe],
      [this.poles, nPole],
      [this.arms, nArm],
      [this.heads, nHead],
      [this.lamps, nHead * 3],
      [this.plates, nPlate]
    ] as const) {
      part.mesh.count = count
      part.mesh.instanceMatrix.needsUpdate = true
    }
    this.visors.setHeads(this.heads.mesh)
  }

  private animateLamps() {
    const color = this.lamps.mesh.instanceColor
    if (color === null || this.lamps.mesh.count === 0) return
    for (let i = 0; i < this.heads.mesh.count; i++) {
      const active = signalAspect(this.elapsed, this.headPhases[i] ?? 0, this.headRoads[i])
      for (let aspect = 0; aspect < 3; aspect++) {
        colorScratch.copy(ASPECT_COLORS[aspect]).multiplyScalar(aspect === active ? 1 : .035)
        color.setXYZ(i * 3 + aspect, colorScratch.r, colorScratch.g, colorScratch.b)
      }
    }
    color.needsUpdate = true
  }

  dispose() {
    this.visors.dispose()
    for (const part of [this.stripes, this.poles, this.arms, this.heads, this.lamps, this.plates]) {
      part.mesh.geometry.dispose()
      part.mesh.dispose()
    }
    for (const m of [this.stripeMaterial, this.poleMaterial, this.headMaterial, this.lampMaterial, this.plateMaterial]) {
      m.dispose()
    }
  }
}
