import { describe, expect, test } from 'bun:test'

import { computeAmbienceMix } from './ambienceMix'

describe('ambience mix', () => {
  test('walking the street by day: no wind, no vacuum', () => {
    const mix = computeAmbienceMix({
      radialFraction: 1,
      inAir: true,
      airspeed: 6,
      daylight: 1
    })
    expect(mix.wind).toBe(0)
    expect(mix.vacuum).toBe(0)
  })

  test('the floor carries no sound that follows your own motion: standing, starting and walking are the same mix', () => {
    // A speed-gated street murmur was heard as a jetpack while walking on PC
    // (toming, 2026-10-13), so nothing below the wind dead zone may change
    // with airspeed, by day or by night.
    const expected = { wind: 0, vacuum: 0 }
    for (const daylight of [1, 0]) {
      for (const airspeed of [0, 0.16, 0.5, 1.5, 6]) {
        expect(computeAmbienceMix({ radialFraction: 1, inAir: true, airspeed, daylight })).toEqual(expected)
      }
    }
  })

  test('walking sits in the wind dead zone; a dive builds toward a howl', () => {
    const walking = computeAmbienceMix({
      radialFraction: 1,
      inAir: true,
      airspeed: 6,
      daylight: 1
    })
    const diving = computeAmbienceMix({
      radialFraction: 0.8,
      inAir: true,
      airspeed: 30,
      daylight: 1
    })
    const terminal = computeAmbienceMix({
      radialFraction: 0.9,
      inAir: true,
      airspeed: 60,
      daylight: 1
    })
    expect(walking.wind).toBe(0)
    expect(diving.wind).toBeGreaterThan(0.2)
    expect(diving.wind).toBeLessThan(1)
    expect(terminal.wind).toBe(1)
  })

  test('outside the hull: vacuum — no wind', () => {
    const mix = computeAmbienceMix({
      radialFraction: 1.4,
      inAir: false,
      airspeed: 80,
      daylight: 1
    })
    expect(mix.wind).toBe(0)
    expect(mix.vacuum).toBe(1)
  })

  test("an open ring's bore is vacuum too — no wind however fast you fly", () => {
    // Inside the hull radially (fraction 0.5) but above Elysium's thin air
    // shell: inAir is false, so the mix is indistinguishable from space.
    const mix = computeAmbienceMix({
      radialFraction: 0.5,
      inAir: false,
      airspeed: 120,
      daylight: 1
    })
    expect(mix).toEqual({ wind: 0, vacuum: 1 })
  })
})
