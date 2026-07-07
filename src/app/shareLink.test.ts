import { describe, expect, test } from 'bun:test'

import { decodeShareState, encodeShareState } from './shareLink'

const IDENTITY = { x: 0, y: 0, z: 0, w: 1 }

describe('share link round trip', () => {
  test('grounded pose survives encode → decode', () => {
    const query = encodeShareState({
      presetId: 'izma',
      rpm: 0.529,
      presetRpm: 0.529,
      dayNightPhase: 0.31,
      raining: false,
      pose: { mode: 'grounded', azimuth: 1.23456, axialPosition: -42.5 },
      orientation: { x: 0.1, y: 0.2, z: 0.3, w: 0.9273 }
    })
    const state = decodeShareState(`?${query}`)

    expect(state.pose).toEqual({
      mode: 'grounded',
      azimuth: 1.23456,
      axialPosition: -42.5
    })
    expect(state.dayNightPhase).toBeCloseTo(0.31, 5)
    expect(state.orientation?.w).toBeCloseTo(0.9273, 3)
    // Matching preset spin is omitted so vanilla links stay short.
    expect(state.rpm).toBeNull()
    expect(query).toContain('preset=izma')
    expect(query).not.toContain('rain')
  })

  test('free-fly pose and custom spin survive', () => {
    const query = encodeShareState({
      presetId: 'izma',
      rpm: 1.25,
      presetRpm: 0.529,
      dayNightPhase: 0.8,
      raining: true,
      pose: { mode: 'free-fly', position: { x: 1200.04, y: -300.26, z: 8.15 } },
      orientation: IDENTITY
    })
    const state = decodeShareState(`?${query}`)

    expect(state.pose).toEqual({
      mode: 'free-fly',
      position: { x: 1200, y: -300.3, z: 8.2 }
    })
    expect(state.rpm).toBeCloseTo(1.25, 5)
    // The rain flag reads the same as a hand-typed ?rain.
    expect(query).toMatch(/(^|&)rain(&|$)/)
  })

  test('the decoded orientation comes back normalized', () => {
    const query = encodeShareState({
      presetId: null,
      rpm: 5,
      presetRpm: null,
      dayNightPhase: 0.5,
      raining: false,
      pose: { mode: 'grounded', azimuth: 0, axialPosition: 0 },
      orientation: { x: 2, y: 0, z: 0, w: 0 }
    })
    const state = decodeShareState(`?${query}`)
    expect(state.orientation).toEqual({ x: 1, y: 0, z: 0, w: 0 })
  })

  test('malformed pieces decode to null without poisoning the rest', () => {
    const state = decodeShareState('?m=f&p=1,2&q=0,0,0,0&t=7&rpm=99&preset=izma')
    expect(state.pose).toBeNull()
    expect(state.orientation).toBeNull()
    expect(state.dayNightPhase).toBeNull()
    expect(state.rpm).toBeNull()
  })

  test('a plain URL decodes to an all-null state', () => {
    const state = decodeShareState('')
    expect(state).toEqual({
      pose: null,
      orientation: null,
      dayNightPhase: null,
      rpm: null
    })
  })
})
