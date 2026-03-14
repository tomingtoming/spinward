import * as THREE from 'three'

export type LocomotionIntent = {
  attachedAxis: number
  attachedTangent: number
  freeFlyThrust: THREE.Vector3
  freeFlyBrake: number
  detachRequested: boolean
  detachLaunchVelocity: THREE.Vector3
}

export const createLocomotionIntent = (): LocomotionIntent => ({
  attachedAxis: 0,
  attachedTangent: 0,
  freeFlyThrust: new THREE.Vector3(),
  freeFlyBrake: 0,
  detachRequested: false,
  detachLaunchVelocity: new THREE.Vector3()
})
