import * as THREE from 'three'
import { loadResidentModel, poseResident, placeResident, ResidentBatches } from './residentModel'
import type { RoomSeat } from '../app/roomSeating'
import { PlayerBodyMotion, solveBodyLeg, solveBodyArm } from './playerBodyMotion'
import { PlayerFootSurface } from './playerFootSurface'
import type { TrackedBodyPose } from '../xr/trackedBodyPose'

export type PlayerBodyFrame = {
  radius: number; azimuth: number; axial: number; groundHeight: number
  heading: number; grounded: boolean; enabled: boolean; visible?: boolean; deltaSeconds: number
  seat: RoomSeat | null; holding: boolean; indoors: boolean
  tracked?: TrackedBodyPose | null
}

const point = new THREE.Vector3(), ankle = new THREE.Vector3(), footPosition = new THREE.Vector3()
const parentRotation = new THREE.Quaternion(), footRotation = new THREE.Quaternion()
const forward = new THREE.Vector3(), up = new THREE.Vector3(), right = new THREE.Vector3(), basis = new THREE.Matrix4()
const handToGrip = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 2)

/** Body and planted feet live in the colony frame, independently of head
 * pitch. The head is omitted in first person; seating keeps its proven pose. */
export class PlayerBodyView {
  readonly group = new THREE.Group()
  readonly hand = new THREE.Group()
  readonly motion = new PlayerBodyMotion()
  readonly surfaces = new PlayerFootSurface()
  private root: THREE.Object3D | null = null
  private batches: ResidentBatches | null = null
  private requested = false
  private disposed = false
  private time = 0
  private tracking = false
  private readonly binds: Array<{ object: THREE.Object3D; position: THREE.Vector3; quaternion: THREE.Quaternion; scale: THREE.Vector3 }> = []
  constructor(parent: THREE.Group) {
    this.group.name = 'player-body'; parent.add(this.group); this.hand.name = 'coffee-grip'
  }
  dispose() { this.disposed = true; this.batches?.dispose(); this.group.removeFromParent(); this.hand.removeFromParent() }

  update(frame: PlayerBodyFrame) {
    this.time += Math.min(.1, Math.max(0, frame.deltaSeconds))
    if (frame.enabled && frame.visible !== false && (frame.grounded || frame.seat || frame.holding) && !this.requested) {
      this.requested = true
      loadResidentModel().then(asset => {
        if (this.disposed) return
        this.root = asset.getObjectByName('resident')!.clone(true)
        this.root.traverse(object => this.binds.push({ object, position: object.position.clone(), quaternion: object.quaternion.clone(), scale: object.scale.clone() }))
        this.root.traverse(o => { if (o instanceof THREE.Mesh && /face|hair|nose|neck|collar/.test(o.name)) o.visible = false })
        this.root.getObjectByName('head')?.traverse(o => { if (o instanceof THREE.Mesh) o.visible = false })
        this.batches = new ResidentBatches(this.root, 1, false)
        this.group.add(this.batches.group)
        const source = asset.getObjectByName('cup_hand'); if (source) this.hand.add(source.clone(true))
      }).catch(() => console.warn('Body detail unavailable.'))
    }
    this.group.visible = !!this.root && frame.enabled && frame.visible !== false && (frame.grounded || !!frame.seat)
    this.hand.visible = frame.enabled && frame.visible !== false && !frame.tracked && frame.holding
    if (!!frame.tracked !== this.tracking) { this.motion.reset(); this.tracking = !!frame.tracked }
    if (!frame.enabled) { this.motion.reset(); return false }
    const stepped = this.motion.update({ ...frame, grounded: frame.grounded && !frame.seat })
    if (!this.root || !this.group.visible) return stepped
    const root = this.root
    for (const bind of this.binds) {
      bind.object.position.copy(bind.position); bind.object.quaternion.copy(bind.quaternion); bind.object.scale.copy(bind.scale)
    }
    if (frame.seat) {
      const seat = frame.seat
      const heading = Math.atan2(Math.atan2(Math.sin(seat.exit.azimuth - seat.azimuth), Math.cos(seat.exit.azimuth - seat.azimuth)) * seat.radius,
        seat.exit.axialPosition - seat.axialPosition)
      placeResident(root, seat.azimuth - Math.sin(heading) * .18 / seat.radius,
        seat.axialPosition - Math.cos(heading) * .18, seat.radius, heading, 0)
      poseResident(root, 0, false, true)
    } else {
      const height = this.surfaces.sample(frame.azimuth, frame.axial, frame.groundHeight, frame.indoors)
      // Eyes sit forward of the chest. Keeping the torso directly under the
      // camera makes its shoulders cover the legs when looking down.
      const back = .18
      placeResident(root, frame.azimuth - Math.sin(this.motion.heading) * back / frame.radius,
        frame.axial - Math.cos(this.motion.heading) * back, frame.radius, this.motion.heading, height)
      poseResident(root, this.time, false, false)
      const pelvis = root.getObjectByName('pelvis')!
      // Only the inferred pelvis follows crouching. Never add head bob or
      // standing-height corrections to the actual XR camera.
      pelvis.position.y = frame.tracked ? THREE.MathUtils.clamp(frame.tracked.eyeHeight - height - .72, .22, .93) : .93
      // Lower the hips enough to reach both planted feet without stretching
      // the leg segments. The camera does not inherit this animation.
      root.updateMatrixWorld(true)
      for (let i = 0; i < 2; i++) {
        const foot = this.motion.feet[i], az = foot.tangent / frame.radius
        const floor = this.surfaces.sample(az, foot.axial, frame.groundHeight, frame.indoors)
        point.set(Math.cos(az) * (frame.radius - floor - foot.lift), foot.axial, Math.sin(az) * (frame.radius - floor - foot.lift))
        root.worldToLocal(ankle.copy(point)); ankle.y += .055
        const horizontal = Math.hypot(ankle.x - (i === 0 ? -.112 : .112), ankle.z)
        pelvis.position.y = Math.min(pelvis.position.y, Math.sqrt(Math.max(.16, .835 ** 2 - horizontal ** 2)) + ankle.y + .045)
      }
      root.updateMatrixWorld(true)
      for (const [i, side] of ['left', 'right'].entries()) {
        const foot = this.motion.feet[i], az = foot.tangent / frame.radius
        const floor = this.surfaces.sample(az, foot.axial, frame.groundHeight, frame.indoors)
        footPosition.set(Math.cos(az) * (frame.radius - floor - foot.lift), foot.axial, Math.sin(az) * (frame.radius - floor - foot.lift))
        root.worldToLocal(ankle.copy(footPosition)); ankle.y += .055
        const hip = root.getObjectByName(side + '_hip')!, knee = root.getObjectByName(side + '_knee')!
        solveBodyLeg(hip, knee, ankle)
        root.updateMatrixWorld(true)
        // Orient the shoe independently of the calf, so a bent knee cannot
        // point the sole through the pavement.
        const shoe = root.getObjectByName(side + '_shoe')!
        up.set(-Math.cos(az), 0, -Math.sin(az))
        forward.set(-Math.sin(az) * Math.sin(foot.heading), Math.cos(foot.heading), Math.cos(az) * Math.sin(foot.heading))
        right.crossVectors(up, forward)
        footRotation.setFromRotationMatrix(basis.makeBasis(right, up, forward))
        footPosition.addScaledVector(up, .055).addScaledVector(forward, .046)
        shoe.position.copy(shoe.parent!.worldToLocal(point.copy(footPosition)))
        shoe.parent!.getWorldQuaternion(parentRotation)
        shoe.quaternion.copy(parentRotation.invert()).multiply(footRotation)
      }
      const swing = Math.sin(this.motion.steps * Math.PI + this.time * Math.min(12, this.motion.speed * 3)) * Math.min(.22, this.motion.speed * .08)
      root.getObjectByName('left_shoulder')!.rotation.x = -swing
      root.getObjectByName('right_shoulder')!.rotation.x = swing
    }
    const armReach = [true, true]
    if (frame.tracked) for (const [i, side] of ['left', 'right'].entries()) {
      // The authored +Z-forward hierarchy names its negative-X side "left".
      // A -Z-forward XR viewer sees that side on the right: swap the named
      // sides at this boundary so physical hands never cross the torso.
      const grip = frame.tracked.hands[1 - i]
      if (!grip) continue
      root.updateMatrixWorld(true)
      const torso = root.getObjectByName('torso')!, shoulder = root.getObjectByName(side + '_shoulder')!, elbow = root.getObjectByName(side + '_elbow')!
      torso.worldToLocal(point.fromArray(grip.position))
      armReach[i] = solveBodyArm(shoulder, elbow, point, i === 0 ? -1 : 1)
      root.updateMatrixWorld(true)
      const hand = root.getObjectByName(side + '_hand')!
      hand.position.copy(hand.parent!.worldToLocal(point.fromArray(grip.position)))
      hand.parent!.getWorldQuaternion(parentRotation)
      hand.quaternion.copy(parentRotation.invert()).multiply(footRotation.fromArray(grip.orientation)).multiply(handToGrip)
    }
    // Missing tracking never leaves an inferred arm frozen in the last pose.
    // Flat-screen coffee keeps its existing grip without a duplicate arm.
    root.traverse(o => {
      if (!(o instanceof THREE.Mesh)) return
      const part = /^(left|right)_(sleeve|forearm|hand|elbow_cuff)$/.exec(o.name)
      if (!part) return
      const i = part[1] === 'left' ? 0 : 1
      o.visible = frame.tracked ? !!frame.tracked.hands[1 - i] && (part[2] === 'hand' || armReach[i]) : !(i === 0 && frame.holding)
    })
    this.batches?.update([root])
    this.group.userData = { ready: true, mode: frame.seat ? 'seated' : 'standing', steps: this.motion.steps,
      heading: this.motion.heading, speed: this.motion.speed, pelvis: root.getObjectByName('pelvis')!.position.y,
      tracked: !!frame.tracked, hands: frame.tracked?.hands.map(Boolean) ?? [], armReach,
      feet: this.motion.feet.map(f => ({ ...f })) }
    return stepped
  }
}
