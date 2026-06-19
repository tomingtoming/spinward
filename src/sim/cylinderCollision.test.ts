import { expect, test } from 'bun:test'
import * as THREE from 'three'

import { confineSphereToRotatingCylinder } from './cylinderCollision'

test('confineSphereToRotatingCylinder resolves collision in the habitat wall frame', () => {
  const position = new THREE.Vector3(9.8, 0, 0)
  const velocity = new THREE.Vector3(2, 0, -6)

  const collided = confineSphereToRotatingCylinder(position, velocity, {
    radius: 10,
    length: 20,
    sphereRadius: 0.5,
    restitution: 0.5,
    omega: 1
  })

  expect(collided).toBe(true)
  expect(position.x).toBeCloseTo(9.5, 6)
  expect(velocity.x).toBeCloseTo(-1, 6)
  expect(velocity.z).toBeCloseTo(-6, 6)
})

test('confineSphereToRotatingCylinder leaves the opening clear when end caps are disabled', () => {
  const position = new THREE.Vector3(0, 9.8, 0)
  const velocity = new THREE.Vector3(0, 3, 0)

  const collided = confineSphereToRotatingCylinder(position, velocity, {
    radius: 10,
    length: 20,
    sphereRadius: 0.5,
    restitution: 0.5,
    omega: 1,
    capEnds: false
  })

  expect(collided).toBe(false)
  expect(position.y).toBeCloseTo(9.8, 6)
  expect(velocity.y).toBeCloseTo(3, 6)
})
