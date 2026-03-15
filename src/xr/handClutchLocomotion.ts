import * as THREE from 'three'

const inverseQuaternion = new THREE.Quaternion()
const launchVector = new THREE.Vector3()
const thrustVector = new THREE.Vector3()
const localHandPosition = new THREE.Vector3()
const localHandOrientation = new THREE.Quaternion()
const anchorOrientationInverse = new THREE.Quaternion()
const anchoredLocalPosition = new THREE.Vector3()
const orientationEuler = new THREE.Euler(0, 0, 0, 'YXZ')

export type HandClutchState = {
  active: boolean
  anchorLocalPosition: THREE.Vector3
  anchorLocalOrientation: THREE.Quaternion
  anchorWorldPosition: THREE.Vector3
  controlFrameWorldPosition: THREE.Vector3
  controlFrameWorldQuaternion: THREE.Quaternion
  previousLocalDisplacement: THREE.Vector3
}

export type HandClutchSample = {
  active: boolean
  justActivated: boolean
  anchorWorldPosition: THREE.Vector3
  controlFrameWorldPosition: THREE.Vector3
  controlFrameWorldQuaternion: THREE.Quaternion
  localDisplacement: THREE.Vector3
  localOrientationDelta: THREE.Quaternion
  localVelocity: THREE.Vector3
}

export type AttachedClutchConfig = {
  moveDeadzone: number
  moveMaxDistance: number
  detachLiftDistance: number
  detachLiftSpeed: number
  minLaunchSpeed: number
  maxLaunchSpeed: number
}

export type FreeFlyClutchConfig = {
  thrustDeadzone: number
  thrustMaxDistance: number
}

export type RotationClutchConfig = {
  angleDeadzoneRadians: number
  maxAngleRadians: number
}

export type AttachedClutchIntent = {
  axis: number
  tangent: number
  lift: number
  detachRequested: boolean
  detachLaunchVelocity: THREE.Vector3
}

export type RotationClutchIntent = {
  pitch: number
  yaw: number
  roll: number
}

export const DEFAULT_ATTACHED_CLUTCH_CONFIG: AttachedClutchConfig = {
  moveDeadzone: 0.025,
  moveMaxDistance: 0.16,
  detachLiftDistance: 0.11,
  detachLiftSpeed: 1.15,
  minLaunchSpeed: 2.2,
  maxLaunchSpeed: 6
}

export const DEFAULT_FREE_FLY_CLUTCH_CONFIG: FreeFlyClutchConfig = {
  thrustDeadzone: 0.03,
  thrustMaxDistance: 0.2
}

export const DEFAULT_ROTATION_CLUTCH_CONFIG: RotationClutchConfig = {
  angleDeadzoneRadians: THREE.MathUtils.degToRad(4),
  maxAngleRadians: THREE.MathUtils.degToRad(32)
}

export const createHandClutchState = (): HandClutchState => ({
  active: false,
  anchorLocalPosition: new THREE.Vector3(),
  anchorLocalOrientation: new THREE.Quaternion(),
  anchorWorldPosition: new THREE.Vector3(),
  controlFrameWorldPosition: new THREE.Vector3(),
  controlFrameWorldQuaternion: new THREE.Quaternion(),
  previousLocalDisplacement: new THREE.Vector3()
})

export const resetHandClutchState = (state: HandClutchState) => {
  state.active = false
  state.previousLocalDisplacement.set(0, 0, 0)
  return state
}

export const createHandClutchSample = (): HandClutchSample => ({
  active: false,
  justActivated: false,
  anchorWorldPosition: new THREE.Vector3(),
  controlFrameWorldPosition: new THREE.Vector3(),
  controlFrameWorldQuaternion: new THREE.Quaternion(),
  localDisplacement: new THREE.Vector3(),
  localOrientationDelta: new THREE.Quaternion(),
  localVelocity: new THREE.Vector3()
})

export const createRotationClutchIntent = (): RotationClutchIntent => ({
  pitch: 0,
  yaw: 0,
  roll: 0
})

export const sampleHandClutch = (
  state: HandClutchState,
  active: boolean,
  handWorldPosition: THREE.Vector3 | null,
  handWorldQuaternion: THREE.Quaternion | null,
  controlFrameWorldPosition: THREE.Vector3 | null,
  controlFrameWorldQuaternion: THREE.Quaternion | null,
  deltaSeconds: number,
  target = createHandClutchSample()
) => {
  if (
    !active ||
    handWorldPosition === null ||
    handWorldQuaternion === null ||
    controlFrameWorldPosition === null ||
    controlFrameWorldQuaternion === null
  ) {
    resetHandClutchState(state)
    target.active = false
    target.justActivated = false
    target.localDisplacement.set(0, 0, 0)
    target.localVelocity.set(0, 0, 0)
    return target
  }

  let justActivated = false

  if (!state.active) {
    state.active = true
    justActivated = true
    state.previousLocalDisplacement.set(0, 0, 0)
  }

  state.controlFrameWorldPosition.copy(controlFrameWorldPosition)
  state.controlFrameWorldQuaternion.copy(controlFrameWorldQuaternion)
  inverseQuaternion.copy(controlFrameWorldQuaternion).invert()
  localHandPosition
    .copy(handWorldPosition)
    .sub(controlFrameWorldPosition)
    .applyQuaternion(inverseQuaternion)

  if (justActivated) {
    state.anchorLocalPosition.copy(localHandPosition)
  }

  localHandOrientation
    .copy(inverseQuaternion)
    .multiply(handWorldQuaternion)

  if (justActivated) {
    state.anchorLocalOrientation.copy(localHandOrientation)
  }

  anchoredLocalPosition.copy(state.anchorLocalPosition).applyQuaternion(controlFrameWorldQuaternion)
  state.anchorWorldPosition.copy(controlFrameWorldPosition).add(anchoredLocalPosition)

  target.localDisplacement.copy(localHandPosition).sub(state.anchorLocalPosition)
  anchorOrientationInverse.copy(state.anchorLocalOrientation).invert()
  target.localOrientationDelta.copy(anchorOrientationInverse).multiply(localHandOrientation).normalize()

  if (justActivated || deltaSeconds <= 1e-6) {
    target.localVelocity.set(0, 0, 0)
  } else {
    target.localVelocity
      .copy(target.localDisplacement)
      .sub(state.previousLocalDisplacement)
      .divideScalar(deltaSeconds)
  }

  state.previousLocalDisplacement.copy(target.localDisplacement)

  target.active = true
  target.justActivated = justActivated
  target.anchorWorldPosition.copy(state.anchorWorldPosition)
  target.controlFrameWorldPosition.copy(state.controlFrameWorldPosition)
  target.controlFrameWorldQuaternion.copy(state.controlFrameWorldQuaternion)
  return target
}

export const createAttachedClutchIntent = (): AttachedClutchIntent => ({
  axis: 0,
  tangent: 0,
  lift: 0,
  detachRequested: false,
  detachLaunchVelocity: new THREE.Vector3()
})

export const resolveAttachedClutchIntent = (
  sample: HandClutchSample,
  config = DEFAULT_ATTACHED_CLUTCH_CONFIG,
  target = createAttachedClutchIntent()
) => {
  const outwardLift = Math.max(0, -sample.localDisplacement.y)
  const outwardSpeed = Math.max(0, -sample.localVelocity.y)
  const liftRatio = outwardLift / Math.max(config.detachLiftDistance, 1e-6)
  const speedRatio = outwardSpeed / Math.max(config.detachLiftSpeed, 1e-6)
  const detachRatio = THREE.MathUtils.clamp(Math.max(liftRatio, speedRatio) - 1, 0, 1)

  target.axis = normalizeAxis(sample.localDisplacement.x, config.moveDeadzone, config.moveMaxDistance)
  target.tangent = normalizeAxis(sample.localDisplacement.z, config.moveDeadzone, config.moveMaxDistance)
  target.lift = THREE.MathUtils.clamp(Math.max(liftRatio, speedRatio), 0, 1)
  target.detachRequested = liftRatio >= 1 && speedRatio >= 1

  if (target.detachRequested) {
    const launchSpeed = THREE.MathUtils.lerp(
      config.minLaunchSpeed,
      config.maxLaunchSpeed,
      detachRatio
    )
    launchVector.set(0, -launchSpeed, 0).applyQuaternion(sample.controlFrameWorldQuaternion)
    target.detachLaunchVelocity.copy(launchVector)
  } else {
    target.detachLaunchVelocity.set(0, 0, 0)
  }

  return target
}

export const resolveFreeFlyClutchThrust = (
  sample: HandClutchSample,
  config = DEFAULT_FREE_FLY_CLUTCH_CONFIG,
  target = new THREE.Vector3()
) => {
  thrustVector.set(
    normalizeAxis(sample.localDisplacement.x, config.thrustDeadzone, config.thrustMaxDistance),
    normalizeAxis(sample.localDisplacement.y, config.thrustDeadzone, config.thrustMaxDistance),
    normalizeAxis(sample.localDisplacement.z, config.thrustDeadzone, config.thrustMaxDistance)
  )

  if (thrustVector.lengthSq() > 1) {
    thrustVector.normalize()
  }

  return target.copy(thrustVector).applyQuaternion(sample.controlFrameWorldQuaternion)
}

export const resolveRotationClutchIntent = (
  sample: HandClutchSample,
  config = DEFAULT_ROTATION_CLUTCH_CONFIG,
  target = createRotationClutchIntent()
) => {
  orientationEuler.setFromQuaternion(sample.localOrientationDelta, 'YXZ')
  target.pitch = normalizeRotationAxis(
    orientationEuler.x,
    config.angleDeadzoneRadians,
    config.maxAngleRadians
  )
  target.yaw = normalizeRotationAxis(
    orientationEuler.y,
    config.angleDeadzoneRadians,
    config.maxAngleRadians
  )
  target.roll = normalizeRotationAxis(
    orientationEuler.z,
    config.angleDeadzoneRadians,
    config.maxAngleRadians
  )
  return target
}

const normalizeAxis = (value: number, deadzone: number, maxDistance: number) => {
  const magnitude = Math.abs(value)

  if (magnitude <= deadzone) {
    return 0
  }

  const normalized =
    (magnitude - deadzone) / Math.max(maxDistance - deadzone, 1e-6)

  return THREE.MathUtils.clamp(normalized, 0, 1) * Math.sign(value)
}

const normalizeRotationAxis = (value: number, deadzone: number, maxAngle: number) => {
  const magnitude = Math.abs(value)

  if (magnitude <= deadzone) {
    return 0
  }

  const normalized =
    (magnitude - deadzone) / Math.max(maxAngle - deadzone, 1e-6)

  return THREE.MathUtils.clamp(normalized, 0, 1) * Math.sign(value)
}
