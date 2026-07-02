import { describe, expect, test } from 'bun:test'
import * as THREE from 'three'

import { composeCameraParentTwist } from './desktopLookControls'

// The regression behind "the view snaps somewhere else the moment I jump":
// the free-fly handoff wrote `rig := cameraWorld`, silently assuming the
// camera hung directly under the rig. Since f40190f the viewRig between them
// carries a constant snap-yaw (the boot 90-degree facing), so every handoff
// gained an extra yaw. The fix conjugates by the parent-chain twist; these
// tests pin that algebra to the real hierarchy shape (rig > viewRig > camera).
describe('composeCameraParentTwist', () => {
  const buildHierarchy = (viewYaw: number) => {
    const rig = new THREE.Group()
    const viewRig = new THREE.Group()
    const camera = new THREE.PerspectiveCamera()
    rig.add(viewRig)
    viewRig.add(camera)
    viewRig.quaternion.setFromAxisAngle(new THREE.Vector3(0, 1, 0), viewYaw)
    return { rig, viewRig, camera }
  }

  test('collects the rotation between the camera and the rig', () => {
    const { rig, viewRig, camera } = buildHierarchy(Math.PI / 2)
    const twist = composeCameraParentTwist(camera, rig, new THREE.Quaternion())
    expect(twist.angleTo(viewRig.quaternion)).toBeCloseTo(0, 6)
  })

  test('rig = worldAttitude * twist^-1 keeps the camera world orientation across the handoff', () => {
    const { rig, camera } = buildHierarchy(Math.PI / 2)
    // A grounded pose: surface-basis rig, freely aimed camera.
    rig.quaternion.setFromEuler(new THREE.Euler(0.3, -1.1, 0.2))
    camera.rotation.set(-0.5, 0.8, 0)
    rig.updateMatrixWorld(true)

    const before = camera.getWorldQuaternion(new THREE.Quaternion())

    // The handoff: seed attitude from the world view, neutralise the camera,
    // hand the attitude to the rig conjugated by the parent twist.
    const twist = composeCameraParentTwist(camera, rig, new THREE.Quaternion())
    camera.rotation.set(0, 0, 0)
    rig.quaternion.copy(before).multiply(twist.clone().invert())
    rig.updateMatrixWorld(true)

    const after = camera.getWorldQuaternion(new THREE.Quaternion())
    expect(after.angleTo(before)).toBeCloseTo(0, 6)
  })

  test('the OLD handoff (rig := world) is off by exactly the view yaw — the jump snap', () => {
    const { rig, camera } = buildHierarchy(Math.PI / 2)
    camera.rotation.set(-0.4, 0.6, 0)
    rig.updateMatrixWorld(true)
    const before = camera.getWorldQuaternion(new THREE.Quaternion())

    camera.rotation.set(0, 0, 0)
    rig.quaternion.copy(before)
    rig.updateMatrixWorld(true)
    const after = camera.getWorldQuaternion(new THREE.Quaternion())

    expect(after.angleTo(before)).toBeCloseTo(Math.PI / 2, 6)
  })
})
