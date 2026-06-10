import * as THREE from 'three'

const zAxis = new THREE.Vector3(0, 0, 1)
const euler = new THREE.Euler()
const screenTransform = new THREE.Quaternion()
// Rotates the device frame (screen up) into the camera frame (look out the
// back of the device): -90 degrees around X.
const cameraTransform = new THREE.Quaternion(-Math.SQRT1_2, 0, 0, Math.SQRT1_2)

// W3C deviceorientation (alpha, beta, gamma in radians) + screen orientation
// -> camera world quaternion. Same convention as the classic three.js
// DeviceOrientationControls: holding the phone upright (beta = 90deg) facing
// the user looks straight at the horizon.
export const computeDeviceOrientationQuaternion = (
  alphaRad: number,
  betaRad: number,
  gammaRad: number,
  screenOrientationRad: number,
  target = new THREE.Quaternion()
) => {
  euler.set(betaRad, alphaRad, -gammaRad, 'YXZ')
  target.setFromEuler(euler)
  target.multiply(cameraTransform)
  target.multiply(screenTransform.setFromAxisAngle(zAxis, -screenOrientationRad))
  return target
}
