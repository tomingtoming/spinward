import * as THREE from 'three'

type ControllerSample = {
  previousPosition: THREE.Vector3
  velocity: THREE.Vector3
  initialized: boolean
}

const ZERO_VECTOR = new THREE.Vector3()
const currentPosition = new THREE.Vector3()

export class ControllerVelocityTracker {
  private readonly samples = new Map<THREE.XRTargetRaySpace, ControllerSample>()

  registerController(controller: THREE.XRTargetRaySpace) {
    if (this.samples.has(controller)) {
      return
    }

    this.samples.set(controller, {
      previousPosition: new THREE.Vector3(),
      velocity: new THREE.Vector3(),
      initialized: false
    })
  }

  update(deltaSeconds: number) {
    for (const [controller, sample] of this.samples) {
      controller.getWorldPosition(currentPosition)

      if (!sample.initialized || deltaSeconds <= 0) {
        sample.velocity.set(0, 0, 0)
      } else {
        sample.velocity.copy(currentPosition).sub(sample.previousPosition).divideScalar(deltaSeconds)
      }

      sample.previousPosition.copy(currentPosition)
      sample.initialized = true
    }
  }

  getVelocity(controller: THREE.XRTargetRaySpace, target = new THREE.Vector3()) {
    return target.copy(this.samples.get(controller)?.velocity ?? ZERO_VECTOR)
  }
}
