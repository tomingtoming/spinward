import { expect, test } from 'bun:test'

import { resolveQualityTier } from './quality'

test('detection routes quest before touch, then touch, then desktop', () => {
  expect(resolveQualityTier(null, { touch: true, quest: true })).toBe('quest')
  expect(resolveQualityTier(null, { touch: true, quest: false })).toBe('phone')
  expect(resolveQualityTier(null, { touch: false, quest: false })).toBe(
    'desktop'
  )
})

test('?tier= overrides detection for the perf hunt', () => {
  expect(resolveQualityTier('desktop', { touch: true, quest: false })).toBe(
    'desktop'
  )
  expect(resolveQualityTier('quest', { touch: true, quest: false })).toBe(
    'quest'
  )
  expect(resolveQualityTier('phone', { touch: false, quest: false })).toBe(
    'phone'
  )
})

test('unrecognized tier values fall back to detection', () => {
  expect(resolveQualityTier('ultra', { touch: true, quest: false })).toBe(
    'phone'
  )
  expect(resolveQualityTier('', { touch: false, quest: false })).toBe('desktop')
})
