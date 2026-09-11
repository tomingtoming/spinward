import * as THREE from 'three'

const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a))
const clamp = THREE.MathUtils.clamp
export type BodyFoot = { tangent: number; axial: number; lift: number; heading: number; planted: boolean }
export type BodyMotionInput = {
  radius: number; azimuth: number; axial: number; heading: number
  grounded: boolean; deltaSeconds: number
}

/** Surface-space foot anchors. Stance feet remain fixed while the body moves;
 * only one foot swings at a time. Teleports reset without generating footsteps. */
export class PlayerBodyMotion {
  readonly feet: [BodyFoot, BodyFoot] = [
    { tangent: 0, axial: 0, lift: 0, heading: 0, planted: true },
    { tangent: 0, axial: 0, lift: 0, heading: 0, planted: true }
  ]
  heading = 0
  tangent = 0
  axial = 0
  speed = 0
  steps = 0
  private radius = 0
  private previousAzimuth = 0
  private active = -1
  private swingTime = 0
  private duration = .3
  private start = { tangent: 0, axial: 0, heading: 0 }
  private end = { tangent: 0, axial: 0, heading: 0 }
  private wasGrounded = false

  reset() { this.radius = 0; this.active = -1; this.speed = 0 }

  update(input: BodyMotionInput): boolean {
    const dt = clamp(input.deltaSeconds, 0, .1)
    const dT = wrap(input.azimuth - this.previousAzimuth) * input.radius
    const dA = input.axial - this.axial
    const distance = Math.hypot(dT, dA)
    const reset = this.radius !== input.radius || distance > 2 || (!this.wasGrounded && input.grounded)
    this.previousAzimuth = input.azimuth
    this.wasGrounded = input.grounded
    if (reset) {
      this.radius = input.radius
      this.tangent = input.azimuth * input.radius
      this.axial = input.axial
      this.heading = input.heading
      this.speed = 0
      this.active = -1
      for (let i = 0; i < 2; i++) Object.assign(this.feet[i], this.stance(i), { lift: input.grounded ? 0 : .08, planted: input.grounded })
      return false
    }
    this.tangent += dT
    this.axial = input.axial
    const speed = dt > 0 ? distance / dt : 0
    this.speed += (Math.min(8, speed) - this.speed) * (1 - Math.exp(-dt * 12))
    const turn = wrap(input.heading - this.heading)
    const moving = this.speed > .15
    if (moving || Math.abs(turn) > .8) this.heading += clamp(turn, -dt * 3.5, dt * 3.5)
    if (!input.grounded) {
      this.active = -1
      for (let i = 0; i < 2; i++) Object.assign(this.feet[i], this.stance(i), { lift: .08, planted: false })
      return false
    }

    let landed = false
    if (this.active !== -1) {
      const foot = this.feet[this.active]
      this.duration = Math.min(this.duration, clamp(.55 / Math.max(1, speed), .07, .34))
      this.swingTime += dt
      if (moving && distance > 1e-5) {
        const desired = this.stance(this.active)
        const remaining = Math.max(0, this.duration - this.swingTime)
        const lead = (speed * remaining + Math.min(.2, speed * .1)) / distance
        this.end = { tangent: desired.tangent + dT * lead, axial: desired.axial + dA * lead, heading: this.heading }
      }
      const p = Math.min(1, this.swingTime / this.duration)
      const ease = p * p * (3 - 2 * p)
      foot.tangent = THREE.MathUtils.lerp(this.start.tangent, this.end.tangent, ease)
      foot.axial = THREE.MathUtils.lerp(this.start.axial, this.end.axial, ease)
      foot.heading = this.start.heading + wrap(this.end.heading - this.start.heading) * ease
      foot.lift = Math.sin(Math.PI * p) * (.055 + Math.min(.055, this.speed * .015))
      if (p === 1) {
        foot.lift = 0; foot.planted = true
        this.active = -1; this.steps++; landed = true
      }
    }
    if (this.active === -1) {
      const desired = [this.stance(0), this.stance(1)]
      const errors = this.feet.map((f, i) => Math.hypot(f.tangent - desired[i].tangent, f.axial - desired[i].axial) +
        Math.abs(wrap(f.heading - this.heading)) * .13)
      const next = errors[0] >= errors[1] ? 0 : 1
      if (errors[next] > (moving ? .14 : .09)) {
        this.active = next; this.swingTime = 0
        // Limit how far the carrier can travel while the opposite foot is
        // planted. Faster movement needs a shorter support interval.
        this.duration = clamp(.55 / Math.max(1, speed), .07, .34)
        Object.assign(this.start, this.feet[next])
        const lead = moving && distance > 1e-5 ? Math.min(.7, speed * this.duration * 1.3) / distance : 0
        this.end = { tangent: desired[next].tangent + dT * lead, axial: desired[next].axial + dA * lead, heading: this.heading }
        this.feet[next].planted = false
      }
    }
    return landed
  }

  private stance(index: number) {
    // Character +X points opposite increasing azimuth when facing +axial.
    const side = index === 0 ? -.112 : .112
    return { tangent: this.tangent - Math.cos(this.heading) * side,
      axial: this.axial + Math.sin(this.heading) * side, heading: this.heading }
  }
}

const down = new THREE.Vector3(0, -1, 0)
const direction = new THREE.Vector3(), bend = new THREE.Vector3(), knee = new THREE.Vector3()
const upper = new THREE.Quaternion(), lower = new THREE.Quaternion()
const seatedAnkle = new THREE.Vector3(), seatedShoe = new THREE.Vector3()
const seatedRootOrientation = new THREE.Quaternion(), seatedParentInverse = new THREE.Quaternion()
const airborneUp = new THREE.Vector3(), airborneForward = new THREE.Vector3(), airborneHand = new THREE.Vector3()
const bodyToView = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI)

/** Floating posture for the existing flat-screen jetpack attitude. The body
 * follows the eye's translation/roll without changing camera or physics. Its
 * hands stay below the sightline; unsupported knees never solve to the floor. */
export function poseAirborneBody(root: THREE.Object3D, eye: THREE.Matrix4) {
  airborneUp.setFromMatrixColumn(eye, 1).normalize()
  airborneForward.setFromMatrixColumn(eye, 2).normalize().negate()
  root.position.setFromMatrixPosition(eye).addScaledVector(airborneUp, -1.55).addScaledVector(airborneForward, -.08)
  root.quaternion.setFromRotationMatrix(eye).multiply(bodyToView)
  root.getObjectByName('pelvis')!.position.y = .93
  for (const [i, side] of ['left', 'right'].entries()) {
    root.getObjectByName(side + '_hip')!.rotation.x = -.28
    root.getObjectByName(side + '_knee')!.rotation.x = .55
    solveBodyArm(root.getObjectByName(side + '_shoulder')!, root.getObjectByName(side + '_elbow')!,
      airborneHand.set(i === 0 ? -.12 : .12, .34, .5), i === 0 ? -1 : 1)
  }
}

/** Two-segment leg, bending the knee toward local +Z. Targets and hip are
 * character-local metres; rotations are written relative to the joint parents. */
export function solveBodyLeg(hip: THREE.Object3D, kneeJoint: THREE.Object3D, ankle: THREE.Vector3) {
  const hipPosition = new THREE.Vector3().copy(hip.position)
  if (hip.parent) hipPosition.add(hip.parent.position)
  direction.copy(ankle).sub(hipPosition)
  const distance = clamp(direction.length(), .12, .839)
  direction.normalize()
  bend.set(0, 0, 1).addScaledVector(direction, -direction.z).normalize()
  const along = (.43 * .43 - .41 * .41 + distance * distance) / (2 * distance)
  knee.copy(hipPosition).addScaledVector(direction, along).addScaledVector(bend, Math.sqrt(Math.max(0, .43 * .43 - along * along)))
  upper.setFromUnitVectors(down, knee.clone().sub(hipPosition).normalize())
  lower.setFromUnitVectors(down, ankle.clone().sub(knee).normalize())
  hip.quaternion.copy(upper)
  kneeJoint.quaternion.copy(upper).invert().multiply(lower)
}

/** Fit the authored seated pose to its real support and visible floor. The
 * hips follow the seat; the legs solve independently so lower benches do not
 * drag the shoes underground or leave the soles hanging above the paving. */
export function fitSeatedBody(root: THREE.Object3D, seatHeight: number, floorHeight: number) {
  const pelvis = root.getObjectByName('pelvis')!
  pelvis.position.y += seatHeight - .6
  root.updateMatrixWorld(true)
  root.getWorldQuaternion(seatedRootOrientation)
  for (const [i, side] of ['left', 'right'].entries()) {
    seatedAnkle.set(i === 0 ? -.112 : .112, floorHeight + .055, .43)
    const hip = root.getObjectByName(side + '_hip')!, knee = root.getObjectByName(side + '_knee')!
    solveBodyLeg(hip, knee, seatedAnkle)
    root.updateMatrixWorld(true)
    const shoe = root.getObjectByName(side + '_shoe')!
    seatedShoe.copy(seatedAnkle); seatedShoe.z += .046
    root.localToWorld(seatedShoe)
    shoe.position.copy(shoe.parent!.worldToLocal(seatedShoe))
    shoe.parent!.getWorldQuaternion(seatedParentInverse).invert()
    shoe.quaternion.copy(seatedParentInverse).multiply(seatedRootOrientation)
  }
}

/** Retarget the authored arm to a tracked grip centre. A small proportional
 * adjustment accommodates user arm lengths; extreme targets keep only the
 * tracked hand rather than pulling the sleeve apart or moving the controller. */
export function solveBodyArm(shoulder: THREE.Object3D, elbow: THREE.Object3D, target: THREE.Vector3, side: -1 | 1) {
  direction.copy(target).sub(shoulder.position)
  const distance = direction.length()
  if (!Number.isFinite(distance) || distance < .06 || distance > .61) return false
  const ratio = Math.max(1, distance / .529)
  const upperLength = .282 * ratio, lowerLength = .249 * ratio
  direction.normalize()
  bend.set(side * .7, -.5, -.3).addScaledVector(direction, -bend.dot(direction))
  if (bend.lengthSq() < 1e-6) bend.set(0, 0, 1).addScaledVector(direction, -direction.z)
  bend.normalize()
  const along = (upperLength ** 2 - lowerLength ** 2 + distance ** 2) / (2 * distance)
  knee.copy(shoulder.position).addScaledVector(direction, along)
    .addScaledVector(bend, Math.sqrt(Math.max(0, upperLength ** 2 - along ** 2)))
  upper.setFromUnitVectors(down, knee.clone().sub(shoulder.position).normalize())
  lower.setFromUnitVectors(down, target.clone().sub(knee).normalize())
  shoulder.quaternion.copy(upper); elbow.quaternion.copy(upper).invert().multiply(lower)
  elbow.position.y = -upperLength
  for (const name of ['sleeve', 'forearm']) {
    const mesh = shoulder.getObjectByName((side < 0 ? 'left_' : 'right_') + name)
    if (mesh) { mesh.position.y *= ratio; mesh.scale.y *= ratio }
  }
  return true
}
