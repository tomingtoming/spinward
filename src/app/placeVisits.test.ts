import { expect, test } from 'bun:test'
import { PLACE_DESTINATIONS, resolvePlaceVisit } from './placeVisits'
import { resolveRuntimeWatchAction } from './watchActionRouting'

test('café travel arrives at its entrance instead of against the service counter', () => {
  const counter = { azimuth: .1, axial: 20 }, entrance = { azimuth: .12, axial: 21 }
  expect(resolvePlaceVisit('visit-cafe', kind => kind === 'cafe' ? entrance : counter)).toBe(entrance)
  expect(resolvePlaceVisit('visit-cafe', () => null)).toBeNull()
})

test('every offered place has a runtime route and absent destinations remain absent', () => {
  for (const place of PLACE_DESTINATIONS) {
    expect(resolveRuntimeWatchAction(place.id)).toEqual({ kind: 'visit', action: place.id })
    const anchor = { azimuth: .2, axial: 50 }
    expect(resolvePlaceVisit(place.id, kind => kind === place.kind ? anchor : null)).toBe(anchor)
    expect(resolvePlaceVisit(place.id, () => null)).toBeNull()
  }
})
