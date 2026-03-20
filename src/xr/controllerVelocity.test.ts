import { expect, test } from 'bun:test'
import * as THREE from 'three'

import {
  ControllerVelocityTracker,
  averageVelocityBuffer,
  createVelocityBuffer,
  pushVelocityBuffer
} from './controllerVelocity'

const expectVectorCloseTo = (actual: THREE.Vector3, expected: THREE.Vector3) => {
  expect(actual.x).toBeCloseTo(expected.x, 6)
  expect(actual.y).toBeCloseTo(expected.y, 6)
  expect(actual.z).toBeCloseTo(expected.z, 6)
}

test('ControllerVelocityTracker exposes world-space motion caused by parent rotation', () => {
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
    tracker.getWorldVelocity(controller),
    nextWorldPosition.sub(previousWorldPosition).divideScalar(0.5)
  )
})

test('ControllerVelocityTracker keeps local controller velocity stable under parent rotation', () => {
  const tracker = new ControllerVelocityTracker()
  const root = new THREE.Group()
  const controller = new THREE.Group() as unknown as THREE.XRTargetRaySpace
  const objectController = controller as unknown as THREE.Object3D

  objectController.position.set(0.25, 0, -0.5)
  root.add(objectController)
  root.updateWorldMatrix(true, true)

  tracker.registerController(controller)
  tracker.update(1 / 60)

  root.rotation.y = Math.PI * 0.5
  root.updateWorldMatrix(true, true)
  tracker.update(0.5)

  expectVectorCloseTo(tracker.getLocalVelocity(controller), new THREE.Vector3(0, 0, 0))
})

test('averageVelocityBuffer returns the mean of pushed samples', () => {
  const buffer = createVelocityBuffer(4)
  const target = new THREE.Vector3()

  pushVelocityBuffer(buffer, new THREE.Vector3(2, 0, 0))
  pushVelocityBuffer(buffer, new THREE.Vector3(4, 0, 0))
  pushVelocityBuffer(buffer, new THREE.Vector3(6, 0, 0))
  averageVelocityBuffer(buffer, target)

  expect(target.x).toBeCloseTo(4, 6)
  expect(target.y).toBeCloseTo(0, 6)
})

test('averageVelocityBuffer wraps around and drops the oldest sample', () => {
  const buffer = createVelocityBuffer(3)
  const target = new THREE.Vector3()

  pushVelocityBuffer(buffer, new THREE.Vector3(10, 0, 0))
  pushVelocityBuffer(buffer, new THREE.Vector3(1, 0, 0))
  pushVelocityBuffer(buffer, new THREE.Vector3(1, 0, 0))
  pushVelocityBuffer(buffer, new THREE.Vector3(1, 0, 0))
  averageVelocityBuffer(buffer, target)

  expect(target.x).toBeCloseTo(1, 6)
})

test('ControllerVelocityTracker smooths velocity across multiple frames', () => {
  const tracker = new ControllerVelocityTracker()
  const root = new THREE.Group()
  const controller = new THREE.Group() as unknown as THREE.XRTargetRaySpace
  const objectController = controller as unknown as THREE.Object3D

  objectController.position.set(0, 0, 0)
  root.add(objectController)
  root.updateWorldMatrix(true, true)

  tracker.registerController(controller)
  tracker.update(1 / 60)

  const dt = 1 / 60
  const velocities: number[] = []

  for (let i = 0; i < 6; i++) {
    objectController.position.x += (i + 1) * 0.01
    root.updateWorldMatrix(true, true)
    tracker.update(dt)
    velocities.push((i + 1) * 0.01 / dt)
  }

  const averaged = tracker.getWorldVelocity(controller)
  const manualAverage =
    velocities.reduce((sum, v) => sum + v, 0) / velocities.length
  expect(averaged.x).toBeCloseTo(manualAverage, 4)
})
