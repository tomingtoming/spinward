import { expect, test } from 'bun:test'

import { resolveRuntimeWatchAction } from './watchActionRouting'

test('resolveRuntimeWatchAction maps preset watch actions to preset ids', () => {
  expect(resolveRuntimeWatchAction('preset-apply-playground')).toEqual({
    kind: 'preset',
    presetId: 'playground'
  })
  expect(resolveRuntimeWatchAction('preset-apply-izma')).toEqual({
    kind: 'preset',
    presetId: 'izma'
  })
  expect(resolveRuntimeWatchAction('preset-apply-cooper')).toEqual({
    kind: 'preset',
    presetId: 'cooper'
  })
  expect(resolveRuntimeWatchAction('preset-apply-elysium')).toEqual({
    kind: 'preset',
    presetId: 'elysium'
  })
})

test('resolveRuntimeWatchAction maps respawn watch actions to runtime respawn modes', () => {
  expect(resolveRuntimeWatchAction('respawn-inner-wall')).toEqual({
    kind: 'respawn',
    mode: 'inner-wall'
  })
  expect(resolveRuntimeWatchAction('respawn-old-town')).toEqual({
    kind: 'respawn',
    mode: 'old-town'
  })
  expect(resolveRuntimeWatchAction('respawn-overlook')).toEqual({
    kind: 'respawn',
    mode: 'overlook'
  })
  expect(resolveRuntimeWatchAction('respawn-axis-end')).toEqual({
    kind: 'respawn',
    mode: 'axis-end'
  })
})

test('resolveRuntimeWatchAction ignores shared-store actions', () => {
  expect(resolveRuntimeWatchAction('rpm-fine-increment')).toBeNull()
  expect(resolveRuntimeWatchAction('profile-sim')).toBeNull()
})
