import { expect, test } from 'bun:test'
import * as THREE from 'three'

import { StreamingCylinderWall } from './streamingCylinderWall'
import { initRapier } from './rapierContext'

test('StreamingCylinderWall keeps only nearby wall sectors active', async () => {
  const rapier = await initRapier()
  const world = new rapier.World({ x: 0, y: 0, z: 0 })
  const wall = new StreamingCylinderWall(rapier, world)

  wall.rebuild({
    radius: 100,
    length: 400,
    activationPadding: 2
  })
  wall.updateActiveSectors([new THREE.Vector3(100, 0, 0)])

  const nearSnapshot = wall.getDebugSnapshot()

  wall.updateActiveSectors([new THREE.Vector3(-100, 0, 0)])

  const farSnapshot = wall.getDebugSnapshot()

  expect(nearSnapshot.totalSectorCount).toBeGreaterThan(0)
  expect(nearSnapshot.activeSectorCount).toBe(5)
  expect(farSnapshot.activeSectorCount).toBe(5)
  expect(nearSnapshot.activeSectorIds).not.toEqual(farSnapshot.activeSectorIds)

  wall.updateActiveSectors([])

  const clearedSnapshot = wall.getDebugSnapshot()

  expect(clearedSnapshot.activeSectorCount).toBe(0)

  wall.dispose()
  world.free()
})

test('StreamingCylinderWall increases sector count for larger habitats', async () => {
  const rapier = await initRapier()
  const world = new rapier.World({ x: 0, y: 0, z: 0 })
  const wall = new StreamingCylinderWall(rapier, world)

  wall.rebuild({
    radius: 20,
    length: 200
  })
  const compactSnapshot = wall.getDebugSnapshot()

  wall.rebuild({
    radius: 3200,
    length: 40000
  })
  const largeSnapshot = wall.getDebugSnapshot()

  expect(compactSnapshot.totalSectorCount).toBeGreaterThanOrEqual(96)
  expect(largeSnapshot.totalSectorCount).toBeGreaterThan(compactSnapshot.totalSectorCount)
  expect(largeSnapshot.totalSectorCount).toBeLessThanOrEqual(720)

  wall.dispose()
  world.free()
})
