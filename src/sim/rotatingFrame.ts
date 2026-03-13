import * as THREE from 'three'

const coriolisVector = new THREE.Vector3()
const centrifugalVector = new THREE.Vector3()
const crossVector = new THREE.Vector3()

export const computeAngularVelocity = (omega: number, target = new THREE.Vector3()) =>
  target.set(0, omega, 0)

export const computeCoriolisAcceleration = (
  angularVelocity: THREE.Vector3,
  velocity: THREE.Vector3,
  target = new THREE.Vector3()
) => target.copy(coriolisVector.copy(angularVelocity).cross(velocity)).multiplyScalar(-2)

export const computeCentrifugalAcceleration = (
  angularVelocity: THREE.Vector3,
  position: THREE.Vector3,
  target = new THREE.Vector3()
) =>
  target
    .copy(centrifugalVector.copy(angularVelocity).cross(crossVector.copy(angularVelocity).cross(position)))
    .multiplyScalar(-1)

export const computeRotatingFrameAcceleration = (
  angularVelocity: THREE.Vector3,
  position: THREE.Vector3,
  velocity: THREE.Vector3,
  target = new THREE.Vector3()
) =>
  target
    .copy(computeCentrifugalAcceleration(angularVelocity, position))
    .add(computeCoriolisAcceleration(angularVelocity, velocity))
