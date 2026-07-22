import { expect, test } from 'bun:test'

import {
  MAX_VISIBILITY_METERS,
  MIN_VISIBILITY_METERS,
  resolveFogVisibility,
  visibilityToFogDensity
} from './airVisibility'

test('visibility converts to extinction via Koschmieder', () => {
  // The pre-slice-① constant was 1.0e-4; its visibility equivalent is ~39km.
  expect(visibilityToFogDensity(39_120)).toBeCloseTo(1.0e-4, 6)
  // Half the visibility, twice the extinction.
  expect(visibilityToFogDensity(19_560)).toBeCloseTo(2.0e-4, 6)
})

test('?fog= override wins and is clamped to the sane band', () => {
  expect(resolveFogVisibility('16000', 39_120)).toBe(16_000)
  expect(resolveFogVisibility('500', 39_120)).toBe(MIN_VISIBILITY_METERS)
  expect(resolveFogVisibility('9999999', 39_120)).toBe(MAX_VISIBILITY_METERS)
})

test('missing or unparsable ?fog= falls back to the tier default', () => {
  expect(resolveFogVisibility(null, 39_120)).toBe(39_120)
  expect(resolveFogVisibility('', 39_120)).toBe(39_120)
  expect(resolveFogVisibility('thick', 39_120)).toBe(39_120)
})
