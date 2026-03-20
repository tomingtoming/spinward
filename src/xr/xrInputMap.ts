import * as THREE from 'three'

import type { XRControllerSpaces } from './grabSystem'

type HoldToggleState = {
  heldSeconds: number
  fired: boolean
}

export const createHoldToggleState = (): HoldToggleState => ({
  heldSeconds: 0,
  fired: false
})

export const stepHoldToggleState = (
  state: HoldToggleState,
  pressed: boolean,
  deltaSeconds: number,
  thresholdSeconds: number
) => {
  if (!pressed) {
    state.heldSeconds = 0
    state.fired = false
    return false
  }

  state.heldSeconds += Math.max(0, deltaSeconds)

  if (!state.fired && state.heldSeconds >= thresholdSeconds) {
    state.fired = true
    return true
  }

  return false
}
const UI_TRIGGER_THRESHOLD = 0.55
type XrWatchInputFrame = {
  leftController: THREE.XRTargetRaySpace | null
  leftGrip: THREE.XRGripSpace | null
  rightController: THREE.XRTargetRaySpace | null
  rightTriggerPressed: boolean
}

export class XRInputMap {
  private readonly inputSourceByController = new Map<THREE.XRTargetRaySpace, XRInputSource>()
  private readonly gripByController = new Map<THREE.XRTargetRaySpace, THREE.XRGripSpace>()
  private previousRightTriggerPressed = false

  constructor(controllers: XRControllerSpaces[]) {
    for (const { controller, grip } of controllers) {
      this.gripByController.set(controller, grip)
      controller.addEventListener('connected', (event) => {
        this.inputSourceByController.set(controller, event.data)
      })
      controller.addEventListener('disconnected', () => {
        this.inputSourceByController.delete(controller)
      })
    }
  }

  getHandedness(controller: THREE.XRTargetRaySpace) {
    return this.inputSourceByController.get(controller)?.handedness ?? 'none'
  }

  update(_deltaSeconds: number, xrActive: boolean): XrWatchInputFrame {
    if (!xrActive) {
      this.previousRightTriggerPressed = false
      return {
        leftController: null,
        leftGrip: null,
        rightController: null,
        rightTriggerPressed: false
      }
    }

    let leftController: THREE.XRTargetRaySpace | null = null
    let leftGrip: THREE.XRGripSpace | null = null
    let rightController: THREE.XRTargetRaySpace | null = null
    let rightTriggerPressed = false

    for (const [controller, inputSource] of this.inputSourceByController) {
      const gamepad = inputSource.gamepad

      if (gamepad === null || gamepad === undefined) {
        continue
      }

      if (inputSource.handedness === 'left') {
        leftController = controller
        leftGrip = this.gripByController.get(controller) ?? null
        continue
      }

      if (inputSource.handedness === 'right') {
        rightController = controller
        rightTriggerPressed ||= this.readTriggerValue(gamepad) > UI_TRIGGER_THRESHOLD
      }
    }

    const rightTriggerEdge = rightTriggerPressed && !this.previousRightTriggerPressed
    this.previousRightTriggerPressed = rightTriggerPressed

    return {
      leftController,
      leftGrip,
      rightController,
      rightTriggerPressed: rightTriggerEdge
    }
  }

  private readTriggerValue(gamepad: Gamepad) {
    const trigger = gamepad.buttons[0]

    if (trigger === undefined) {
      return 0
    }

    return trigger.value ?? (trigger.pressed ? 1 : 0)
  }

}
