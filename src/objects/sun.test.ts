import { describe, expect, test } from 'bun:test'
import * as THREE from 'three'

import { getSpaceportDimensions } from './spaceport'
import { computeStarShellRadius, Starfield } from './starfield'
import { SUN_DIRECTION, getSunDistance, getSunPosition, Sun } from './sun'

// Mirror of habitatRuntime's camera-far floor, so the far-plane guard exercises
// the real expression rather than a tautological multiple of the star shell.
const MIN_CAMERA_FAR = 4000
const cameraFarFor = (radius: number, length: number) =>
  Math.max(MIN_CAMERA_FAR, computeStarShellRadius(radius, length) * 1.25)

describe('sun placement', () => {
  test('distant sky retains angular directions and stays behind the colony from far observers', () => {
    const radius = 3200, length = 40000
    const stars = new Starfield({ radius, length }), sun = new Sun({ radius, length })
    const parent = new THREE.Group()
    parent.add(stars.group, sun.group)
    // Exercise both display-root rotation and the counter-rotating star frame.
    parent.rotation.y = .7; stars.setFrameAngle(.7)
    const star = new THREE.Vector3().fromBufferAttribute((stars.group.children[0] as THREE.Points).geometry.getAttribute('position'), 12)
    let firstDirection: THREE.Vector3 | null = null
    for (const position of [new THREE.Vector3(), new THREE.Vector3(200000, -100000, 64000), new THREE.Vector3(-1e6, 4e5, 1e6)]) {
      stars.setObserverPosition(position); sun.setObserverPosition(position)
      parent.updateMatrixWorld(true)
      const worldEye = parent.localToWorld(position.clone())
      const direction = stars.group.localToWorld(star.clone()).sub(worldEye).normalize()
      if (firstDirection) expect(direction.distanceTo(firstDirection)).toBeLessThan(1e-12)
      firstDirection = direction
      const sunDelta = sun.group.getWorldPosition(new THREE.Vector3()).sub(worldEye)
      expect(sunDelta.clone().normalize().distanceTo(SUN_DIRECTION)).toBeLessThan(1e-12)
      expect(sunDelta.length() / sun.group.scale.x).toBeCloseTo(getSunDistance(radius, length), 5)
      // A sphere of radius 50 km covers the hull, port and the 45-degree wings.
      expect(sunDelta.length()).toBeGreaterThan(position.length() + 50000)
      expect(stars.getSuggestedCameraFar()).toBeGreaterThan(star.length() * stars.group.scale.x)
    }
    sun.dispose()
  })

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
