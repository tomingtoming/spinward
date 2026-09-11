import { expect, test } from 'bun:test'
import { PlayerFootSurface } from './playerFootSurface'
import type { CityPlan } from './cityLayout'

test('feet follow road, kerb, indoor floor and roof levels across the cylindrical seam', () => {
  for (const radius of [18, 180, 3200, 10000]) {
    const surface = new PlayerFootSurface()
    const plan: CityPlan = { roads: [{ azimuth: Math.PI, axial: 0, tangentWidth: 4, axialLength: 20, kind: 'local' }],
      buildings: [], intersections: [], patches: [], trees: [], tower: null, expressway: null }
    surface.setPlan(plan, [{ azimuth: Math.PI + 3 / radius, axial: 0, tangentExtent: 2, axialExtent: 20,
      isAvenue: true, roadSide: -1 }], radius)
    // Both signs of the azimuth seam must select the same road finish.
    expect(surface.sample(Math.PI - .5 / radius, 0, 0, false)).toBeCloseTo(.22)
    expect(surface.sample(-Math.PI + .5 / radius, 0, 0, false)).toBeCloseTo(.22)
    expect(surface.sample(-Math.PI + 3 / radius, 0, 0, false)).toBeCloseTo(.34)
    expect(surface.sample(Math.PI, 30, 0, false)).toBeCloseTo(.1)
    expect(surface.sample(Math.PI, 0, 0, true)).toBeCloseTo(.25)
    expect(surface.sample(Math.PI, 0, 22, true)).toBeCloseTo(22.015)
    // A habitat/plan switch must discard old surface bands.
    surface.setPlan(null, [], radius)
    expect(surface.sample(Math.PI, 0, 0, false)).toBeCloseTo(.1)
  }
})
