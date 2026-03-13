import { expect, test } from 'bun:test'

import { consumeSnapTurn, createSnapTurnState } from './snapTurn'

test('consumeSnapTurn fires once when the stick crosses the threshold', () => {
  const state = createSnapTurnState()

  expect(consumeSnapTurn(0.8, state)).toBe(1)
  expect(consumeSnapTurn(0.9, state)).toBe(0)
  expect(consumeSnapTurn(0.1, state)).toBe(0)
  expect(consumeSnapTurn(-0.85, state)).toBe(-1)
})

test('consumeSnapTurn stays idle inside the deadzone', () => {
  const state = createSnapTurnState()

  expect(consumeSnapTurn(0.3, state)).toBe(0)
  expect(consumeSnapTurn(-0.3, state)).toBe(0)
})
