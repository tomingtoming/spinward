import { describe, expect, test } from 'bun:test'

import { resolveLanding } from './arMode'

const ANGLE = -1.3962634015954636
const BANDS = [
  { id: 'east', band: 0, frame: { origin: [-9929.11983872236, -17801.912168926847] as [number, number], angle: ANGLE } },
  { id: 'central', band: 1, frame: { origin: [-13229.242294254544, -18383.812797479044] as [number, number], angle: ANGLE } },
  { id: 'west', band: 2, frame: { origin: [-16529.36474978673, -18965.71342603124] as [number, number], angle: ANGLE } }
]
const WIDTH = 3351.032163829113, SPAN = 40000

describe('AR landing', () => {
  test('Kanda station lands on its own east-band coordinates', () => {
    const l = resolveLanding(BANDS, 139.7709, 35.6918, WIDTH, SPAN)
    expect(l.bandId).toBe('east')
    expect(l.inside).toBe(true)
    expect(l.x).toBeCloseTo(-1368, -1)
    expect(l.y).toBeCloseTo(16884, -1)
    expect(l.edge).toBeGreaterThan(300)
  })

  test('Akihabara station is a few metres past the east edge and lands on the wall margin', () => {
    // toming held the phone up here on 2026-10-26 and the near field could not match.
    const l = resolveLanding(BANDS, 139.7731, 35.6984, WIDTH, SPAN)
    expect(l.bandId).toBe('east')
    expect(l.inside).toBe(false)
    expect(l.edge).toBeLessThan(20)
    expect(Math.abs(l.x)).toBeCloseTo(WIDTH / 2 - 25, 0)
  })

  test('Chiba is far outside and still lands on the nearest band edge', () => {
    const l = resolveLanding(BANDS, 140.1, 35.6, WIDTH, SPAN)
    expect(l.inside).toBe(false)
    expect(l.edge).toBeGreaterThan(10_000)
    expect(Math.abs(l.x)).toBeLessThanOrEqual(WIDTH / 2)
    expect(Math.abs(l.y)).toBeLessThanOrEqual(SPAN / 2)
  })
})
