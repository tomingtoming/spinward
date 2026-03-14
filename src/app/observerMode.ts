import * as THREE from 'three'

import {
  rotatingOrientationToInertial,
  rotatingPositionToInertial
} from '../sim/frameTransforms'

export type ObserverMode = 'colony-fixed' | 'inertial-fixed'
export type TrailMode = 'rotating' | 'inertial' | 'both'

export type ObserverPose = {
  position: THREE.Vector3
  orientation: THREE.Quaternion
}

const createObserverPose = (): ObserverPose => ({
  position: new THREE.Vector3(),
  orientation: new THREE.Quaternion()
})

export const getDisplayRootRotation = (mode: ObserverMode, frameAngle: number) =>
  mode === 'inertial-fixed' ? frameAngle : 0

export const getEffectiveObserverMode = (requestedMode: ObserverMode, xrActive: boolean) =>
  xrActive ? 'colony-fixed' : requestedMode

export const computeInertialObserverPose = (
  rotatingPosition: THREE.Vector3,
  rotatingOrientation: THREE.Quaternion,
  frameAngle: number,
  target = createObserverPose()
) => {
  rotatingPositionToInertial(rotatingPosition, frameAngle, target.position)
  rotatingOrientationToInertial(rotatingOrientation, frameAngle, target.orientation)
  return target
}
