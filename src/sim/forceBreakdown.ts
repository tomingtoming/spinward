import * as THREE from 'three'

import {
  computeAngularVelocity,
  computeCentrifugalAcceleration,
  computeCoriolisAcceleration,
  computeRotatingFrameAcceleration
} from './rotatingFrame'

export type ForceBreakdown = {
  angularVelocity: THREE.Vector3
  centrifugal: THREE.Vector3
  coriolis: THREE.Vector3
  total: THREE.Vector3
}

export const createForceBreakdown = (): ForceBreakdown => ({
  angularVelocity: new THREE.Vector3(),
  centrifugal: new THREE.Vector3(),
  coriolis: new THREE.Vector3(),
  total: new THREE.Vector3()
})

export const computeForceBreakdown = (
  omega: number,
  position: THREE.Vector3,
  velocity: THREE.Vector3,
  target = createForceBreakdown()
) => {
  computeAngularVelocity(omega, target.angularVelocity)
  computeCentrifugalAcceleration(target.angularVelocity, position, target.centrifugal)
  computeCoriolisAcceleration(target.angularVelocity, velocity, target.coriolis)
  computeRotatingFrameAcceleration(target.angularVelocity, position, velocity, target.total)
  return target
}
