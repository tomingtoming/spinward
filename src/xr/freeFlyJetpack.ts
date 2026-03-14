import * as THREE from 'three'

const COMFORT_DEADZONE = 0.18
const ANGULAR_ACCELERATION = Math.PI * 1.75
const ANGULAR_DAMPING = 0.35
const ANGULAR_BRAKE_DAMPING = 4.5
const MAX_ANGULAR_SPEED = Math.PI * 1.5
const forwardAxis = new THREE.Vector3(0, 0, -1)
const deltaAxis = new THREE.Vector3()

export type JetpackAttitudeState = {
  angularVelocity: THREE.Vector3
}

const deltaRotation = new THREE.Quaternion()

export const createJetpackAttitudeState = (): JetpackAttitudeState => ({
  angularVelocity: new THREE.Vector3()
})

export const getJetpackThrustDirection = (
  orientation: THREE.Quaternion,
  target = new THREE.Vector3()
) => target.copy(forwardAxis).applyQuaternion(orientation).normalize()

export const stepJetpackAttitude = (
  state: JetpackAttitudeState,
  stickX: number,
  stickY: number,
  deltaSeconds: number,
  brake = false
) => {
  const normalizedX = normalizeStick(stickX)
  const normalizedY = normalizeStick(stickY)

  state.angularVelocity.x += normalizedY * ANGULAR_ACCELERATION * deltaSeconds
  state.angularVelocity.z -= normalizedX * ANGULAR_ACCELERATION * deltaSeconds

  if (state.angularVelocity.lengthSq() > MAX_ANGULAR_SPEED * MAX_ANGULAR_SPEED) {
    state.angularVelocity.setLength(MAX_ANGULAR_SPEED)
  }

  const dampingFactor = Math.exp(-(brake ? ANGULAR_BRAKE_DAMPING : ANGULAR_DAMPING) * deltaSeconds)
  state.angularVelocity.multiplyScalar(dampingFactor)

  return state
}

export const resetJetpackAttitude = (state: JetpackAttitudeState) => {
  state.angularVelocity.set(0, 0, 0)
  return state
}

export const integrateJetpackAttitudeOrientation = (
  orientation: THREE.Quaternion,
  state: JetpackAttitudeState,
  deltaSeconds: number
) => {
  const angle = state.angularVelocity.length() * deltaSeconds

  if (angle <= 1e-6) {
    return orientation
  }

  deltaAxis.copy(state.angularVelocity).normalize()
  deltaRotation.setFromAxisAngle(deltaAxis, angle)
  return orientation.multiply(deltaRotation).normalize()
}

const normalizeStick = (value: number) => {
  if (Math.abs(value) < COMFORT_DEADZONE) {
    return 0
  }

  return ((Math.abs(value) - COMFORT_DEADZONE) / (1 - COMFORT_DEADZONE)) * Math.sign(value)
}
