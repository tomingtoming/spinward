import { describe, expect, test } from 'bun:test'

import { getSpaceportDimensions } from './spaceport'
import { computeStarShellRadius } from './starfield'
import {
  SUN_DIRECTION,
  WINDOW_SUN_LIFT,
  WINDOW_SUN_RADIAL,
  getSunDistance,
  getSunPosition,
  getWindowSunPosition
} from './sun'

// Mirror of habitatRuntime's camera-far floor, so the far-plane guard exercises
// the real expression rather than a tautological multiple of the star shell.
const MIN_CAMERA_FAR = 4000
const cameraFarFor = (radius: number, length: number) =>
  Math.max(MIN_CAMERA_FAR, computeStarShellRadius(radius, length) * 1.25)

describe('sun placement', () => {
  test('the sun points up the +Y axis (the spaceport-free end)', () => {
    expect(SUN_DIRECTION.x).toBe(0)
    expect(SUN_DIRECTION.y).toBe(1)
    expect(SUN_DIRECTION.z).toBe(0)
  })

  test('the sun sits on the +Y axis, just inside the star shell', () => {
    const radius = 3200
    const length = 40000
    const shell = computeStarShellRadius(radius, length)
    const position = getSunPosition(radius, length)

    expect(position.x).toBe(0)
    expect(position.z).toBe(0)
    expect(position.y).toBeGreaterThan(0)
    expect(position.y).toBeCloseTo(getSunDistance(radius, length), 6)
    // Inside the shell, so it reads as the most distant lit object.
    expect(position.y).toBeLessThan(shell)
  })

  test('the sun stays inside the camera far plane across the preset range', () => {
    // Big habitat: far tracks the shell at 1.25x (floor inactive).
    expect(getSunDistance(3200, 40000)).toBeLessThan(cameraFarFor(3200, 40000))
    // Tiny Playground: shell floors at 250, far at the 4000 floor — the branch
    // the big-habitat case never exercises.
    expect(cameraFarFor(18, 120)).toBe(MIN_CAMERA_FAR)
    expect(getSunDistance(18, 120)).toBeLessThan(cameraFarFor(18, 120))
  })

  test('the sun sits on the end opposite the spaceport hub', () => {
    // The whole point of +Y: the spaceport hub is always on the -Y end, so the
    // sun belongs on its negation. Flipping either constant must break a test.
    for (const [radius, length] of [
      [18, 120],
      [3200, 40000],
      [30000, 2000]
    ]) {
      const sunY = getSunPosition(radius, length).y
      const hubY = getSpaceportDimensions(radius, length).hubCenterY
      expect(Math.sign(sunY)).toBe(-Math.sign(hubY))
    }
  })
})

describe('window sunlight direction', () => {
  test('light rakes in from the +Y (sun) end with the radial span preserved', () => {
    // Each strip light is lifted toward +Y (so the toward-center direction
    // descends — sunlight from the spaceport-free end) while keeping its full
    // radial reach (which sets which strip is lit / how the floor reads).
    for (const azimuth of [0, Math.PI / 2, Math.PI, (3 * Math.PI) / 2]) {
      const position = getWindowSunPosition(azimuth)
      expect(position.y).toBe(WINDOW_SUN_LIFT)
      expect(WINDOW_SUN_LIFT).toBeGreaterThan(0)
      // Radial magnitude is load-bearing: a collapse here would flatten the
      // strip lighting even though the bearing angle would still pass.
      expect(Math.hypot(position.x, position.z)).toBeCloseTo(WINDOW_SUN_RADIAL, 6)
    }
  })

  test('the radial bearing tracks the window azimuth', () => {
    // Assert the radial components directly rather than via atan2, which wraps
    // at 3*PI/2 — this pins both the bearing and the magnitude at every azimuth.
    for (const azimuth of [0, Math.PI / 2, Math.PI, (3 * Math.PI) / 2]) {
      const position = getWindowSunPosition(azimuth)
      expect(position.x).toBeCloseTo(Math.cos(azimuth) * WINDOW_SUN_RADIAL, 6)
      expect(position.z).toBeCloseTo(Math.sin(azimuth) * WINDOW_SUN_RADIAL, 6)
    }
  })
})
