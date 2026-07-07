import * as THREE from 'three'

// What the resident hears, decided from where they are and how they move.
// Pure mapping so the mix curve is testable; GameAudio only applies gains.
//
//  · City bed: the murmur of the inhabited floor. Fades with altitude — by
//    the cloud deck it is gone and the colony is just structure hum.
//  · Wind: airspeed through the CO-ROTATING air, so standing still in a
//    spinning world is calm and a free-fall dive howls. Walking sits in the
//    dead zone.
//  · Vacuum: outside the hull no medium carries the world's sound at all.
//    What remains is yourself — breath and heartbeat (GameAudio's self voice).

export type AmbienceInput = {
  // Radial distance / habitat radius: 1 on the floor, 0 on the axis.
  radialFraction: number
  // Inside the pressurized hull (playerRegion === 'inside').
  inside: boolean
  // Speed relative to the rotating frame = through the co-rotating air (m/s).
  airspeed: number
  // 0..1 day factor: streets murmur by day, hush at night.
  daylight: number
}

export type AmbienceMix = {
  city: number
  wind: number
  // Target for the vacuum crossfade: world bus ducks to (1 - vacuum), the
  // breath/heartbeat self voice rises to it.
  vacuum: number
}

// The city bed is audible on the streets and gone by the cloud deck.
const CITY_FULL_FRACTION = 0.92
const CITY_SILENT_FRACTION = 0.55
// Walking (~6 m/s) stays calm; a jetpack dive or a fast drive builds to a howl.
const WIND_SILENT_SPEED = 7
const WIND_FULL_SPEED = 45
// Night streets still murmur a little.
const CITY_NIGHT_FLOOR = 0.55

export const computeAmbienceMix = ({
  radialFraction,
  inside,
  airspeed,
  daylight
}: AmbienceInput): AmbienceMix => {
  if (!inside) {
    return { city: 0, wind: 0, vacuum: 1 }
  }

  const altitude = THREE.MathUtils.smoothstep(
    radialFraction,
    CITY_SILENT_FRACTION,
    CITY_FULL_FRACTION
  )
  const busy =
    CITY_NIGHT_FLOOR + (1 - CITY_NIGHT_FLOOR) * THREE.MathUtils.clamp(daylight, 0, 1)

  return {
    city: altitude * busy,
    wind: THREE.MathUtils.smoothstep(airspeed, WIND_SILENT_SPEED, WIND_FULL_SPEED),
    vacuum: 0
  }
}
