import { expect, test } from 'bun:test'

import { buildCylinderWallPanels, resolveCylinderWallSegmentCount } from './rotatingCylinder'

test('buildCylinderWallPanels creates the requested number of wall segments', () => {
  const panels = buildCylinderWallPanels({
    radius: 10,
    length: 20,
    segmentCount: 8,
    wallThickness: 1
  })

  expect(panels).toHaveLength(8)
})

test('buildCylinderWallPanels places the first panel tangent to the inner wall', () => {
  const [firstPanel] = buildCylinderWallPanels({
    radius: 10,
    length: 20,
    segmentCount: 16,
    wallThickness: 1
  })

  expect(firstPanel.translation.x).toBeCloseTo(10.5, 6)
  expect(firstPanel.translation.y).toBeCloseTo(0, 6)
  expect(firstPanel.translation.z).toBeCloseTo(0, 6)
  expect(firstPanel.halfExtents.x).toBeCloseTo(0.5, 6)
  expect(firstPanel.halfExtents.y).toBeCloseTo(10, 6)
})

test('buildCylinderWallPanels spans around the full cylinder circumference', () => {
  const panels = buildCylinderWallPanels({
    radius: 12,
    length: 30,
    segmentCount: 12,
    wallThickness: 0.8
  })

  expect(panels[3]?.translation.x).toBeCloseTo(0, 6)
  expect(panels[3]?.translation.z).toBeCloseTo(12.4, 6)
  expect(panels[6]?.translation.x).toBeCloseTo(-12.4, 6)
  expect(panels[6]?.translation.z).toBeCloseTo(0, 6)
})

test('resolveCylinderWallSegmentCount grows with cylinder radius when using adaptive defaults', () => {
  const compactCount = resolveCylinderWallSegmentCount({ radius: 10 })
  const largeCount = resolveCylinderWallSegmentCount({ radius: 80 })

  expect(compactCount).toBeGreaterThanOrEqual(24)
  expect(largeCount).toBeGreaterThan(compactCount)
  expect(largeCount).toBeLessThanOrEqual(144)
})
