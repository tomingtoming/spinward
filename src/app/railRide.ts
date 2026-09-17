import * as THREE from 'three'
import { resetPlayerToGrounded, type PlayerTraversalState } from './playerTraversal'
import { rotatingVelocityToInertial } from '../sim/frameTransforms'
import { setRigidBodyLinvelFromReal } from '../physics/rapierBoundary'
import { railTrainMatrix } from '../objects/colonyRail'
import type { RailService, RailTrain } from '../gameplay/railService'

type Frame = { radius: number; omega: number; frameAngle: number }
/** A standing passenger is carried by the train's authored floor. Ownership
 * is explicit so a world change cannot pull a newly spawned body back aboard. */
export class RailRide {
  private active: { train: RailTrain; state: PlayerTraversalState; floor: number; u: number } | null = null
  private previous = new THREE.Vector3()
  private position = new THREE.Vector3()
  private velocity = new THREE.Vector3()
  private matrix = new THREE.Matrix4()
  private clock = 0
  get train() { return this.active?.train ?? null }
  get riding() { return this.active !== null }
  private sensor(state: PlayerTraversalState, value: boolean) {
    const body = state.physics?.freeFlyBody
    if (body) for (let i = 0; i < body.numColliders(); i++) body.collider(i).setSensor(value)
  }
  enter(service: RailService, train: RailTrain, state: PlayerTraversalState, frame: Frame) {
    if (this.active || state.mode !== 'grounded' || service.nearestBoarding(state.surface.azimuth, state.surface.axialPosition, state.groundHeight, frame.radius) !== train) return false
    this.active = { train, state, floor: service.data.configuration.carFloor, u: -Math.sign(train.lane) * .45 }
    this.clock = service.time; this.velocity.set(0, 0, 0); this.sensor(state, true)
    this.pin(state, frame, service.time); this.previous.copy(this.position)
    return true
  }
  pin(state: PlayerTraversalState, frame: Frame, clock: number) {
    const active = this.active
    if (!active) return
    if (state !== active.state) { this.active = null; return }
    this.position.set(-active.u, active.floor, 0).applyMatrix4(railTrainMatrix(active.train, this.matrix))
    if (clock > this.clock) this.velocity.copy(this.position).sub(this.previous).divideScalar(clock - this.clock)
    this.previous.copy(this.position); this.clock = clock
    resetPlayerToGrounded(state, { ...frame, azimuth: Math.atan2(this.position.z, this.position.x),
      axialPosition: this.position.y, groundHeight: frame.radius - Math.hypot(this.position.x, this.position.z) })
    rotatingVelocityToInertial(this.position, this.velocity, frame.omega, frame.frameAngle, state.inertialVelocity)
    if (state.physics) setRigidBodyLinvelFromReal(state.physics.freeFlyBody, state.inertialVelocity, state.physics.units, true)
  }
  leave(state: PlayerTraversalState, frame: Frame) {
    const train = this.train
    if (!train?.station || train.doorOpen < .95 || train.departureIn < 2) return false
    const point = train.station.boarding[train.lane < 0 ? 0 : 1]
    this.cancel(state)
    resetPlayerToGrounded(state, { ...frame, azimuth: point[0] / frame.radius, axialPosition: point[1], groundHeight: point[2] })
    return true
  }
  cancel(state: PlayerTraversalState) {
    if (this.active?.state === state) this.sensor(state, false)
    this.active = null; this.velocity.set(0, 0, 0)
  }
  prompt() {
    const train = this.train
    if (!train) return null
    return train.station && train.doorOpen > .95 ? `Leave tram · ${train.station.name}` : `Next stop · ${train.next.name}`
  }
}
