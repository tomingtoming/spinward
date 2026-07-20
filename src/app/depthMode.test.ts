import { expect, test } from 'bun:test'

import { resolveDepthMode } from './depthMode'

test('defaults to log depth', () => {
  expect(resolveDepthMode(null, null)).toBe('log')
})

test('persisted choice is used when no URL param is set', () => {
  expect(resolveDepthMode(null, 'plain')).toBe('plain')
  expect(resolveDepthMode(null, 'log')).toBe('log')
})

test('URL param wins over the persisted choice', () => {
  expect(resolveDepthMode('plain', 'log')).toBe('plain')
  expect(resolveDepthMode('log', 'plain')).toBe('log')
})

test('unrecognized values fall through', () => {
  expect(resolveDepthMode('reversed', null)).toBe('log')
  expect(resolveDepthMode('', 'linear')).toBe('log')
  expect(resolveDepthMode('garbage', 'plain')).toBe('plain')
})
