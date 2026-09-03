import { describe, expect, test } from 'bun:test'
import { LAMP_SPACING_ARTERIAL, LAMP_SPACING_LOCAL, planLampSpots, selectNearbyLamps } from './streetLamps'
import type { CityIntersection, CityRoad } from './cityLayout'

const R = 3200
const avenue: CityRoad = { azimuth: 0.05, axial: 0, tangentWidth: 24, axialLength: 1000, kind: 'arterial' }
const street: CityRoad = { azimuth: 0, axial: 200, tangentWidth: 600, axialLength: 8, kind: 'local' }
const alley: CityRoad = { azimuth: 0.02, axial: 100, tangentWidth: 7.5, axialLength: 60, kind: 'alley' }
const crossing: CityIntersection = { azimuth: 0.05, axial: 200, avenueKind: 'arterial', streetKind: 'local', avenueWidth: 24, streetWidth: 8 }

describe('planLampSpots', () => {
  test('spaces lamps along each grid road, alternating kerbs, none in a crossing', () => {
    const spots = planLampSpots([avenue, street, alley], [crossing], R)
    const onAvenue = spots.filter((s) => s.isAvenue)
    const onStreet = spots.filter((s) => !s.isAvenue)
    expect(onAvenue.length).toBeGreaterThan(1000 / LAMP_SPACING_ARTERIAL - 3)
    expect(onStreet.length).toBeGreaterThan(600 / LAMP_SPACING_LOCAL - 3)
    expect(spots.some((s) => Math.abs(s.azimuth - alley.azimuth) < 1e-9 && Math.abs(s.axial - alley.axial) < 60)).toBe(false)
    // alternating sides
    for (let i = 1; i < onAvenue.length; i++) expect(onAvenue[i].side).toBe(-onAvenue[i - 1].side as 1 | -1)
    // clear of the crossing box on the avenue (street half width 4 + clearance 7)
    for (const s of onAvenue) expect(Math.abs(s.axial - 200)).toBeGreaterThan(4 + 7 - 1e-9)
    for (const s of onStreet) expect(Math.abs((s.azimuth - street.azimuth) * R - avenue.azimuth * R)).toBeGreaterThan(12 + 7 - 1e-9)
  })

  test('selectNearbyLamps keeps only spots within the surface range', () => {
    const spots = planLampSpots([avenue], [], R)
    const near = selectNearbyLamps(spots, R, avenue.azimuth, 0, 100)
    expect(near.length).toBeGreaterThan(0)
    for (const s of near) expect(Math.abs(s.axial)).toBeLessThanOrEqual(100)
    expect(selectNearbyLamps(spots, R, avenue.azimuth + 1, 0, 100).length).toBe(0)
  })
})
