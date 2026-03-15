import { expect, test } from 'bun:test'

import {
  createCylinderNightLightPlan,
  getCylinderNightLightRepeat,
  getCylinderNightLightVisibilityBoost,
  getCylinderSurfaceRepeat
} from './cylinderSurface'

test('getCylinderSurfaceRepeat grows with habitat dimensions', () => {
  const compact = getCylinderSurfaceRepeat(50, 200)
  const large = getCylinderSurfaceRepeat(3200, 40000)

  expect(compact.circumferential).toBeGreaterThanOrEqual(1)
  expect(compact.axial).toBeGreaterThanOrEqual(1)
  expect(large.circumferential).toBeGreaterThan(compact.circumferential)
  expect(large.axial).toBeGreaterThan(compact.axial)
})

test('getCylinderSurfaceRepeat respects the requested world tile size', () => {
  const coarse = getCylinderSurfaceRepeat(100, 1000, 24, 24)
  const fine = getCylinderSurfaceRepeat(100, 1000, 6, 6)

  expect(fine.circumferential).toBeGreaterThan(coarse.circumferential)
  expect(fine.axial).toBeGreaterThan(coarse.axial)
})

test('createCylinderNightLightPlan increases lit windows with density', () => {
  const darkPlan = createCylinderNightLightPlan(256, 0, 42)
  const brightPlan = createCylinderNightLightPlan(256, 1, 42)

  expect(darkPlan.lights).toHaveLength(0)
  expect(brightPlan.lights.length).toBeGreaterThan(darkPlan.lights.length)
})

test('getCylinderNightLightRepeat uses larger districts on larger habitats', () => {
  const compact = getCylinderNightLightRepeat(100, 1000)
  const massive = getCylinderNightLightRepeat(30000, 2000)

  expect(compact.circumferential).toBeGreaterThanOrEqual(1)
  expect(massive.circumferential).toBeLessThan(getCylinderSurfaceRepeat(30000, 2000).circumferential)
  expect(massive.axial).toBeLessThan(getCylinderSurfaceRepeat(30000, 2000).axial)
})

test('getCylinderNightLightVisibilityBoost grows with radius within a safe clamp', () => {
  expect(getCylinderNightLightVisibilityBoost(100)).toBeLessThan(
    getCylinderNightLightVisibilityBoost(30000)
  )
  expect(getCylinderNightLightVisibilityBoost(30000)).toBeLessThanOrEqual(1.6)
})
