import { expect, test } from 'bun:test'
import * as THREE from 'three'

import {
  applyRotationAxisProfile,
  createGroundedClutchIntent,
  createHandClutchSample,
  createHandClutchState,
  createRotationClutchIntent,
  DEFAULT_ATTACHED_CLUTCH_CONFIG,
  DEFAULT_FREE_FLY_CLUTCH_CONFIG,
  DEFAULT_ROTATION_CLUTCH_CONFIG,
  rebaseHandClutchState,
  resolveGroundedClutchIntent,
  resolveFreeFlyClutchThrust,
  resolveRotationClutchIntent,
  sampleHandClutch
} from './handClutchLocomotion'

test('sampleHandClutch tracks local displacement in the anchored control frame', () => {
  const state = createHandClutchState()
  const sample = createHandClutchSample()
  const controlFrame = new THREE.Quaternion()

  sampleHandClutch(
    state,
    true,
    new THREE.Vector3(1, 2, 3),
    new THREE.Quaternion(),
    new THREE.Vector3(0, 0, 0),
    controlFrame,
    1 / 60,
    sample
  )
  sampleHandClutch(
    state,
    true,
    new THREE.Vector3(1.08, 1.95, 2.88),
    new THREE.Quaternion(),
    new THREE.Vector3(0, 0, 0),
    controlFrame,
    0.2,
    sample
  )

  expect(sample.active).toBe(true)
  expect(sample.localDisplacement.x).toBeCloseTo(0.08, 6)
  expect(sample.localDisplacement.y).toBeCloseTo(-0.05, 6)
  expect(sample.localDisplacement.z).toBeCloseTo(-0.12, 6)
  expect(sample.localVelocity.z).toBeCloseTo(-0.6, 6)
})

test('sampleHandClutch reanchors when it first becomes active', () => {
  const state = createHandClutchState()
  const sample = createHandClutchSample()

  sampleHandClutch(
    state,
    true,
    new THREE.Vector3(0, 0, 0),
    new THREE.Quaternion(),
    new THREE.Vector3(0, 0, 0),
    new THREE.Quaternion(),
    0.1,
    sample
  )

  expect(sample.justActivated).toBe(true)
  expect(sample.localDisplacement.length()).toBeCloseTo(0, 6)
  expect(sample.localVelocity.length()).toBeCloseTo(0, 6)
})

test('sampleHandClutch anchor follows the control frame world position', () => {
  const state = createHandClutchState()
  const sample = createHandClutchSample()
  const controlFrame = new THREE.Quaternion()

  sampleHandClutch(
    state,
    true,
    new THREE.Vector3(1, 0, 0),
    new THREE.Quaternion(),
    new THREE.Vector3(0, 0, 0),
    controlFrame,
    0.1,
    sample
  )
  sampleHandClutch(
    state,
    true,
    new THREE.Vector3(3, 0, 0),
    new THREE.Quaternion(),
    new THREE.Vector3(2, 0, 0),
    controlFrame,
    0.1,
    sample
  )

  expect(sample.anchorWorldPosition.x).toBeCloseTo(3, 6)
  expect(sample.localDisplacement.length()).toBeCloseTo(0, 6)
})

test('rebaseHandClutchState preserves displacement across a control-frame change', () => {
  const state = createHandClutchState()
  const sample = createHandClutchSample()
  const identity = new THREE.Quaternion()

  sampleHandClutch(
    state,
    true,
    new THREE.Vector3(1.3, 0.2, 0),
    identity,
    new THREE.Vector3(1, 0, 0),
    identity,
    0.1,
    sample
  )
  sampleHandClutch(
    state,
    true,
    new THREE.Vector3(1.3, 0.32, 0),
    identity,
    new THREE.Vector3(1, 0, 0),
    identity,
    0.1,
    sample
  )

  rebaseHandClutchState(
    state,
    new THREE.Vector3(1.5, 0.52, 0),
    identity,
    new THREE.Vector3(1.2, 0.2, 0),
    identity
  )
  sampleHandClutch(
    state,
    true,
    new THREE.Vector3(1.5, 0.52, 0),
    identity,
    new THREE.Vector3(1.2, 0.2, 0),
    identity,
    0.1,
    sample
  )

  expect(sample.localDisplacement.x).toBeCloseTo(0, 6)
  expect(sample.localDisplacement.y).toBeCloseTo(0.12, 6)
  expect(sample.localVelocity.length()).toBeCloseTo(0, 6)
})

test('resolveGroundedClutchIntent maps lateral hand motion onto wall movement', () => {
  const sample = createHandClutchSample()
  sample.active = true
  sample.localDisplacement.set(0.09, 0, -0.12)
  sample.controlFrameWorldQuaternion.identity()

  const intent = resolveGroundedClutchIntent(sample)

  expect(intent.axis).toBeGreaterThan(0.45)
  expect(intent.tangent).toBeLessThan(-0.65)
  expect(intent.detachRequested).toBe(false)
})

test('resolveRotationClutchIntent maps local hand orientation into pitch yaw and roll input', () => {
  const sample = createHandClutchSample()
  sample.active = true
  sample.localOrientationDelta.setFromEuler(
    new THREE.Euler(
      THREE.MathUtils.degToRad(18),
      THREE.MathUtils.degToRad(-14),
      THREE.MathUtils.degToRad(22),
      'YXZ'
    )
  )

  const intent = resolveRotationClutchIntent(
    sample,
    DEFAULT_ROTATION_CLUTCH_CONFIG,
    createRotationClutchIntent()
  )

  expect(intent.pitch).toBeGreaterThan(0.25)
  expect(intent.yaw).toBeLessThan(-0.15)
  expect(intent.roll).toBeGreaterThan(0.35)
})

test('resolveRotationClutchIntent keeps a small hand twist inside the deadzone', () => {
  const sample = createHandClutchSample()
  sample.active = true
  sample.localOrientationDelta.setFromEuler(
    new THREE.Euler(
      THREE.MathUtils.degToRad(4),
      THREE.MathUtils.degToRad(-5),
      THREE.MathUtils.degToRad(3),
      'YXZ'
    )
  )

  const intent = resolveRotationClutchIntent(sample)

  expect(intent.pitch).toBeCloseTo(0, 6)
  expect(intent.yaw).toBeCloseTo(0, 6)
  expect(intent.roll).toBeCloseTo(0, 6)
})

test('applyRotationAxisProfile gives roll extra play and softer gain', () => {
  expect(applyRotationAxisProfile(0.2, 0.24, 0.55)).toBeCloseTo(0, 6)
  expect(applyRotationAxisProfile(0.5, 0.24, 0.55)).toBeGreaterThan(0)
  expect(applyRotationAxisProfile(0.5, 0.24, 0.55)).toBeLessThan(0.25)
})

test('resolveGroundedClutchIntent requests detach on an upward lift of about 30cm', () => {
  const sample = createHandClutchSample()
  sample.active = true
  sample.localDisplacement.set(0, 0.31, 0)
  sample.localVelocity.set(0, 0.55, 0)
  sample.controlFrameWorldQuaternion.identity()

  const intent = resolveGroundedClutchIntent(sample, DEFAULT_ATTACHED_CLUTCH_CONFIG, createGroundedClutchIntent())

  expect(intent.detachRequested).toBe(true)
  expect(intent.detachLaunchVelocity.x).toBeCloseTo(0, 6)
  expect(intent.detachLaunchVelocity.y).toBeGreaterThan(2)
  expect(intent.detachLaunchVelocity.z).toBeCloseTo(0, 6)
})

test('resolveFreeFlyClutchThrust turns forward hand displacement into forward thrust', () => {
  const sample = createHandClutchSample()
  sample.active = true
  sample.localDisplacement.set(0.05, 0.03, -0.16)
  sample.controlFrameWorldQuaternion.identity()

  const thrust = resolveFreeFlyClutchThrust(sample, DEFAULT_FREE_FLY_CLUTCH_CONFIG)

  expect(thrust.x).toBeGreaterThan(0.05)
  expect(thrust.y).toBeCloseTo(0, 6)
  expect(thrust.z).toBeLessThan(-0.7)
})

test('resolveFreeFlyClutchThrust follows the anchored body frame orientation', () => {
  const sample = createHandClutchSample()
  sample.active = true
  sample.localDisplacement.set(0, 0, -0.18)
  sample.controlFrameWorldQuaternion.setFromAxisAngle(
    new THREE.Vector3(0, 1, 0),
    Math.PI * 0.5
  )

  const thrust = resolveFreeFlyClutchThrust(sample)

  expect(thrust.x).toBeLessThan(-0.8)
  expect(thrust.y).toBeCloseTo(0, 6)
  expect(Math.abs(thrust.z)).toBeLessThan(0.2)
})
