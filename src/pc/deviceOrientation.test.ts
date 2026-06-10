import { describe, expect, test } from 'bun:test'
import * as THREE from 'three'

import { computeDeviceOrientationQuaternion } from './deviceOrientation'

const lookDirection = (quaternion: THREE.Quaternion) =>
  new THREE.Vector3(0, 0, -1).applyQuaternion(quaternion)

describe('computeDeviceOrientationQuaternion', () => {
  test('phone held upright facing the user looks at the horizon', () => {
    const quaternion = computeDeviceOrientationQuaternion(0, Math.PI / 2, 0, 0)
    const forward = lookDirection(quaternion)
    expect(forward.x).toBeCloseTo(0, 6)
    expect(forward.y).toBeCloseTo(0, 6)
    expect(forward.z).toBeCloseTo(-1, 6)
  })

  test('phone lying flat with the screen up looks straight down', () => {
    const quaternion = computeDeviceOrientationQuaternion(0, 0, 0, 0)
    const forward = lookDirection(quaternion)
    expect(forward.y).toBeCloseTo(-1, 6)
  })

  test('alpha yaws the view around the world up axis', () => {
    const quaternion = computeDeviceOrientationQuaternion(
      Math.PI / 2,
      Math.PI / 2,
      0,
      0
    )
    const forward = lookDirection(quaternion)
    // alpha=90deg turns the device left: forward swings from -z toward -x.
    expect(forward.x).toBeCloseTo(-1, 6)
    expect(forward.y).toBeCloseTo(0, 6)
    expect(forward.z).toBeCloseTo(0, 6)
  })

  test('landscape screen orientation compensates the device roll', () => {
    // Device rolled 90deg (gamma) with the screen rotated 90deg should look
    // at the horizon, like upright portrait does.
    const quaternion = computeDeviceOrientationQuaternion(
      0,
      0,
      Math.PI / 2,
      Math.PI / 2
    )
    const forward = lookDirection(quaternion)
    expect(forward.y).toBeCloseTo(0, 5)
    expect(forward.length()).toBeCloseTo(1, 6)
  })

  test('reuses the provided target quaternion', () => {
    const target = new THREE.Quaternion()
    const result = computeDeviceOrientationQuaternion(0.3, 1.1, -0.2, 0, target)
    expect(result).toBe(target)
    expect(target.length()).toBeCloseTo(1, 6)
  })
})
