import { describe, expect, test } from 'bun:test'

import { buildShareCard } from './shareCard'

describe('share card', () => {
  test('a plain link keeps the generic pitch for the preset', () => {
    const card = buildShareCard('?preset=izma')
    expect(card.title).toBe('Spinward — Izma Colony')
    expect(card.description).toContain('3.2 km radius')
    expect(card.description).toContain('Held by the spin.')
  })

  test('a grounded street-level view reads ~1 g on Izma', () => {
    const card = buildShareCard('?preset=izma&m=g&a=0&ax=0&t=0.5')
    expect(card.description).toContain('Standing on the inner wall')
    expect(card.description).toContain('feeling 1.00 g')
    expect(card.description).toContain('at midday')
  })

  test('a rooftop view names the height', () => {
    const card = buildShareCard('?preset=izma&m=g&a=0&ax=0&gh=40')
    expect(card.description).toContain('on a rooftop, 40 m up')
  })

  test('a free-fly view reports altitude and the lighter felt g', () => {
    // r = 1600 m on Izma: half the radius → half the gravity.
    const card = buildShareCard('?preset=izma&m=f&p=1600,0,0&rain')
    expect(card.description).toContain('1600 m above the floor')
    expect(card.description).toContain('feeling 0.50 g')
    expect(card.description).toContain('It is raining')
  })

  test('an exterior view reads as watching the colony turn', () => {
    const card = buildShareCard('?preset=izma&m=f&p=5120,0,0')
    expect(card.description).toContain('outside the hull')
  })

  test('an unknown preset falls back to Izma; spin overrides are honoured', () => {
    const card = buildShareCard('?preset=nonsense&rpm=1.058&m=g&a=0&ax=0')
    expect(card.title).toBe('Spinward — Izma Colony')
    // Double the spin rate → 4x the g at the same radius.
    expect(card.description).toContain('feeling 4.00 g')
  })
})
