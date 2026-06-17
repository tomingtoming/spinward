import * as THREE from 'three'

const properAccel = new THREE.Vector3()
const outward = new THREE.Vector3()

// A simulated accelerometer reading the felt pseudo-gravity. This habitat has
// no gravity FIELD — spin stands in for it — so the only thing accelerating a
// body is the real push it receives from the floor (and bumps, throttle,
// crashes). An ideal accelerometer reads proper acceleration, which here equals
// the body's inertial-frame acceleration; we recover that by differencing the
// MEASURED inertial velocity between frames (the velocity Rapier integrates),
// never by evaluating omega^2 R.
//
// We then keep the RADIAL component — the inward normal force per unit mass,
// what a bathroom scale reads — so a throttle push (tangential) never inflates
// the gravity, and the reading is exactly the pseudo-gravity. It is emergent,
// not theoretical: ~omega^2 R standing on the wall, draining to 0 as the car
// reaches the wall's speed and cancels the spin, 0 in free-fall, with real
// radial bumps and landings spiking through.
export class Accelerometer {
  private readonly prevVelocity = new THREE.Vector3()
  private hasPrev = false
  private smoothed = 0

  // Low-pass time constant (seconds): long enough to swallow per-frame
  // numerical jitter, short enough that a bump or a crash still registers.
  constructor(private smoothingTime = 0.2) {}

  // Retune the low-pass on the fly. Driving wants a longer constant: near float
  // the spin gravity is almost gone, so per-frame seam micro-bumps off the wall
  // would otherwise jitter the readout; walking wants the short one so landings
  // still register.
  setSmoothingTime(seconds: number) {
    this.smoothingTime = Math.max(1e-3, seconds)
  }

  // Forget the previous sample without dropping the smoothed reading. Call when
  // the measured body switches (walk <-> drive) so the velocity discontinuity
  // is not differenced into a phantom spike.
  resync() {
    this.hasPrev = false
  }

  // Feed the body's current inertial velocity (m/s) and inertial position (m)
  // once per frame. Returns the smoothed felt gravity in m/s^2.
  sample(
    inertialVelocity: THREE.Vector3,
    inertialPosition: THREE.Vector3,
    deltaSeconds: number
  ): number {
    if (deltaSeconds <= 0) {
      return this.smoothed
    }

    if (!this.hasPrev) {
      this.prevVelocity.copy(inertialVelocity)
      this.hasPrev = true
      return this.smoothed
    }

    properAccel.copy(inertialVelocity).sub(this.prevVelocity).divideScalar(deltaSeconds)
    this.prevVelocity.copy(inertialVelocity)

    // Radial "down" points away from the spin axis (Y). Felt weight is the
    // inward normal force = the inward (-outward) part of the proper
    // acceleration; clamp negatives — those mean the body is leaving the floor.
    outward.set(inertialPosition.x, 0, inertialPosition.z)
    const radius = outward.length()
    let instantaneous = 0
    if (radius > 1e-6) {
      outward.divideScalar(radius)
      instantaneous = Math.max(0, -properAccel.dot(outward))
    }

    const alpha = 1 - Math.exp(-deltaSeconds / this.smoothingTime)
    this.smoothed += (instantaneous - this.smoothed) * alpha
    return this.smoothed
  }
}
