import { Vector3 } from 'three'
import { computeRotatingFrameAcceleration } from '../../sim/rotatingFrame'
import { integrateSemiImplicitEuler } from '../../sim/integrator'
import { JUMP_SPEED, computeJumpLaunchVelocity } from '../../gameplay/jump'

export type WalkPose = { x: number; y: number; h: number; yaw: number; pitch: number; rejected: number }
export type SourceWorld = {
  readyAt(x: number, y: number): boolean
  ground(x: number, y: number): number
  blocked(x: number, y: number): boolean
  move(pose: WalkPose, dx: number, dy: number): WalkPose
}
export type BandFrame = { band: number; anchor: { local: number[] } }

/** Source metres remain authoritative for support and footprints. Airborne
 * motion uses the main game's rotating-frame forces, in its +Y-axis frame.
 * Unknown streamed ground freezes the entire step, including vertical motion. */
export class ThreeBandWalker {
  state: WalkPose
  grounded = true
  waiting = false
  readonly velocity = new Vector3()
  readonly position = new Vector3()
  private readonly acceleration = new Vector3()
  private readonly angularVelocity: Vector3
  private readonly next = new Vector3()
  constructor(readonly world: SourceWorld, readonly sample: BandFrame,
    state: WalkPose, readonly radius: number, readonly omega: number) {
    this.state = state
    this.angularVelocity = new Vector3(0, omega, 0)
    this.syncPosition()
  }
  get angle() { return (this.state.x + this.sample.anchor.local[0]) / this.radius + this.sample.band * Math.PI * 2 / 3 }
  get gravity() { return this.omega ** 2 * (this.radius - this.state.h) }
  private syncPosition() {
    const r = this.radius - this.state.h, a = this.angle
    this.position.set(r * Math.cos(a), this.state.y + this.sample.anchor.local[1], r * Math.sin(a))
  }
  step(dt: number, vx: number, vy: number, jump = false): WalkPose {
    if (!Number.isFinite(dt) || dt <= 0) return this.state
    dt = Math.min(dt, .05)
    this.waiting = !this.world.readyAt(this.state.x, this.state.y)
    if (this.waiting) return this.state
    if (jump && this.grounded) {
      const a = this.angle, speed = vx * (1 - this.state.h / this.radius)
      computeJumpLaunchVelocity(a, JUMP_SPEED, this.velocity)
      this.velocity.add(new Vector3(-Math.sin(a) * speed, vy, Math.cos(a) * speed))
      this.grounded = false; this.syncPosition()
    }
    const count = Math.ceil(dt * 120), step = dt / count
    for (let i = 0; i < count; i++) {
      const previous = this.state
      if (this.grounded) {
        if (!this.world.readyAt(previous.x + vx * step, previous.y + vy * step)) { this.waiting = true; break }
        this.state = this.world.move(previous, vx * step, vy * step)
        this.syncPosition()
        continue
      }
      const oldVelocity = this.velocity.clone()
      this.next.copy(this.position)
      computeRotatingFrameAcceleration(this.angularVelocity, this.position, this.velocity, this.acceleration)
      integrateSemiImplicitEuler(this.next, this.velocity, this.acceleration, step)
      const a = Math.atan2(this.next.z, this.next.x), da = Math.atan2(Math.sin(a - this.angle), Math.cos(a - this.angle))
      let x = previous.x + da * this.radius, y = this.next.y - this.sample.anchor.local[1]
      if (!this.world.readyAt(x, y)) { this.velocity.copy(oldVelocity); this.waiting = true; break }
      const ground = this.world.ground(x, y)
      if (!Number.isFinite(ground)) { this.velocity.copy(oldVelocity); this.waiting = true; break }
      // At walking/jump speeds each step travels under 4 cm. Walls and water
      // retain their conservative source-footprint collision while airborne.
      let rejected = 0
      if (this.world.blocked(x, y)) {
        x = previous.x; y = previous.y; rejected = 1
        const radial = new Vector3(Math.cos(this.angle), 0, Math.sin(this.angle))
        this.velocity.copy(radial.multiplyScalar(this.velocity.dot(radial)))
      }
      let h = this.radius - Math.hypot(this.next.x, this.next.z)
      const floor = this.world.ground(x, y)
      if (h <= floor && this.next.x * this.velocity.x + this.next.z * this.velocity.z >= 0) {
        h = floor; this.grounded = true; this.velocity.set(0, 0, 0)
      }
      this.state = { ...previous, x, y, h, rejected }
      this.syncPosition()
    }
    return this.state
  }
}
