import { describe, expect, test } from 'bun:test'
import * as THREE from 'three'

import { collideSphereWithBuildings } from './cityCollision'
import type { CityBuilding } from '../objects/cityLayout'

const HABITAT_RADIUS = 18

// A building standing on the inner wall at azimuth 0: occupies radial band
// [radius - height, radius], tangent +-width/2, axial +-depth/2 around axial 5.
const building: CityBuilding = {
  azimuth: 0,
  axial: 5,
  width: 4,
  depth: 6,
  height: 8,
  tone: 0.5
}

const config = {
  habitatRadius: HABITAT_RADIUS,
  sphereRadius: 0.18,
  restitution: 0.5
}

describe('collideSphereWithBuildings', () => {
  test('misses when the sphere is far from every building', () => {
    const position = new THREE.Vector3(0, -40, 0)
    const velocity = new THREE.Vector3(1, 0, 0)
    expect(collideSphereWithBuildings(position, velocity, [building], config)).toBe(false)
    expect(position.y).toBe(-40)
    expect(velocity.x).toBe(1)
  })

  test('a ball falling onto the roof bounces back inward', () => {
    // Roof is at radial distance radius - height = 10. Ball just touching it,
    // moving outward (falling toward the wall).
    const position = new THREE.Vector3(10 - 0.1, 5, 0)
    const velocity = new THREE.Vector3(3, 0, 0)

    expect(collideSphereWithBuildings(position, velocity, [building], config)).toBe(true)
    // Pushed back inside the sphere clearance above the roof.
    expect(position.x).toBeCloseTo(10 - config.sphereRadius, 6)
    // Outward speed 3 reflects to inward 1.5 with restitution 0.5.
    expect(velocity.x).toBeCloseTo(-1.5, 6)
  })

  test('a ball hitting the axial face reflects its axial velocity', () => {
    const position = new THREE.Vector3(14, 5 + 3 + 0.1, 0)
    const velocity = new THREE.Vector3(0, -2, 0)

    expect(collideSphereWithBuildings(position, velocity, [building], config)).toBe(true)
    expect(position.y).toBeCloseTo(5 + 3 + config.sphereRadius, 6)
    expect(velocity.y).toBeCloseTo(1, 6)
  })

  test('a ball brushing the tangent face is deflected sideways', () => {
    // At azimuth 0 the tangent direction is +z.
    const position = new THREE.Vector3(14, 5, 2 + 0.1)
    const velocity = new THREE.Vector3(0, 0, -2)

    expect(collideSphereWithBuildings(position, velocity, [building], config)).toBe(true)
    expect(position.z).toBeCloseTo(2 + config.sphereRadius, 6)
    expect(velocity.z).toBeCloseTo(1, 6)
  })

  test('separating contacts do not add energy', () => {
    // Touching the roof but already moving away (inward): position is
    // corrected but velocity must not be reflected again.
    const position = new THREE.Vector3(10 - 0.1, 5, 0)
    const velocity = new THREE.Vector3(-2, 0, 0)

    expect(collideSphereWithBuildings(position, velocity, [building], config)).toBe(true)
    expect(velocity.x).toBeCloseTo(-2, 6)
  })

  test('a sphere whose center is inside the box exits through the nearest face', () => {
    const position = new THREE.Vector3(10.5, 5, 0)
    const velocity = new THREE.Vector3(0, 0, 0)

    expect(collideSphereWithBuildings(position, velocity, [building], config)).toBe(true)
    // Nearest face from radial coordinate 10.5 (roof at 10) is the roof.
    expect(position.x).toBeCloseTo(10 - config.sphereRadius, 6)
  })

  test('works at wrapped azimuths', () => {
    const azimuth = Math.PI * 1.75
    const wrapped: CityBuilding = { ...building, azimuth }
    const roofRadial = HABITAT_RADIUS - wrapped.height
    const position = new THREE.Vector3(
      Math.cos(azimuth) * (roofRadial - 0.05),
      wrapped.axial,
      Math.sin(azimuth) * (roofRadial - 0.05)
    )
    const outwardVelocity = new THREE.Vector3(
      Math.cos(azimuth),
      0,
      Math.sin(azimuth)
    ).multiplyScalar(2)

    expect(
      collideSphereWithBuildings(position, outwardVelocity, [wrapped], config)
    ).toBe(true)
    expect(Math.hypot(position.x, position.z)).toBeCloseTo(
      roofRadial - config.sphereRadius,
      5
    )
  })

  test('returns false for an empty city', () => {
    const position = new THREE.Vector3(10, 5, 0)
    const velocity = new THREE.Vector3(1, 0, 0)
    expect(collideSphereWithBuildings(position, velocity, [], config)).toBe(false)
  })
})
