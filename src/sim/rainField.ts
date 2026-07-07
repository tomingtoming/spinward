import * as THREE from 'three'

// Analytic rain for a rotating habitat. Individual drops never touch the
// physics engine: with air drag a falling drop reaches terminal velocity
// almost immediately, so the visible motion is a steady velocity field that
// can be written in closed form and evaluated once per frame at the camera.
//
// Two ingredients, both in the colony-fixed (rotating) frame:
//  · Fall: terminal velocity scales with the local spin gravity g = ω²r, so
//    rain falls slower at altitude (smaller r) and near-floats by the axis.
//  · Drift: while falling at v the drop feels the Coriolis push 2ωv against
//    the spin; drag balances it at a steady antispinward drift. With a linear
//    drag response time τ = v_t/g the equilibrium drift is 2ω·v_t²/g. This is
//    the slant a resident sees — and it grows as the fall slows aloft.
//
// Clouds condense where the spin gravity is weakest, hugging the axis, so
// rain exists only below the cloud deck (r > cloudRadius) and fades in across
// a band under it.

// Sea-level terminal velocity of a heavy raindrop under 1 g.
export const RAIN_TERMINAL_SPEED_1G = 8
const EARTH_G = 9.81

// The cloud deck radius, as a fraction of the habitat radius. Above this
// (closer to the axis) there is no rain — you are inside/above the clouds.
export const CLOUD_DECK_RADIUS_FRACTION = 0.35
// Rain fades in across this band below the deck, so flying up through the
// cloud base dissolves the rain instead of clipping it off.
const CLOUD_FADE_BAND_FRACTION = 0.12

// The steady drift can exceed the fall speed on small fast habitats
// (Playground); past this ratio the linear-drag model has left its validity
// anyway, so cap the slant instead of letting drops fly sideways.
const MAX_DRIFT_TO_FALL_RATIO = 0.6

export type RainSample = {
  // 0..1: how much rain exists here (0 above the cloud deck / at zero spin).
  strength: number
  fallSpeed: number
  driftSpeed: number
  // Colony-fixed rain velocity at the query point (m/s).
  velocity: THREE.Vector3
}

export const createRainSample = (): RainSample => ({
  strength: 0,
  fallSpeed: 0,
  driftSpeed: 0,
  velocity: new THREE.Vector3()
})

// Local terminal fall speed: v_t ∝ √g (drag ∝ v² regime), referenced to 1 g.
export const getRainFallSpeed = (omega: number, radialDistance: number) => {
  const g = omega * omega * radialDistance
  return RAIN_TERMINAL_SPEED_1G * Math.sqrt(Math.max(0, g) / EARTH_G)
}

// Steady antispinward drift from the Coriolis/drag balance: 2ω·v_t²/g = 2·v_t²/(ω·r).
export const getRainDriftSpeed = (omega: number, radialDistance: number) => {
  if (omega <= 0 || radialDistance <= 0) {
    return 0
  }

  const fall = getRainFallSpeed(omega, radialDistance)
  return Math.min(
    (2 * fall * fall) / (omega * radialDistance),
    fall * MAX_DRIFT_TO_FALL_RATIO
  )
}

// Evaluate the rain velocity field at a colony-fixed position (spin axis = Y).
export const sampleRainField = (
  position: THREE.Vector3,
  omega: number,
  habitatRadius: number,
  target: RainSample
): RainSample => {
  const radial = Math.hypot(position.x, position.z)
  const cloudRadius = habitatRadius * CLOUD_DECK_RADIUS_FRACTION
  const fadeBand = Math.max(1e-6, habitatRadius * CLOUD_FADE_BAND_FRACTION)

  target.strength =
    omega <= 0 || habitatRadius <= 0 || radial <= 0
      ? 0
      : THREE.MathUtils.smoothstep(radial, cloudRadius, cloudRadius + fadeBand)

  if (target.strength <= 0) {
    target.fallSpeed = 0
    target.driftSpeed = 0
    target.velocity.set(0, 0, 0)
    return target
  }

  target.fallSpeed = getRainFallSpeed(omega, radial)
  target.driftSpeed = getRainDriftSpeed(omega, radial)

  // Down = radially outward; spinward tangent at p is (z, 0, -x)/r for
  // ω = (0, +ω, 0), so the Coriolis lag drifts along (-z, 0, x)/r.
  const invRadial = 1 / radial
  const downX = position.x * invRadial
  const downZ = position.z * invRadial
  target.velocity.set(
    downX * target.fallSpeed - downZ * target.driftSpeed,
    0,
    downZ * target.fallSpeed + downX * target.driftSpeed
  )

  return target
}
