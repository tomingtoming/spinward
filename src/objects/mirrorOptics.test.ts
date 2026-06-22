import { describe, expect, test } from 'bun:test'

import { SUN_DIRECTION } from './sun'
import {
  MAX_FOLD,
  computeMirrorFrame,
  mirrorThroughput,
  openFactorToPhi,
  reflectSun,
  swingPetal
} from './mirrorOptics'

const azimuths = [0, Math.PI / 3, (2 * Math.PI) / 3, Math.PI, -1.1]

describe('computeMirrorFrame', () => {
  test('builds an orthonormal right-handed frame at each window', () => {
    for (const azimuth of azimuths) {
      const { tangent, outward, along0, normal0 } = computeMirrorFrame(azimuth)
      expect(tangent.length()).toBeCloseTo(1, 6)
      expect(outward.length()).toBeCloseTo(1, 6)
      expect(along0.length()).toBeCloseTo(1, 6)
      expect(normal0.length()).toBeCloseTo(1, 6)
      // The open petal leans 45° off the spin axis, so its normal catches the
      // sun at cos(45°).
      expect(normal0.dot(SUN_DIRECTION)).toBeCloseTo(Math.SQRT1_2, 6)
    }
  })
})

describe('reflectSun in the open pose', () => {
  test('turns the axial sun into a purely radial inward beam (no Y lift)', () => {
    for (const azimuth of azimuths) {
      const { outward, normal0 } = computeMirrorFrame(azimuth)
      const beam = reflectSun(normal0)
      // Physically: a 45° mirror sends the -Y sun straight inward, opposite the
      // window's outward radial, with zero axial component.
      expect(beam.y).toBeCloseTo(0, 6)
      expect(beam.x).toBeCloseTo(-outward.x, 6)
      expect(beam.z).toBeCloseTo(-outward.z, 6)
    }
  })
})

describe('day/night from mirror swing', () => {
  test('throughput is full when open and zero when folded edge-on', () => {
    const frame = computeMirrorFrame(Math.PI / 3)

    const open = swingPetal(frame, 0)
    expect(mirrorThroughput(open.normal)).toBeCloseTo(1, 6)

    const folded = swingPetal(frame, MAX_FOLD)
    expect(mirrorThroughput(folded.normal)).toBeCloseTo(0, 6)
  })

  test('throughput decreases monotonically as the petal folds', () => {
    const frame = computeMirrorFrame(0)
    let previous = Infinity
    for (let step = 0; step <= 8; step += 1) {
      const phi = (step / 8) * MAX_FOLD
      const value = mirrorThroughput(swingPetal(frame, phi).normal)
      expect(value).toBeLessThanOrEqual(previous + 1e-9)
      previous = value
    }
  })

  test('openFactorToPhi maps noon to open and midnight to the sun-facing fold', () => {
    expect(openFactorToPhi(1)).toBeCloseTo(0, 6)
    expect(openFactorToPhi(0)).toBeCloseTo(-MAX_FOLD, 6)
  })

  test('at midnight the petal turns to face the sun (normal parallel to the sun)', () => {
    for (const azimuth of azimuths) {
      const frame = computeMirrorFrame(azimuth)
      const night = swingPetal(frame, openFactorToPhi(0))
      expect(night.normal.dot(SUN_DIRECTION)).toBeCloseTo(1, 6)
    }
  })
})
