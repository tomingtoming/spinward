import { expect, test } from 'bun:test'
import * as THREE from 'three'
import { LaserPointer } from './laserPointer'

test('panel hit testing sees a fresh select-event pose before a render updates matrices', () => {
  const pointer = new LaserPointer(), controller = new THREE.Group() as THREE.XRTargetRaySpace
  const rig = new THREE.Group(), panel = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial())
  rig.position.set(3000, 20, -400); rig.rotation.y = .8; rig.add(controller, panel)
  panel.position.z = -.5
  let hit = pointer.hitTest(controller, panel)
  expect(hit?.distance).toBeCloseTo(.5, 8)
  expect(hit?.uv.x).toBeCloseTo(.5, 8)
  // Near the panel edge is still UI even when no enabled button occupies it.
  controller.position.x = .49
  hit = pointer.hitTest(controller, panel)
  expect(hit?.uv.x).toBeCloseTo(.99, 8)
  controller.position.x = .51
  expect(pointer.hitTest(controller, panel)).toBeNull()
  controller.position.x = 0; panel.position.z = -1.9
  expect(pointer.hitTest(controller, panel)).toBeNull()
  panel.geometry.dispose(); panel.material.dispose()
})
