import * as THREE from 'three'

// The "Earth intuition" ghost for a thrown ball (2026-09-03, プラン第4段).
//
// In the rotating frame a thrown ball curves (Coriolis) and the floor rises
// to meet it faster or slower than a flat-Earth parabola would. The physics
// is right, but a first-time visitor has nothing to compare it against: the
// curve just looks like a slightly odd throw. This ghost is the comparison —
// the path the same release would take on Earth: constant gravity of the
// felt g at the release point, pointing straight "down" (away from the axis
// at the release azimuth, which is what a flat floor means), no Coriolis,
// no curvature of the floor. The gap between the ghost and the real trail IS
// the spin, drawn.
//
// Pure kinematics in the rotating frame (the frame the player sees), so the
// line is static once drawn. Everything here is testable without a scene.

export type EarthGhostOptions = {
  // Integration step (s). 1/30 keeps the dashed line smooth at throw speeds.
  dt?: number
  maxSeconds?: number
  maxPoints?: number
}

const outward = new THREE.Vector3()

// Felt gravity at the release point: g = ω²·r, toward the floor.
export const feltGravityAt = (rotatingPosition: THREE.Vector3, omega: number) =>
  omega * omega * Math.hypot(rotatingPosition.x, rotatingPosition.z)

// Points along the flat-Earth parabola from the release pose, ending where
// the ghost would land on a flat floor at the release radius (or at the
// time/point caps). Returns at least the release point.
export const computeEarthGhostPath = (
  rotatingPosition: THREE.Vector3,
  rotatingVelocity: THREE.Vector3,
  omega: number,
  floorRadius: number,
  options: EarthGhostOptions = {}
): THREE.Vector3[] => {
  const dt = options.dt ?? 1 / 30
  const maxSeconds = options.maxSeconds ?? 12
  const maxPoints = options.maxPoints ?? 400
  const r0 = Math.hypot(rotatingPosition.x, rotatingPosition.z)
  const points: THREE.Vector3[] = [rotatingPosition.clone()]
  if (r0 < 1e-6 || !(floorRadius > 0)) {
    return points
  }
  // Flat-Earth "down" is fixed at the release azimuth for the whole flight.
  outward.set(rotatingPosition.x, 0, rotatingPosition.z).divideScalar(r0)
  const g = omega * omega * r0
  // Height above the floor along the fixed down direction: the ghost lands
  // when it has fallen the release altitude, measured along that line.
  const altitude = floorRadius - r0
  const position = rotatingPosition.clone()
  const velocity = rotatingVelocity.clone()
  const fallen = { value: 0 }
  let elapsed = 0
  while (elapsed < maxSeconds && points.length < maxPoints) {
    // Semi-implicit Euler with constant g along `outward`.
    velocity.addScaledVector(outward, g * dt)
    position.addScaledVector(velocity, dt)
    elapsed += dt
    fallen.value = position.clone().sub(rotatingPosition).dot(outward)
    if (fallen.value >= altitude) {
      // Clip the last segment to the floor line so the ghost ends ON the
      // floor, not a step below it.
      const previous = points[points.length - 1]
      const previousFallen = previous.clone().sub(rotatingPosition).dot(outward)
      const t = THREE.MathUtils.clamp(
        (altitude - previousFallen) / Math.max(1e-9, fallen.value - previousFallen),
        0,
        1
      )
      points.push(previous.clone().lerp(position, t))
      break
    }
    points.push(position.clone())
  }
  return points
}
