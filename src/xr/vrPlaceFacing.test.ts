import { expect, test } from 'bun:test'
import * as THREE from 'three'
import { VRLocomotion } from './vrLocomotion'
import { applySurfaceRigState } from '../app/surfaceRig'

test('VR place arrivals face the entrance through yaw only and preserve tracked head position and tilt', () => {
  const world = new THREE.Group(), player = new THREE.Group(), view = new THREE.Group(), head = new THREE.PerspectiveCamera()
  world.add(player); player.add(view); view.add(head)
  world.rotation.y = .7
  const locomotion = new VRLocomotion([], player, view, head)
  for (const azimuth of [0, 1.7, Math.PI - .00001]) for (const headYaw of [-1.2, .3, 2]) for (const heading of [-2, 0, 1.4]) {
    applySurfaceRigState(player, { azimuth, axialPosition: 200 }, 3200)
    head.position.set(.2, 1.65, -.3)
    head.quaternion.setFromEuler(new THREE.Euler(-.9, headYaw, .17, 'YXZ'))
    const originalPosition = head.position.clone(), originalOrientation = head.quaternion.clone(), rigPosition = player.position.clone()
    const desired = new THREE.Vector3(-Math.sin(azimuth) * Math.sin(heading), Math.cos(heading), Math.cos(azimuth) * Math.sin(heading))
      .applyQuaternion(world.quaternion)
    locomotion.faceGroundedDirection(desired)
    const up = new THREE.Vector3(-Math.cos(azimuth), 0, -Math.sin(azimuth)).applyQuaternion(world.quaternion)
    const actual = head.getWorldDirection(new THREE.Vector3()).projectOnPlane(up).normalize()
    expect(actual.distanceTo(desired)).toBeLessThan(1e-10)
    expect(head.position.equals(originalPosition)).toBe(true)
    expect(head.quaternion.equals(originalOrientation)).toBe(true)
    expect(player.position.equals(rigPosition)).toBe(true)
    expect(view.quaternion.x).toBeCloseTo(0, 12)
    expect(view.quaternion.z).toBeCloseTo(0, 12)
  }
  locomotion.clutchDebug.dispose()
})

test('vertical entrance directions are ignored and a vertical head pose yields a finite neutral yaw', () => {
  const player = new THREE.Group(), view = new THREE.Group(), head = new THREE.PerspectiveCamera()
  player.add(view); view.add(head)
  const locomotion = new VRLocomotion([], player, view, head)
  locomotion.applySpawnView()
  const previous = view.quaternion.clone()
  locomotion.faceGroundedDirection(new THREE.Vector3(0, 1, 0))
  expect(view.quaternion.equals(previous)).toBe(true)
  head.rotation.x = -Math.PI / 2
  locomotion.faceGroundedDirection(new THREE.Vector3(1, 0, 0))
  expect(view.quaternion.toArray().every(Number.isFinite)).toBe(true)
  head.quaternion.identity()
  expect(head.getWorldDirection(new THREE.Vector3()).distanceTo(new THREE.Vector3(1, 0, 0))).toBeLessThan(1e-10)
  locomotion.clutchDebug.dispose()
})
