import { expect, test } from 'bun:test'

import { formatStatsLine, isStatsOverlayRequested } from './statsOverlay'

test('stats overlay only mounts when ?stats is present', () => {
  expect(isStatsOverlayRequested('?stats')).toBe(true)
  expect(isStatsOverlayRequested('?depth=plain&stats')).toBe(true)
  expect(isStatsOverlayRequested('')).toBe(false)
  expect(isStatsOverlayRequested('?depth=plain')).toBe(false)
  // Substring of another key must not count.
  expect(isStatsOverlayRequested('?statistics=1')).toBe(false)
})

test('stats line rounds fps and abbreviates large triangle counts', () => {
  expect(
    formatStatsLine({ fps: 71.8, drawCalls: 210, triangles: 1_800_000 }, 'log')
  ).toBe('72 fps · LOG · 210 draws · 1.8M tris')
})

test('stats line keeps small triangle counts in thousands', () => {
  expect(
    formatStatsLine({ fps: 0, drawCalls: 0, triangles: 950 }, 'plain')
  ).toBe('0 fps · PLAIN · 0 draws · 1k tris')
})
