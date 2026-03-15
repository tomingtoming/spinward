import { expect, test } from 'bun:test'

import { getCylinderSurfaceRepeat } from './cylinderSurface'

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
