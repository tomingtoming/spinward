/** Positions and velocities relative to the rotating habitat, in metres/seconds.
 * A grounded body supplies a speed bound because this frame's input may start it. */
export type RegionalBody = {
  position: { x: number; y: number; z: number }
  velocity: { x: number; y: number; z: number }
  acceleration: number
  radius: number
  speedBound?: number
}
export type RegionalMotion = { bodies: RegionalBody[]; omega: number; deltaSeconds: number }
export type RegionalPreparation = { motion: RegionalMotion; arrival?: { azimuth: number; axial: number; distance: number } }
