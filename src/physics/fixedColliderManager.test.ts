import { expect, test } from 'bun:test'
import * as THREE from 'three'

import { FixedColliderManager } from './fixedColliderManager'
import { initRapier } from './rapierContext'

test('FixedColliderManager enables only nearby collider sectors', async () => {
  const rapier = await initRapier()
  const world = new rapier.World({ x: 0, y: 0, z: 0 })
  const manager = new FixedColliderManager(rapier, world)

  manager.rebuild({
    radius: 100,
    length: 400
  })
  manager.updateActiveColliders([new THREE.Vector3(100, -128, 0)])

  const nearSnapshot = manager.getDebugSnapshot()

  manager.updateActiveColliders([new THREE.Vector3(-100, 128, 0)])

  const farSnapshot = manager.getDebugSnapshot()

  expect(nearSnapshot.totalCount).toBeGreaterThan(0)
  expect(nearSnapshot.activeCount).toBeGreaterThan(0)
  expect(farSnapshot.activeCount).toBe(0)

  manager.dispose()
  world.free()
})
