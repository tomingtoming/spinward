import { expect, test } from 'bun:test'
import * as THREE from 'three'

import { buildCylinderWallPanels, resolveCylinderWallSegmentCount } from './rotatingCylinder'

test('every wall panel faces outward at its own azimuth', () => {
  // The old +angle rotation yawed panels by twice their azimuth (a +Y
  // rotation maps +X to (cos, -sin)), sawtoothing the physical floor and
  // snagging tangential drivers at every seam.
  const segmentCount = 12
  const panels = buildCylinderWallPanels({
    radius: 12,
    length: 30,
    segmentCount,
    wallThickness: 0.8
  })

  panels.forEach((panel, index) => {
    const angle = (index / segmentCount) * Math.PI * 2
    const outward = new THREE.Vector3(1, 0, 0).applyQuaternion(panel.rotation)
    expect(outward.x).toBeCloseTo(Math.cos(angle), 6)
    expect(outward.z).toBeCloseTo(Math.sin(angle), 6)
  })
})

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

test('resolveCylinderWallSegmentCount honours ridge and sagitta budgets', () => {
  const compactCount = resolveCylinderWallSegmentCount({ radius: 10 })
  const izmaCount = resolveCylinderWallSegmentCount({ radius: 3200 })
  const elysiumCount = resolveCylinderWallSegmentCount({ radius: 30000 })

  // Small habitats are ridge-bound: seam dihedrals stay <= 0.02 rad so
  // walkers are not launched at panel boundaries.
  expect(compactCount).toBe(Math.ceil((Math.PI * 2) / 0.02))
  // Kilometre habitats are sagitta-bound and need more panels...
  expect(izmaCount).toBeGreaterThan(compactCount)
  // ...up to the collider-count cap.
  expect(elysiumCount).toBe(1024)
})
