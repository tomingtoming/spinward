import { expect, test } from 'bun:test'
import * as THREE from 'three'

import { confineSphereToCylinder } from './cylinderCollision'

test('does nothing while the ball remains inside the habitat', () => {
  const position = new THREE.Vector3(5, 0, 0)
  const velocity = new THREE.Vector3(1, 0, 0)

  const collided = confineSphereToCylinder(position, velocity, {
    radius: 10,
    length: 20,
    sphereRadius: 0.5,
    restitution: 0.5
  })

  expect(collided).toBe(false)
  expect(position).toEqual(new THREE.Vector3(5, 0, 0))
  expect(velocity).toEqual(new THREE.Vector3(1, 0, 0))
})

test('pushes a ball back inside the cylinder wall and reflects outward velocity', () => {
  const position = new THREE.Vector3(9.8, 0, 0)
  const velocity = new THREE.Vector3(2, 0, 0)

  const collided = confineSphereToCylinder(position, velocity, {
    radius: 10,
    length: 20,
    sphereRadius: 0.5,
    restitution: 0.5
  })

  expect(collided).toBe(true)
  expect(position.x).toBeCloseTo(9.5, 6)
  expect(velocity.x).toBeCloseTo(-1, 6)
})

test('clamps at the end caps and reflects axial velocity', () => {
  const position = new THREE.Vector3(0, 9.8, 0)
  const velocity = new THREE.Vector3(0, 3, 0)

  const collided = confineSphereToCylinder(position, velocity, {
    radius: 10,
    length: 20,
    sphereRadius: 0.5,
    restitution: 0.5
  })

  expect(collided).toBe(true)
  expect(position.y).toBeCloseTo(9.5, 6)
  expect(velocity.y).toBeCloseTo(-1.5, 6)
})
