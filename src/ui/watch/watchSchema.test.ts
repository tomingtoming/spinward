import { expect, test } from 'bun:test'

import { parseWatchParameterAction, formatWatchParameterValue } from './watchSchema'

test('parseWatchParameterAction parses valid action strings', () => {
  expect(parseWatchParameterAction('rpm-fine-increment')).toEqual({
    prefix: 'rpm',
    mode: 'fine',
    ticks: 1
  })
  expect(parseWatchParameterAction('radius-coarse-decrement')).toEqual({
    prefix: 'radius',
    mode: 'coarse',
    ticks: -1
  })
  expect(parseWatchParameterAction('throw-scale-fine-increment')).toEqual({
    prefix: 'throw-scale',
    mode: 'fine',
    ticks: 1
  })
  expect(parseWatchParameterAction('jetpack-acceleration-coarse-decrement')).toEqual({
    prefix: 'jetpack-acceleration',
    mode: 'coarse',
    ticks: -1
  })
  expect(parseWatchParameterAction('reattach-threshold-fine-decrement')).toEqual({
    prefix: 'reattach-threshold',
    mode: 'fine',
    ticks: -1
  })
  expect(parseWatchParameterAction('far-field-intensity-coarse-increment')).toEqual({
    prefix: 'far-field-intensity',
    mode: 'coarse',
    ticks: 1
  })
})

test('parseWatchParameterAction returns null for unknown prefixes', () => {
  expect(parseWatchParameterAction('unknown-fine-increment')).toBeNull()
  expect(parseWatchParameterAction('gravity-coarse-decrement')).toBeNull()
})

test('parseWatchParameterAction returns null for malformed strings', () => {
  expect(parseWatchParameterAction('rpm')).toBeNull()
  expect(parseWatchParameterAction('')).toBeNull()
  expect(parseWatchParameterAction('rpm-fine')).toBeNull()
  expect(parseWatchParameterAction('rpm-invalid-increment')).toBeNull()
  expect(parseWatchParameterAction('profile-beginner')).toBeNull()
  expect(parseWatchParameterAction('preset-apply-playground')).toBeNull()
})

test('formatWatchParameterValue formats each parameter correctly', () => {
  const source = {
    rpm: 5.23,
    radius: 18,
    throwScale: 1.5,
    jetpackAcceleration: 12.3,
    reattachThreshold: 0.2,
    farFieldIntensity: 1.05
  }

  expect(formatWatchParameterValue('rpm', source)).toBe('5.23')
  expect(formatWatchParameterValue('radius', source)).toBe('18 m')
  expect(formatWatchParameterValue('throwScale', source)).toBe('1.50')
  expect(formatWatchParameterValue('jetpackAcceleration', source)).toBe('12.3 m/s\u00B2')
  expect(formatWatchParameterValue('reattachThreshold', source)).toBe('0.20')
  expect(formatWatchParameterValue('farFieldIntensity', source)).toBe('1.05')
})
