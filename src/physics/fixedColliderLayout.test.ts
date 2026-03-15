import { expect, test } from 'bun:test'
import * as THREE from 'three'

import {
  buildCylinderFixedColliderSpecs,
  createFixedColliderSectorGrid,
  getActiveFixedColliderSectorKeys,
  getFixedColliderSectorCoord,
  getFixedColliderSectorKey
} from './fixedColliderLayout'

test('buildCylinderFixedColliderSpecs places the airlock colliders on the inner wall', () => {
  const specs = buildCylinderFixedColliderSpecs(100, 400)
  const door = specs.find((spec) => spec.id === 'airlock-door')

  if (door === undefined) {
    throw new Error('airlock door collider spec was not created')
  }

  expect(door.center.x).toBeLessThan(100)
  expect(door.center.x).toBeGreaterThan(99.7)
  expect(door.center.y).toBeCloseTo(-128, 6)
})

test('fixed collider sectors wrap around azimuth and expand around active positions', () => {
  const grid = createFixedColliderSectorGrid({
    radius: 200,
    length: 2000,
    targetArcLength: 100,
    axialStepMeters: 100
  })
  const edgePosition = new THREE.Vector3(200, 0, -0.001)
  const centerCoord = getFixedColliderSectorCoord(edgePosition, grid)
  const activeKeys = getActiveFixedColliderSectorKeys([edgePosition], grid, {
    azimuthPadding: 1,
    axialPadding: 0
  })

  expect(centerCoord.azimuthIndex).toBeGreaterThanOrEqual(0)
  expect(activeKeys.has(getFixedColliderSectorKey(centerCoord))).toBe(true)
  expect(
    activeKeys.has(
      getFixedColliderSectorKey({
        azimuthIndex: (centerCoord.azimuthIndex + grid.azimuthCount - 1) % grid.azimuthCount,
        axialIndex: centerCoord.axialIndex
      })
    )
  ).toBe(true)
})
