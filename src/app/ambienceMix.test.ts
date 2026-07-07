import { describe, expect, test } from 'bun:test'

import { computeAmbienceMix } from './ambienceMix'

describe('ambience mix', () => {
  test('street level by day: full city bed, no wind, no vacuum', () => {
    const mix = computeAmbienceMix({
      radialFraction: 1,
      inside: true,
      airspeed: 0,
      daylight: 1
    })
    expect(mix.city).toBe(1)
    expect(mix.wind).toBe(0)
    expect(mix.vacuum).toBe(0)
  })

  test('night streets still murmur, quieter than day', () => {
    const day = computeAmbienceMix({
      radialFraction: 1,
      inside: true,
      airspeed: 0,
      daylight: 1
    })
    const night = computeAmbienceMix({
      radialFraction: 1,
      inside: true,
      airspeed: 0,
      daylight: 0
    })
    expect(night.city).toBeGreaterThan(0)
    expect(night.city).toBeLessThan(day.city)
  })

  test('the city fades out by the cloud deck and is silent at the axis', () => {
    const overlook = computeAmbienceMix({
      radialFraction: 0.98,
      inside: true,
      airspeed: 0,
      daylight: 1
    })
    const highAltitude = computeAmbienceMix({
      radialFraction: 0.5,
      inside: true,
      airspeed: 0,
      daylight: 1
    })
    const axis = computeAmbienceMix({
      radialFraction: 0,
      inside: true,
      airspeed: 0,
      daylight: 1
    })
    expect(overlook.city).toBe(1)
    expect(highAltitude.city).toBe(0)
    expect(axis.city).toBe(0)
  })

  test('walking sits in the wind dead zone; a dive builds toward a howl', () => {
    const walking = computeAmbienceMix({
      radialFraction: 1,
      inside: true,
      airspeed: 6,
      daylight: 1
    })
    const diving = computeAmbienceMix({
      radialFraction: 0.8,
      inside: true,
      airspeed: 30,
      daylight: 1
    })
    const terminal = computeAmbienceMix({
      radialFraction: 0.9,
      inside: true,
      airspeed: 60,
      daylight: 1
    })
    expect(walking.wind).toBe(0)
    expect(diving.wind).toBeGreaterThan(0.2)
    expect(diving.wind).toBeLessThan(1)
    expect(terminal.wind).toBe(1)
  })

  test('outside the hull: vacuum — no city, no wind', () => {
    const mix = computeAmbienceMix({
      radialFraction: 1.4,
      inside: false,
      airspeed: 80,
      daylight: 1
    })
    expect(mix.city).toBe(0)
    expect(mix.wind).toBe(0)
    expect(mix.vacuum).toBe(1)
  })
})
