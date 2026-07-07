import * as THREE from 'three'

// The end-cap ride: a funicular that climbs the inside of the -Y end cap from
// the rim to the hub. The cap is the one place a cylinder colony can run
// floor-to-axis infrastructure without spokes — its inner face is a 1g-to-0g
// "cliff" (local down is always radial, so the wall is vertical everywhere).
//
// The ride IS the physics demo in continuous form: felt gravity is ω²r, and r
// slides from R to ~0 under you. Nothing here fakes that — main.ts co-rotates
// the player along this track and the simulated accelerometer measures the
// fade out of the actual velocity history, Coriolis lean and all.

// How far off the cap face the car travels (clearance for the cabin + track).
export const CAP_RIDE_CLEARANCE = 10

export type CapRideTrack = {
  azimuth: number
  // Axial station of the whole ride (just inside the -Y cap).
  axial: number
  // Radial ends: the boarding platform at the rim, the hub by the spaceport.
  baseRadial: number
  hubRadial: number
}

export type CapRideSample = {
  // Colony-fixed position/velocity of the cabin.
  position: THREE.Vector3
  velocity: THREE.Vector3
  // 0..1 along the ride.
  progress: number
  done: boolean
}

export const createCapRideSample = (): CapRideSample => ({
  position: new THREE.Vector3(),
  velocity: new THREE.Vector3(),
  progress: 0,
  done: false
})

// The track rides the first land arc's meridian (azimuth 0 on Izma), ending
// just clear of the spaceport hub tube.
export const getCapRideTrack = (habitat: {
  radius: number
  span: number
}): CapRideTrack => ({
  azimuth: 0,
  axial: -(habitat.span * 0.5 - CAP_RIDE_CLEARANCE),
  baseRadial: Math.max(1, habitat.radius - 1),
  hubRadial: THREE.MathUtils.clamp(habitat.radius * 0.035, 2, 140)
})

// Cinematic pacing: ~55 m/s average on a colony-scale climb, clamped so the
// Playground ride still breathes and a mega-cylinder does not take all night.
export const getCapRideDuration = (track: CapRideTrack) => {
  const distance = Math.abs(track.baseRadial - track.hubRadial)
  return THREE.MathUtils.clamp(distance / 55 + 4, 6, 75)
}

// Smoothstep progress: slow leaving the rim (the city recedes), fast through
// the middle, drifting into the hub. Its derivative gives the true cabin
// velocity so the rider's accelerometer sees a real elevator, not a teleport.
export const sampleCapRide = (
  track: CapRideTrack,
  durationSeconds: number,
  elapsedSeconds: number,
  target: CapRideSample
): CapRideSample => {
  const tau = THREE.MathUtils.clamp(elapsedSeconds / Math.max(1e-6, durationSeconds), 0, 1)
  const progress = tau * tau * (3 - 2 * tau)
  const progressRate = (6 * tau * (1 - tau)) / Math.max(1e-6, durationSeconds)

  const radial = THREE.MathUtils.lerp(track.baseRadial, track.hubRadial, progress)
  const radialRate = (track.hubRadial - track.baseRadial) * progressRate

  const cos = Math.cos(track.azimuth)
  const sin = Math.sin(track.azimuth)
  target.position.set(radial * cos, track.axial, radial * sin)
  target.velocity.set(radialRate * cos, 0, radialRate * sin)
  target.progress = progress
  target.done = tau >= 1

  return target
}
