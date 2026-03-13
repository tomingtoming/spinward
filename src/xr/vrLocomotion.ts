import * as THREE from 'three'

import { moveSurfaceRigState, applySurfaceRigState, type SurfaceRigState } from '../app/surfaceRig'

const MOVE_SPEED = 4.5
const DEADZONE = 0.18
const headForward = new THREE.Vector3()
const headRight = new THREE.Vector3()
const localMove = new THREE.Vector3()
const localUp = new THREE.Vector3(0, 1, 0)

export class VRLocomotion {
  private readonly inputSourceByController = new Map<THREE.XRTargetRaySpace, XRInputSource>()

  constructor(
    controllers: THREE.XRTargetRaySpace[],
    private readonly playerRig: THREE.Group,
    private readonly camera: THREE.PerspectiveCamera,
    private readonly surfaceState: SurfaceRigState
  ) {
    for (const controller of controllers) {
      controller.addEventListener('connected', (event) => {
        this.inputSourceByController.set(controller, event.data)
      })
      controller.addEventListener('disconnected', () => {
        this.inputSourceByController.delete(controller)
      })
    }
  }

  update(deltaSeconds: number, xrActive: boolean, radius: number, length: number) {
    if (!xrActive) {
      return
    }

    localMove.set(0, 0, 0)

    for (const inputSource of this.inputSourceByController.values()) {
      const gamepad = inputSource.gamepad

      if (gamepad === null || gamepad === undefined) {
        continue
      }

      const [axisX, axisY] = this.readPrimaryStick(gamepad)

      if (Math.abs(axisX) < DEADZONE && Math.abs(axisY) < DEADZONE) {
        continue
      }

      headForward.set(0, 0, -1).applyQuaternion(this.camera.quaternion)
      headForward.y = 0

      if (headForward.lengthSq() < 1e-6) {
        headForward.set(0, 0, -1)
      } else {
        headForward.normalize()
      }

      headRight.copy(headForward).cross(localUp).normalize()
      localMove
        .addScaledVector(headForward, -axisY)
        .addScaledVector(headRight, axisX)
    }

    if (localMove.lengthSq() < 1e-6) {
      return
    }

    if (localMove.lengthSq() > 1) {
      localMove.normalize()
    }

    const distance = MOVE_SPEED * deltaSeconds
    moveSurfaceRigState(
      this.surfaceState,
      localMove.x * distance,
      localMove.z * distance,
      radius,
      length
    )
    applySurfaceRigState(this.playerRig, this.surfaceState, radius)
  }

  private readPrimaryStick(gamepad: Gamepad) {
    const firstPair = [gamepad.axes[0] ?? 0, gamepad.axes[1] ?? 0] as const
    const secondPair = [gamepad.axes[2] ?? 0, gamepad.axes[3] ?? 0] as const

    const firstMagnitudeSq = firstPair[0] * firstPair[0] + firstPair[1] * firstPair[1]
    const secondMagnitudeSq = secondPair[0] * secondPair[0] + secondPair[1] * secondPair[1]

    return secondMagnitudeSq > firstMagnitudeSq ? secondPair : firstPair
  }
}
