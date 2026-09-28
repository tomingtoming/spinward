import { expect, test } from 'bun:test'
import { PLACE_DESTINATIONS, ALL_PLACE_DESTINATIONS, METRO_PLACE_DESTINATIONS, placesForHabitat, resolvePlaceVisit } from './placeVisits'
import { resolveRuntimeWatchAction } from './watchActionRouting'
import { createTourGuideState, notifyTourEvent, stepTourGuide } from './tourGuide'

test('café travel arrives at its entrance instead of against the service counter', () => {
  const counter = { azimuth: .1, axial: 20 }, entrance = { azimuth: .12, axial: 21 }
  expect(resolvePlaceVisit('visit-cafe', kind => kind === 'cafe' ? entrance : counter)).toBe(entrance)
  expect(resolvePlaceVisit('visit-cafe', () => null)).toBeNull()
})

test('every offered place has a runtime route and absent destinations remain absent', () => {
  for (const place of ALL_PLACE_DESTINATIONS) {
    expect(resolveRuntimeWatchAction(place.id)).toEqual({ kind: 'visit', action: place.id })
    const anchor = { azimuth: .2, axial: 50 }
    expect(resolvePlaceVisit(place.id, kind => kind === place.kind ? anchor : null)).toBe(anchor)
    expect(resolvePlaceVisit(place.id, () => null)).toBeNull()
    const tour = createTourGuideState()
    expect(notifyTourEvent(tour, place.id)).toBe(true)
    expect(stepTourGuide(tour, .016)?.title).toBeTruthy()
  }
})

test('Tokyo replaces generic entries and returning to another habitat restores them', () => {
  const available = new Set(['visit-landscape', ...METRO_PLACE_DESTINATIONS.map(p => p.id)] as const)
  expect(placesForHabitat(available)).toEqual(METRO_PLACE_DESTINATIONS)
  available.clear()
  expect(placesForHabitat(available)).toBe(PLACE_DESTINATIONS)
})
