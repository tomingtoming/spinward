import * as THREE from 'three'

const rotationAxis = new THREE.Vector3(0, 1, 0)
const angularVelocity = new THREE.Vector3()
const transportVelocity = new THREE.Vector3()
const rotatingPosition = new THREE.Vector3()
const frameRotation = new THREE.Quaternion()

export const rotatingPositionToInertial = (
  position: THREE.Vector3,
  frameAngle: number,
  target = new THREE.Vector3()
) => target.copy(position).applyAxisAngle(rotationAxis, frameAngle)

export const inertialPositionToRotating = (
  position: THREE.Vector3,
  frameAngle: number,
  target = new THREE.Vector3()
) => target.copy(position).applyAxisAngle(rotationAxis, -frameAngle)

export const rotatingVelocityToInertial = (
  position: THREE.Vector3,
  velocity: THREE.Vector3,
  omega: number,
  frameAngle: number,
  target = new THREE.Vector3()
) => {
  angularVelocity.set(0, omega, 0)
  transportVelocity.copy(angularVelocity).cross(position)
  return target.copy(velocity).add(transportVelocity).applyAxisAngle(rotationAxis, frameAngle)
}

export const inertialVelocityToRotating = (
  position: THREE.Vector3,
  velocity: THREE.Vector3,
  omega: number,
  frameAngle: number,
  target = new THREE.Vector3()
) => {
  angularVelocity.set(0, omega, 0)
  inertialPositionToRotating(position, frameAngle, rotatingPosition)
  transportVelocity.copy(angularVelocity).cross(rotatingPosition)
  return target.copy(velocity).applyAxisAngle(rotationAxis, -frameAngle).sub(transportVelocity)
}

export const rotatingOrientationToInertial = (
  orientation: THREE.Quaternion,
  frameAngle: number,
  target = new THREE.Quaternion()
) => target.copy(frameRotation.setFromAxisAngle(rotationAxis, frameAngle)).multiply(orientation)

export const inertialOrientationToRotating = (
  orientation: THREE.Quaternion,
  frameAngle: number,
  target = new THREE.Quaternion()
) => target.copy(frameRotation.setFromAxisAngle(rotationAxis, -frameAngle)).multiply(orientation)
