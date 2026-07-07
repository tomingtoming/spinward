import { describe, expect, test } from 'bun:test'

import {
  createCapRideSample,
  getCapRideDuration,
  getCapRideTrack,
  sampleCapRide
} from './capRide'

const IZMA = { radius: 3200, span: 40000 }
const PLAYGROUND = { radius: 18, span: 120 }

describe('cap ride track', () => {
  test('runs from the rim to just clear of the spaceport hub, inside the -Y cap', () => {
    const track = getCapRideTrack(IZMA)
    expect(track.baseRadial).toBe(3199)
    expect(track.hubRadial).toBeCloseTo(112, 5)
    expect(track.axial).toBe(-19990)
  })

  test('stays sane at Playground scale', () => {
    const track = getCapRideTrack(PLAYGROUND)
    expect(track.hubRadial).toBe(2)
    expect(track.baseRadial).toBe(17)
    expect(track.axial).toBe(-50)
  })

  test('duration: cinematic on Izma, short on Playground, clamped both ways', () => {
    expect(getCapRideDuration(getCapRideTrack(IZMA))).toBeCloseTo(3087 / 55 + 4, 3)
    expect(getCapRideDuration(getCapRideTrack(PLAYGROUND))).toBe(6)
  })
})

describe('cap ride sampling', () => {
  const track = getCapRideTrack(IZMA)
  const duration = getCapRideDuration(track)

  test('starts at the rim, at rest', () => {
    const sample = sampleCapRide(track, duration, 0, createCapRideSample())
    expect(Math.hypot(sample.position.x, sample.position.z)).toBeCloseTo(track.baseRadial, 5)
    expect(sample.position.y).toBe(track.axial)
    expect(sample.velocity.length()).toBeCloseTo(0, 5)
    expect(sample.done).toBe(false)
  })

  test('ends at the hub, at rest, and clamps past the end', () => {
    const sample = sampleCapRide(track, duration, duration * 2, createCapRideSample())
    expect(Math.hypot(sample.position.x, sample.position.z)).toBeCloseTo(track.hubRadial, 5)
    expect(sample.velocity.length()).toBeCloseTo(0, 5)
    expect(sample.done).toBe(true)
  })

  test('climbs inward through the middle with a real velocity', () => {
    const sample = sampleCapRide(track, duration, duration / 2, createCapRideSample())
    const radial = Math.hypot(sample.position.x, sample.position.z)
    expect(radial).toBeLessThan(track.baseRadial)
    expect(radial).toBeGreaterThan(track.hubRadial)
    // Peak speed of the smoothstep profile: 1.5 · distance / duration, inward.
    const speed = sample.velocity.length()
    expect(speed).toBeCloseTo((1.5 * (track.baseRadial - track.hubRadial)) / duration, 3)
    // Velocity points inward (against the outward radial direction).
    const outwardDot =
      sample.velocity.x * sample.position.x + sample.velocity.z * sample.position.z
    expect(outwardDot).toBeLessThan(0)
  })

  test('progress is monotonic', () => {
    let previous = -1
    for (let step = 0; step <= 20; step += 1) {
      const sample = sampleCapRide(
        track,
        duration,
        (duration * step) / 20,
        createCapRideSample()
      )
      expect(sample.progress).toBeGreaterThanOrEqual(previous)
      previous = sample.progress
    }
  })
})
