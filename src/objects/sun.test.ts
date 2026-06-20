import { describe, expect, test } from 'bun:test'

import { getSpaceportDimensions } from './spaceport'
import { computeStarShellRadius } from './starfield'
import { SUN_DIRECTION, getSunDistance, getSunPosition } from './sun'

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
