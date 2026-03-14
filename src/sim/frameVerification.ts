import * as THREE from 'three'

import { computeForceBreakdown, createForceBreakdown, type ForceBreakdown } from './forceBreakdown'

export type FrameVerification = {
  breakdown: ForceBreakdown
  estimatedAcceleration: THREE.Vector3
  errorVector: THREE.Vector3
  errorMagnitude: number
  warning: boolean
}

type FrameVerificationInput = {
  omega: number
  rotatingPosition: THREE.Vector3
  rotatingVelocity: THREE.Vector3
  previousRotatingVelocity: THREE.Vector3 | null
  deltaSeconds: number
  errorThreshold: number
}

const createFrameVerification = (): FrameVerification => ({
  breakdown: createForceBreakdown(),
  estimatedAcceleration: new THREE.Vector3(),
  errorVector: new THREE.Vector3(),
  errorMagnitude: 0,
  warning: false
})

export const computeFrameVerification = (
  input: FrameVerificationInput,
  target = createFrameVerification()
) => {
  computeForceBreakdown(
    input.omega,
    input.rotatingPosition,
    input.rotatingVelocity,
    target.breakdown
  )

  if (input.previousRotatingVelocity === null || input.deltaSeconds <= 0) {
    target.estimatedAcceleration.set(0, 0, 0)
  } else {
    target.estimatedAcceleration
      .copy(input.rotatingVelocity)
      .sub(input.previousRotatingVelocity)
      .divideScalar(input.deltaSeconds)
  }

  target.errorVector.copy(target.estimatedAcceleration).sub(target.breakdown.total)
  target.errorMagnitude = target.errorVector.length()
  target.warning = target.errorMagnitude > input.errorThreshold
  return target
}
