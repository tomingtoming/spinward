import { expect, test } from 'bun:test'
import * as THREE from 'three'

import { ControllerVelocityTracker } from './controllerVelocity'

const expectVectorCloseTo = (actual: THREE.Vector3, expected: THREE.Vector3) => {
  expect(actual.x).toBeCloseTo(expected.x, 6)
  expect(actual.y).toBeCloseTo(expected.y, 6)
  expect(actual.z).toBeCloseTo(expected.z, 6)
}

test('ControllerVelocityTracker follows world-space motion caused by parent rotation', () => {
  const tracker = new ControllerVelocityTracker()
  const root = new THREE.Group()
  const controller = new THREE.Group() as unknown as THREE.XRTargetRaySpace
  const objectController = controller as unknown as THREE.Object3D
  const previousWorldPosition = new THREE.Vector3()
  const nextWorldPosition = new THREE.Vector3()

  objectController.position.set(0.25, 0, -0.5)
  root.add(objectController)
  root.updateWorldMatrix(true, true)
  objectController.getWorldPosition(previousWorldPosition)

  tracker.registerController(controller)
  tracker.update(1 / 60)

  root.rotation.y = Math.PI * 0.5
  root.updateWorldMatrix(true, true)
  objectController.getWorldPosition(nextWorldPosition)
  tracker.update(0.5)

  expectVectorCloseTo(
    tracker.getVelocity(controller),
    nextWorldPosition.sub(previousWorldPosition).divideScalar(0.5)
  )
})
