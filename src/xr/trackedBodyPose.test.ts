import { expect, test } from 'bun:test'
import * as THREE from 'three'
import { projectTrackedBodyPose, sampleTrackedBodyPose } from './trackedBodyPose'

test('room-scale head and left/right grips follow the colony frame without mutating tracking', () => {
  const radius = 3200
  for (const azimuth of [0, 1.4, Math.PI - .0001, -Math.PI + .0001]) {
    const up = new THREE.Vector3(-Math.cos(azimuth), 0, -Math.sin(azimuth))
    const forward = new THREE.Vector3(0, 1, 0), right = new THREE.Vector3().crossVectors(forward, up)
    const reference = new THREE.Matrix4().makeBasis(right, up, forward.clone().negate())
      .setPosition(Math.cos(azimuth) * radius, -200, Math.sin(azimuth) * radius)
    const head = new THREE.Matrix4().makeTranslation(.2, 1.65, -.3)
    const hands: [THREE.Matrix4, THREE.Matrix4] = [new THREE.Matrix4().makeTranslation(-.25, 1.1, -.55), new THREE.Matrix4().makeTranslation(.3, 1.2, -.4)]
    const inputs = [reference, head, ...hands].map(m => m.clone())
    const pose = projectTrackedBodyPose(head, hands, reference, radius, 0)!
    expect(pose.axial).toBeCloseTo(-199.7)
    expect(pose.eyeHeight).toBeCloseTo(1.65, 3)
    expect(pose.heading).toBeCloseTo(0)
    for (let i = 0; i < 2; i++) {
      const expected = new THREE.Vector3().setFromMatrixPosition(hands[i]).applyMatrix4(reference)
      expect(new THREE.Vector3().fromArray(pose.hands[i]!.position).distanceTo(expected)).toBeLessThan(1e-7)
    }
    expect([reference, head, ...hands].every((m, i) => m.equals(inputs[i]))).toBe(true)
  }
})

test('missing grips disappear and straight-down head pitch keeps the previous body heading', () => {
  const reference = new THREE.Matrix4().makeRotationZ(Math.PI / 2).setPosition(3200, 0, 0)
  const head = new THREE.Matrix4().makeRotationX(-Math.PI / 2).setPosition(0, 1.7, 0)
  const pose = projectTrackedBodyPose(head, [null, null], reference, 3200, .75)!
  expect(pose.heading).toBe(.75)
  expect(pose.hands).toEqual([null, null])
  head.elements[12] = NaN
  expect(projectTrackedBodyPose(head, [null, null], reference, 3200, 0)).toBeNull()
})

test('runtime sampling clears missing or emulated tracking instead of retaining old limbs', () => {
  const reference = {} as XRReferenceSpace, grip = {} as XRSpace
  const head = { transform: { matrix: new THREE.Matrix4().makeTranslation(0, 1.7, 0).toArray() }, emulatedPosition: false }
  let currentHead: typeof head | null = head
  let currentHand: typeof head | null = { ...head, transform: { matrix: new THREE.Matrix4().makeTranslation(-.2, 1.1, -.3).toArray() } }
  const renderer = { xr: {
    getFrame: () => ({ getViewerPose: () => currentHead, getPose: () => currentHand }),
    getReferenceSpace: () => reference,
    getSession: () => ({ inputSources: [{ handedness: 'left', gripSpace: grip }] })
  } } as unknown as THREE.WebGLRenderer
  const rig = new THREE.Group(), colony = new THREE.Group()
  rig.position.x = 3200; rig.rotation.z = Math.PI / 2
  const sample = () => sampleTrackedBodyPose(renderer, rig, colony, 3200, 0)
  expect(sample()!.hands[0]).not.toBeNull()
  currentHand = null
  expect(sample()!.hands).toEqual([null, null])
  currentHand = { ...head, emulatedPosition: true }
  expect(sample()!.hands).toEqual([null, null])
  currentHead = null
  expect(sample()).toBeNull()
  currentHead = { ...head, emulatedPosition: true }
  expect(sample()).toBeNull()
  expect(rig.position.toArray()).toEqual([3200, 0, 0])
})
