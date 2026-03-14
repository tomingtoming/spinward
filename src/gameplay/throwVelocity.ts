import * as THREE from 'three'

import { computeThrowChargeSpeed } from '../xr/throwCharge'

export const computeThrowVelocityReal = (
  controllerVelocityReal: THREE.Vector3,
  forwardDirection: THREE.Vector3,
  heldSeconds: number,
  speedScale: number,
  target = new THREE.Vector3()
) =>
  target
    .copy(controllerVelocityReal)
    .addScaledVector(
      forwardDirection,
      computeThrowChargeSpeed(heldSeconds, speedScale)
    )
