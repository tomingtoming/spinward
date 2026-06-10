import { describe, expect, test } from 'bun:test'

import {
  TOUR_CARDS,
  createTourGuideState,
  notifyTourEvent,
  stepTourGuide
} from './tourGuide'

describe('notifyTourEvent', () => {
  test('shows a card when an event fires', () => {
    const state = createTourGuideState()
    expect(notifyTourEvent(state, 'start')).toBe(true)
    expect(stepTourGuide(state, 0.016)).toBe(TOUR_CARDS.start)
  })

  test('one-shot events do not re-show', () => {
    const state = createTourGuideState()
    notifyTourEvent(state, 'throw')
    stepTourGuide(state, TOUR_CARDS.throw.durationSeconds + 1)
    expect(notifyTourEvent(state, 'throw')).toBe(false)
    expect(stepTourGuide(state, 0.016)).toBeNull()
  })

  test('waypoint events re-show on every trigger', () => {
    const state = createTourGuideState()
    notifyTourEvent(state, 'overlook')
    stepTourGuide(state, TOUR_CARDS.overlook.durationSeconds + 1)
    expect(notifyTourEvent(state, 'overlook')).toBe(true)
    expect(stepTourGuide(state, 0.016)).toBe(TOUR_CARDS.overlook)
  })

  test('a new event replaces the active card', () => {
    const state = createTourGuideState()
    notifyTourEvent(state, 'start')
    notifyTourEvent(state, 'jump')
    expect(stepTourGuide(state, 0.016)).toBe(TOUR_CARDS.jump)
  })
})

describe('stepTourGuide', () => {
  test('card expires after its duration', () => {
    const state = createTourGuideState()
    notifyTourEvent(state, 'axis')
    expect(stepTourGuide(state, TOUR_CARDS.axis.durationSeconds * 0.5)).toBe(TOUR_CARDS.axis)
    expect(stepTourGuide(state, TOUR_CARDS.axis.durationSeconds)).toBeNull()
    expect(stepTourGuide(state, 0.016)).toBeNull()
  })

  test('returns null when nothing is active', () => {
    expect(stepTourGuide(createTourGuideState(), 0.016)).toBeNull()
  })

  test('every event id has a card with content', () => {
    for (const card of Object.values(TOUR_CARDS)) {
      expect(card.title.length).toBeGreaterThan(0)
      expect(card.body.length).toBeGreaterThan(0)
      expect(card.durationSeconds).toBeGreaterThan(0)
    }
  })
})
