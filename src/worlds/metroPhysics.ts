type Vector = { x: number; y: number; z: number }

/** Bound travel against the rotating city's thin triangles to half the player
 * sphere radius. Inertial speed includes ~177 m/s of harmless co-rotation;
 * only relative motion needs extra solver steps. Keep the total frame time.
 * CCD is unsuitable here because it omits the kinematic surface's rotation. */
export function metroPhysicsSubsteps(position: Vector, velocity: Vector, omega: number, dt: number) {
  const speed = Math.hypot(velocity.x - omega * position.z, velocity.y, velocity.z + omega * position.x)
  const acceleration = omega * omega * Math.hypot(position.x, position.z) + 2 * Math.abs(omega) * speed
  return Math.max(1, Math.min(64, Math.ceil((speed + acceleration * dt) * dt / .16)))
}
