import { expect, test } from 'bun:test'
import * as THREE from 'three'

import { getForwardDirection } from './forwardDirection'

const expectVectorCloseTo = (actual: THREE.Vector3, expected: THREE.Vector3) => {
  expect(actual.x).toBeCloseTo(expected.x, 6)
  expect(actual.y).toBeCloseTo(expected.y, 6)
  expect(actual.z).toBeCloseTo(expected.z, 6)
}

test('getForwardDirection uses local -Z as forward for generic objects', () => {
  const object = new THREE.Object3D()

  expectVectorCloseTo(getForwardDirection(object), new THREE.Vector3(0, 0, -1))
})

test('getForwardDirection respects world rotation', () => {
  const object = new THREE.Object3D()
  object.rotateY(Math.PI / 2)

  expectVectorCloseTo(getForwardDirection(object), new THREE.Vector3(-1, 0, 0))
})
