import { expect, test } from 'bun:test'
import * as THREE from 'three'

import { advanceBallState } from './ballStep'

test('advanceBallState curves a forward throw inside the rotating frame', () => {
  const position = new THREE.Vector3(8, 0, 0)
  const velocity = new THREE.Vector3(0, 0, -6)

  for (let index = 0; index < 10; index += 1) {
    advanceBallState(
      {
        position,
        velocity,
        radius: 0.2
      },
      {
        deltaSeconds: 0.1,
        radius: 10,
        length: 40,
        omega: 1,
        restitution: 0.4
      }
    )
  }

  expect(position.x).toBeGreaterThan(8)
  expect(position.z).toBeLessThan(-3.5)
})

test('advanceBallState keeps the ball center inside the cylinder after collision', () => {
  const position = new THREE.Vector3(9.7, 0, 0)
  const velocity = new THREE.Vector3(5, 0, 0)

  advanceBallState(
    {
      position,
      velocity,
      radius: 0.5
    },
    {
      deltaSeconds: 0.1,
      radius: 10,
      length: 40,
      omega: 0,
      restitution: 0.5
    }
  )

  expect(position.length()).toBeLessThanOrEqual(9.5)
  expect(velocity.x).toBeLessThan(0)
})
