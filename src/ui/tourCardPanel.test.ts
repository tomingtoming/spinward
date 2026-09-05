import { describe, expect, test } from 'bun:test'

import {
  NARROW_CARD_MAX_VIEWPORT_WIDTH,
  cardCanvasHeight,
  resolveCardLayoutId,
  wrapCardLines
} from './tourCardPanel'

// Stand-in for CanvasRenderingContext2D.measureText: 10 units per character,
// so the expected wrap points are arithmetic rather than font-dependent.
const measure = (text: string) => text.length * 10

describe('resolveCardLayoutId', () => {
  test('phones take the narrow layout', () => {
    expect(resolveCardLayoutId(390)).toBe('narrow')
    expect(resolveCardLayoutId(NARROW_CARD_MAX_VIEWPORT_WIDTH)).toBe('narrow')
  })

  test('desktop and landscape keep the wide layout', () => {
    expect(resolveCardLayoutId(NARROW_CARD_MAX_VIEWPORT_WIDTH + 1)).toBe('wide')
    expect(resolveCardLayoutId(1600)).toBe('wide')
  })

  test('an unknown width falls back to wide (never shrinks before layout)', () => {
    expect(resolveCardLayoutId(0)).toBe('wide')
  })
})

describe('wrapCardLines', () => {
  test('keeps a line that fits', () => {
    expect(wrapCardLines(['abc def'], measure, 100)).toEqual(['abc def'])
  })

  test('breaks on spaces at the measured width', () => {
    expect(wrapCardLines(['aaa bbb ccc ddd'], measure, 80)).toEqual(['aaa bbb', 'ccc ddd'])
  })

  test('wraps each source line independently', () => {
    expect(wrapCardLines(['aaa bbb', 'ccc'], measure, 40)).toEqual(['aaa', 'bbb', 'ccc'])
  })

  test('a word longer than the line overflows rather than being split', () => {
    expect(wrapCardLines(['supercalifragilistic'], measure, 50)).toEqual(['supercalifragilistic'])
  })

  test('drops empty lines and collapses runs of spaces', () => {
    expect(wrapCardLines(['', 'a  b'], measure, 100)).toEqual(['a b'])
  })

  test('the real start card fits the narrow card in a readable number of lines', () => {
    const body = [
      'You live inside a spinning cylinder. Look up — the city wraps overhead.',
      'The floor pushes you in a circle - that push is your "gravity".',
      'Left stick walks · drag to look · tap throws · buttons jump / travel',
      'Tour: throw → jump → ② Overlook → ③ Axis'
    ]
    // Narrow layout: 720px canvas less 34px padding each side, 34px body font
    // measures near 17 units per character.
    const lines = wrapCardLines(body, (text) => text.length * 17, 720 - 34 * 2)
    expect(lines.length).toBeGreaterThan(body.length)
    expect(lines.length).toBeLessThanOrEqual(9)
  })
})

describe('cardCanvasHeight', () => {
  const wide = { bodyTop: 116, lineHeight: 44, bodyFontPx: 30, bottomPad: 22 }

  test('a four-line wide card keeps the historic 300px canvas', () => {
    expect(cardCanvasHeight(4, wide)).toBe(300)
  })

  test('it grows by one line height per wrapped line', () => {
    expect(cardCanvasHeight(5, wide) - cardCanvasHeight(4, wide)).toBe(wide.lineHeight)
  })

  test('a single line still leaves room for its own text', () => {
    expect(cardCanvasHeight(1, wide)).toBe(116 + 30 + 22)
  })
})
