import { describe, expect, test } from 'bun:test'

import { buildExpresswayPanels } from './rotatingCylinder'
import { getCityExpressway, getExpresswayElevation } from '../objects/cityLayout'

// The physics treads and the analytic elevation function are two views of the
// same surface; the car's GROUND_TOLERANCE (0.6 m) is the budget that keeps
// its grounding in agreement with the real Rapier contact.
describe('expressway physics panels', () => {
  const radius = 3200
  const expressway = getCityExpressway(radius)

  test('ramp treads follow the shared elevation function within ground tolerance', () => {
    if (expressway === null) throw new Error('expected an expressway at r=3200')

    const panels = buildExpresswayPanels(
      { radius, length: 40000, wallThickness: 2, expressway },
      radius
    )
    const rampAxial =
      expressway.axial + expressway.deckWidth * 0.5 + expressway.rampWidth * 0.5
    const treads = panels.filter(
      (panel) =>
        Math.abs(panel.halfExtents.y - expressway.rampWidth / 2) < 1e-6 &&
        Math.abs(panel.translation.y - rampAxial) < 1e-6
    )
    expect(treads.length).toBeGreaterThan(30)

    for (const tread of treads) {
      const azimuth = Math.atan2(tread.translation.z, tread.translation.x)
      const centreDistance = Math.hypot(tread.translation.x, tread.translation.z)
      // Panel centres sit half a wall thickness outside their surface.
      const surfaceRadius = centreDistance - 1
      const elevation = radius - surfaceRadius
      const expected = getExpresswayElevation(expressway, radius, azimuth, rampAxial)
      expect(Math.abs(elevation - expected)).toBeLessThan(0.6)
    }
  })

  test('the deck ring is a full circle, symmetric about the spin axis', () => {
    if (expressway === null) throw new Error('expected an expressway at r=3200')

    const panels = buildExpresswayPanels(
      { radius, length: 40000, wallThickness: 2, expressway },
      radius
    )
    const deck = panels.filter(
      (panel) => Math.abs(panel.halfExtents.y - expressway.deckWidth / 2) < 1e-6
    )
    expect(deck.length).toBeGreaterThan(100)

    // The kinematic body's centre of mass must stay on the axis (contact
    // surface velocity is angvel x (point - com)), so the ring must not bias
    // the collider mass to one side.
    let sumX = 0
    let sumZ = 0

    for (const panel of deck) {
      sumX += panel.translation.x
      sumZ += panel.translation.z
    }

    expect(Math.abs(sumX / deck.length)).toBeLessThan(1e-6)
    expect(Math.abs(sumZ / deck.length)).toBeLessThan(1e-6)
  })
})
