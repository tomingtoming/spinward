import { describe, expect, test } from 'bun:test'

import { PC_CONTROL_SUMMARY, SP_CONTROL_SUMMARY, VR_CONTROL_SUMMARY } from '../xr/controlScheme'
import {
  TOUR_CARDS,
  createTourGuideState,
  notifyTourEvent,
  resolveTourCard,
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

describe('resolveTourCard', () => {
  test('passes non-templated cards through unchanged', () => {
    expect(resolveTourCard(TOUR_CARDS.throw, 'pc')).toBe(TOUR_CARDS.throw)
    expect(resolveTourCard(null, 'pc')).toBeNull()
  })

  test('start card shows each platform its own control summary, never another platform\'s', () => {
    const pc = resolveTourCard(TOUR_CARDS.start, 'pc')
    expect(pc?.body).toContain(PC_CONTROL_SUMMARY)
    expect(pc?.body.join(' ')).not.toContain(SP_CONTROL_SUMMARY)
    expect(pc?.body.join(' ')).not.toContain(VR_CONTROL_SUMMARY)

    const sp = resolveTourCard(TOUR_CARDS.start, 'sp')
    expect(sp?.body).toContain(SP_CONTROL_SUMMARY)

    const vr = resolveTourCard(TOUR_CARDS.start, 'vr')
    expect(vr?.body).toContain(VR_CONTROL_SUMMARY)
  })

  test('drive card resolves to that platform\'s driving bindings', () => {
    const pc = resolveTourCard(TOUR_CARDS.drive, 'pc')
    expect(pc?.body.join(' ')).toMatch(/W \/ S: Drive/)

    const sp = resolveTourCard(TOUR_CARDS.drive, 'sp')
    expect(sp?.body.join(' ')).toMatch(/Stick: Drive/)
  })

  test('enter-freefly only claims the grip-to-stop mechanic on VR, where it exists', () => {
    const vr = resolveTourCard(TOUR_CARDS['enter-freefly'], 'vr')
    expect(vr?.body[0]).toContain('squeeze left grip to stop')

    const pc = resolveTourCard(TOUR_CARDS['enter-freefly'], 'pc')
    expect(pc?.body[0]).not.toContain('grip')

    const sp = resolveTourCard(TOUR_CARDS['enter-freefly'], 'sp')
    expect(sp?.body[0]).not.toContain('grip')
  })

  test('resolving does not mutate the shared template', () => {
    resolveTourCard(TOUR_CARDS.start, 'sp')
    expect(TOUR_CARDS.start.body.some((line) => line.includes('{{'))).toBe(true)
  })

  test('every card, resolved for every platform, has no leftover placeholder', () => {
    for (const platform of ['pc', 'sp', 'vr'] as const) {
      for (const card of Object.values(TOUR_CARDS)) {
        const resolved = resolveTourCard(card, platform)
        for (const line of resolved?.body ?? []) {
          expect(line).not.toMatch(/\{\{/)
        }
      }
    }
  })
})
