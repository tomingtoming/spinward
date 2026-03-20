import * as THREE from 'three'

import { computeThrowChargeSpeed } from '../xr/throwCharge'

export const MIN_FORWARD_FRACTION = 0.35

export const computeThrowVelocityReal = (
  carrierVelocityReal: THREE.Vector3,
  controllerVelocityReal: THREE.Vector3,
  forwardDirection: THREE.Vector3,
  heldSeconds: number,
  speedScale: number,
  target = new THREE.Vector3(),
  minForwardFraction = MIN_FORWARD_FRACTION
) => {
  target
    .copy(carrierVelocityReal)
    .add(controllerVelocityReal)
    .addScaledVector(
      forwardDirection,
      computeThrowChargeSpeed(heldSeconds, speedScale)
    )

  return applyMinForwardBias(target, forwardDirection, minForwardFraction)
}

export const applyMinForwardBias = (
  velocity: THREE.Vector3,
  forward: THREE.Vector3,
  minForwardFraction: number
) => {
  const speed = velocity.length()
  if (speed < 1e-6 || minForwardFraction <= 0) return velocity

  const forwardDot = velocity.dot(forward)
  const minForward = speed * minForwardFraction

  if (forwardDot >= minForward) return velocity

  velocity.addScaledVector(forward, minForward - forwardDot)
  velocity.setLength(speed)

  return velocity
}
