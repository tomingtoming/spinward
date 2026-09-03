import { describe, expect, test } from 'bun:test'

import { COMPACT_DOCK_MAX_WIDTH, isCompactDock } from './viewportLayout'

describe('isCompactDock', () => {
  test('phones and narrow windows are compact', () => {
    expect(isCompactDock(390)).toBe(true)
    expect(isCompactDock(430)).toBe(true)
    expect(isCompactDock(COMPACT_DOCK_MAX_WIDTH)).toBe(true)
  })

  test('landscape phones, tablets and desktops keep the full bar', () => {
    expect(isCompactDock(COMPACT_DOCK_MAX_WIDTH + 1)).toBe(false)
    expect(isCompactDock(844)).toBe(false)
    expect(isCompactDock(1600)).toBe(false)
  })

  test('a zero/unknown width is not compact (avoids collapsing before layout)', () => {
    expect(isCompactDock(0)).toBe(false)
    expect(isCompactDock(-1)).toBe(false)
  })
})
