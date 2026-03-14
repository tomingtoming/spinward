import { expect, test } from 'bun:test'

import { getHabitatSpan } from './habitatConfig'

test('getHabitatSpan returns length for cylinders', () => {
  expect(
    getHabitatSpan({
      type: 'cylinder',
      length: 120,
      thickness: 0
    })
  ).toBe(120)
})

test('getHabitatSpan prefers thickness for ring-style approximations', () => {
  expect(
    getHabitatSpan({
      type: 'ring',
      length: 120,
      thickness: 2000
    })
  ).toBe(2000)
})
