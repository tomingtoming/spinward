import { describe, expect, test } from 'bun:test'

import { decodeShareState, encodeShareState } from './shareLink'

const IDENTITY = { x: 0, y: 0, z: 0, w: 1 }

// Vanilla Izma: every preset-derived value matches, so none of them ride along.
const IZMA_BASE = {
  presetId: 'izma',
  rpm: 0.529,
  presetRpm: 0.529,
  radius: 3200,
  presetRadius: 3200,
  length: 40000,
  presetLength: 40000
}

describe('share link round trip', () => {
  test('grounded pose survives encode → decode', () => {
    const query = encodeShareState({
      ...IZMA_BASE,
      dayNightPhase: 0.31,
      raining: false,
      pose: {
        mode: 'grounded',
        azimuth: 1.23456,
        axialPosition: -42.5,
        groundHeight: 0
      },
      orientation: { x: 0.1, y: 0.2, z: 0.3, w: 0.9273 }
    })
    const state = decodeShareState(`?${query}`)

    expect(state.pose).toEqual({
      mode: 'grounded',
      azimuth: 1.23456,
      axialPosition: -42.5,
      groundHeight: 0
    })
    expect(state.dayNightPhase).toBeCloseTo(0.31, 5)
    expect(state.orientation?.w).toBeCloseTo(0.9273, 3)
    // Preset-matching spin/dimensions are omitted so vanilla links stay short.
    expect(state.rpm).toBeNull()
    expect(state.radius).toBeNull()
    expect(state.length).toBeNull()
    expect(state.raining).toBe(false)
    expect(query).toContain('preset=izma')
    expect(query).not.toContain('rain')
    expect(query).not.toContain('gh=')
  })

  test('a rooftop grounded pose carries its ground height', () => {
    const query = encodeShareState({
      ...IZMA_BASE,
      dayNightPhase: 0.5,
      raining: false,
      pose: { mode: 'grounded', azimuth: 0.5, axialPosition: 10, groundHeight: 38.25 },
      orientation: IDENTITY
    })
    const state = decodeShareState(`?${query}`)
    expect(state.pose?.mode).toBe('grounded')
    expect(
      state.pose?.mode === 'grounded' ? state.pose.groundHeight : null
    ).toBeCloseTo(38.3, 5)
  })

  test('free-fly pose, custom spin/dimensions and rain survive', () => {
    const query = encodeShareState({
      ...IZMA_BASE,
      rpm: 1.25,
      radius: 2500,
      length: 30000,
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
    expect(state.radius).toBe(2500)
    expect(state.length).toBe(30000)
    expect(state.raining).toBe(true)
    // The rain flag reads the same as a hand-typed ?rain.
    expect(query).toMatch(/(^|&)rain(&|$)/)
  })

  test('the decoded orientation comes back normalized', () => {
    const query = encodeShareState({
      ...IZMA_BASE,
      dayNightPhase: 0.5,
      raining: false,
      pose: { mode: 'grounded', azimuth: 0, axialPosition: 0, groundHeight: 0 },
      orientation: { x: 2, y: 0, z: 0, w: 0 }
    })
    const state = decodeShareState(`?${query}`)
    expect(state.orientation).toEqual({ x: 1, y: 0, z: 0, w: 0 })
  })

  test('malformed pieces decode to null without poisoning the rest', () => {
    const state = decodeShareState(
      '?m=f&p=1,2&q=0,0,0,0&t=7&rpm=99&r=2&len=1e12&preset=izma'
    )
    expect(state.pose).toBeNull()
    expect(state.orientation).toBeNull()
    expect(state.dayNightPhase).toBeNull()
    expect(state.rpm).toBeNull()
    // Out-of-range dimensions fall back rather than building a degenerate world.
    expect(state.radius).toBeNull()
    expect(state.length).toBeNull()
  })

  test('a plain URL decodes to an all-null state', () => {
    const state = decodeShareState('')
    expect(state).toEqual({
      pose: null,
      orientation: null,
      dayNightPhase: null,
      rpm: null,
      radius: null,
      length: null,
      raining: false
    })
  })
})
