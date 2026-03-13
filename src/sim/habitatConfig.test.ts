import { expect, test } from 'bun:test'

import { rpmToOmega, surfaceGravityFromConfig } from './habitatConfig'

test('rpmToOmega converts revolutions per minute to radians per second', () => {
  expect(rpmToOmega(60)).toBeCloseTo(Math.PI * 2, 6)
})

test('surfaceGravityFromConfig computes g = omega^2 * R', () => {
  expect(
    surfaceGravityFromConfig({
      radius: 10,
      rpm: 60
    })
  ).toBeCloseTo(Math.pow(Math.PI * 2, 2) * 10, 6)
})
