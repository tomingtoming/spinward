import * as THREE from 'three'

// What the resident hears, decided from where they are and how they move.
// Pure mapping so the mix curve is testable; GameAudio only applies gains.
//
//  · No city bed. The filtered-noise murmur of the floor read as wind while
//    standing (toming, 2026-09-29) and, once gated by the resident's own
//    speed, as a jetpack while walking on PC (toming, 2026-10-13). A noise
//    that follows your own motion is heard as propulsion, so the floor is
//    silent apart from the structure hum.
//  · Wind: airspeed through the CO-ROTATING air, so standing still in a
//    spinning world is calm and a free-fall dive howls. Walking sits in the
//    dead zone.
//  · Vacuum: where there is no air there is no world sound at all — outside
//    the hull, and also INSIDE an open ring's bore (Elysium holds only a thin
//    air shell against its floor). What remains is yourself — breath and
//    heartbeat (GameAudio's self voice).

export type AmbienceInput = {
  // Radial distance / habitat radius: 1 on the floor, 0 on the axis.
  radialFraction: number
  // Inside the AIR: within the hull and within the pressurized shell. A
  // cylinder is air to the axis; a ring's bore is vacuum (main.ts derives
  // this from getAtmosphereDepth).
  inAir: boolean
  // Speed relative to the rotating frame = through the co-rotating air (m/s).
  airspeed: number
  // 0..1 day factor. Kept in the input for callers; no voice reads it now
  // that the day/night street murmur is gone.
  daylight: number
  // Enclosed public room; outdoors remains audible quietly through its portals.
  shelter?: number
}

export type AmbienceMix = {
  wind: number
  // Target for the vacuum crossfade: world bus ducks to (1 - vacuum), the
  // breath/heartbeat self voice rises to it.
  vacuum: number
}

// Walking (~6 m/s) and small hops stay calm; a committed jetpack dive or a
// flat-out drive builds toward the (quiet, low) full rumble.
const WIND_SILENT_SPEED = 10
const WIND_FULL_SPEED = 50

export const computeAmbienceMix = ({
  inAir,
  airspeed,
  shelter = 0
}: AmbienceInput): AmbienceMix => {
  if (!inAir) {
    return { wind: 0, vacuum: 1 }
  }

  return {
    wind: THREE.MathUtils.smoothstep(airspeed, WIND_SILENT_SPEED, WIND_FULL_SPEED) * (1 - 0.85 * THREE.MathUtils.clamp(shelter, 0, 1)),
    vacuum: 0
  }
}
