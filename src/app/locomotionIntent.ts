import * as THREE from 'three'

export type LocomotionIntent = {
  groundedAxis: number
  groundedTangent: number
  freeFlyThrust: THREE.Vector3
  freeFlyBrake: number
  detachRequested: boolean
  detachLaunchVelocity: THREE.Vector3
}

export const createLocomotionIntent = (): LocomotionIntent => ({
  groundedAxis: 0,
  groundedTangent: 0,
  freeFlyThrust: new THREE.Vector3(),
  freeFlyBrake: 0,
  detachRequested: false,
  detachLaunchVelocity: new THREE.Vector3()
})
