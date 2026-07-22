import { expect, test } from 'bun:test'
import * as THREE from 'three'

import {
  CITY_SHELL_MIN_RADIUS,
  axialToShellYFraction,
  azimuthToShellU,
  createCityShellTextureSet
} from './cityShellBake'
import type { CityPlan } from './cityLayout'
import { splitCylinderShellArcs } from './cylinder'

const TWO_PI = Math.PI * 2

test('azimuthToShellU maps plan azimuths into cylinder-geometry angular space', () => {
  // θ = π/2 − azimuth (x = R·sinθ vs x = R·cos a), normalized to one turn.
  expect(azimuthToShellU(Math.PI * 0.5)).toBeCloseTo(0, 10)
  expect(azimuthToShellU(0)).toBeCloseTo(0.25, 10)
  expect(azimuthToShellU(-Math.PI * 0.5)).toBeCloseTo(0.5, 10)
  expect(azimuthToShellU(Math.PI)).toBeCloseTo(0.75, 10)

  for (const azimuth of [-7.3, -1, 0, 0.4, 2, 9.9]) {
    const u = azimuthToShellU(azimuth)
    expect(u).toBeGreaterThanOrEqual(0)
    expect(u).toBeLessThan(1)
  }
})

test('azimuthToShellU agrees with the shell geometry theta convention', () => {
  // splitCylinderShellArcs centres its near arc on the focus azimuth using
  // the same θ = π/2 − azimuth convention the shell UVs are baked in; the
  // bake must land city texels at exactly that U or the far city would sit
  // on the wrong arc.
  for (const azimuth of [0, 0.7, 2.1, 4.4, 6.1]) {
    const arc = splitCylinderShellArcs(azimuth)
    const centerTheta = THREE.MathUtils.euclideanModulo(
      arc.near.thetaStart + arc.near.arcRadians * 0.5,
      TWO_PI
    )
    expect(centerTheta / TWO_PI).toBeCloseTo(azimuthToShellU(azimuth), 10)
  }
})

test('axialToShellYFraction puts the port end at the canvas bottom', () => {
  const length = 40000
  // V=0 (y=−L/2, the port end) samples the flipped canvas bottom row.
  expect(axialToShellYFraction(-length / 2, length)).toBeCloseTo(1, 10)
  expect(axialToShellYFraction(length / 2, length)).toBeCloseTo(0, 10)
  expect(axialToShellYFraction(0, length)).toBeCloseTo(0.5, 10)
})

test('createCityShellTextureSet skips habitats below the far-field threshold', () => {
  const plan: CityPlan = {
    roads: [],
    buildings: [
      {
        azimuth: 0,
        axial: 0,
        width: 10,
        depth: 10,
        height: 12,
        tone: 0.5,
        kind: 'block'
      }
    ],
    patches: [],
    trees: [],
    tower: null,
    landmark: null,
    expressway: null
  }

  expect(createCityShellTextureSet(plan, CITY_SHELL_MIN_RADIUS - 1, 2000)).toBeNull()
})

test('createCityShellTextureSet skips empty plans', () => {
  const plan: CityPlan = {
    roads: [],
    buildings: [],
    patches: [],
    trees: [],
    tower: null,
    landmark: null,
    expressway: null
  }

  expect(createCityShellTextureSet(plan, 3200, 40000)).toBeNull()
})
