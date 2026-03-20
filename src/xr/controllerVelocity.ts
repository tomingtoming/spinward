import * as THREE from 'three'

const VELOCITY_BUFFER_SIZE = 6

type VelocityBuffer = {
  samples: THREE.Vector3[]
  cursor: number
  count: number
}

export const createVelocityBuffer = (
  size = VELOCITY_BUFFER_SIZE
): VelocityBuffer => ({
  samples: Array.from({ length: size }, () => new THREE.Vector3()),
  cursor: 0,
  count: 0
})

export const pushVelocityBuffer = (
  buffer: VelocityBuffer,
  velocity: THREE.Vector3
) => {
  buffer.samples[buffer.cursor].copy(velocity)
  buffer.cursor = (buffer.cursor + 1) % buffer.samples.length
  if (buffer.count < buffer.samples.length) {
    buffer.count += 1
  }
}

export const averageVelocityBuffer = (
  buffer: VelocityBuffer,
  target: THREE.Vector3
) => {
  target.set(0, 0, 0)
  if (buffer.count === 0) return target

  for (let i = 0; i < buffer.count; i++) {
    target.add(buffer.samples[i])
  }

  return target.divideScalar(buffer.count)
}

type ControllerSample = {
  previousLocalPosition: THREE.Vector3
  previousPosition: THREE.Vector3
  localVelocity: THREE.Vector3
  velocity: THREE.Vector3
  localVelocityBuffer: VelocityBuffer
  velocityBuffer: VelocityBuffer
  initialized: boolean
}

const ZERO_VECTOR = new THREE.Vector3()

export class ControllerVelocityTracker {
  private readonly samples = new Map<THREE.XRTargetRaySpace, ControllerSample>()

  registerController(controller: THREE.XRTargetRaySpace) {
    if (this.samples.has(controller)) {
      return
    }

    this.samples.set(controller, {
      previousLocalPosition: new THREE.Vector3(),
      previousPosition: new THREE.Vector3(),
      localVelocity: new THREE.Vector3(),
      velocity: new THREE.Vector3(),
      localVelocityBuffer: createVelocityBuffer(),
      velocityBuffer: createVelocityBuffer(),
      initialized: false
    })
  }

  update(deltaSeconds: number) {
    for (const [controller, sample] of this.samples) {
      const objectController = controller as unknown as THREE.Object3D

      controller.updateWorldMatrix(true, false)
      controller.getWorldPosition(sample.velocity)
      sample.localVelocity.copy(objectController.position)

      if (!sample.initialized || deltaSeconds <= 0) {
        sample.velocity.set(0, 0, 0)
        sample.localVelocity.set(0, 0, 0)
      } else {
        sample.velocity.sub(sample.previousPosition).divideScalar(deltaSeconds)
        sample.localVelocity.sub(sample.previousLocalPosition).divideScalar(deltaSeconds)
        pushVelocityBuffer(sample.velocityBuffer, sample.velocity)
        pushVelocityBuffer(sample.localVelocityBuffer, sample.localVelocity)
      }

      controller.getWorldPosition(sample.previousPosition)
      sample.previousLocalPosition.copy(objectController.position)
      sample.initialized = true
    }
  }

  getVelocity(controller: THREE.XRTargetRaySpace, target = new THREE.Vector3()) {
    const sample = this.samples.get(controller)
    if (sample === undefined) return target.copy(ZERO_VECTOR)
    return averageVelocityBuffer(sample.velocityBuffer, target)
  }

  getWorldVelocity(controller: THREE.XRTargetRaySpace, target = new THREE.Vector3()) {
    return this.getVelocity(controller, target)
  }

  getLocalVelocity(controller: THREE.XRTargetRaySpace, target = new THREE.Vector3()) {
    const sample = this.samples.get(controller)
    if (sample === undefined) return target.copy(ZERO_VECTOR)
    return averageVelocityBuffer(sample.localVelocityBuffer, target)
  }
}
