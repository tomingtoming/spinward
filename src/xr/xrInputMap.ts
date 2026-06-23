import * as THREE from 'three'

import type { XRControllerSpaces } from './grabSystem'
import { XR_BUTTON } from './controlScheme'

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
// Thumbstick rest jitter to ignore before it counts as a drive command.
const DRIVE_DEADZONE = 0.12

const applyDriveDeadzone = (value: number) =>
  Math.abs(value) < DRIVE_DEADZONE ? 0 : THREE.MathUtils.clamp(value, -1, 1)

// Maps a thumbstick + grip to car controls — the LEFT stick while driving, so
// the right stick stays free to turn the view like it does on foot. Pushing up
// (xr-standard Y is negative up) drives forward; X steers right-positive; the
// grip squeeze brakes. Pure so the sign/deadzone convention can be tested.
export const mapVrDriveInput = (
  stickX: number,
  stickY: number,
  gripBrake: number
) => ({
  throttle: applyDriveDeadzone(-stickY),
  steer: applyDriveDeadzone(stickX),
  brake: THREE.MathUtils.clamp(gripBrake, 0, 1)
})

type XrWatchInputFrame = {
  leftController: THREE.XRTargetRaySpace | null
  leftGrip: THREE.XRGripSpace | null
  rightController: THREE.XRTargetRaySpace | null
  rightTriggerPressed: boolean
  // A on EITHER hand: jump (grounded) / dismount (driving). "A = up" both hands.
  jumpPressed: boolean
  // Right B edge: cycle the Surface/Overlook/Axis warp without the wrist laser.
  travelCyclePressed: boolean
  // Right stick-click edge: cycle the selected throwable (ball/beam/firework).
  weaponCyclePressed: boolean
  // Left B edge: recenter the view (the "menu" family verb on the left hand).
  leftMenuPressed: boolean
  // VR car controls: left stick Y = throttle, left stick X = steer, either
  // grip squeeze = brake. Deadzoned/clamped, only meaningful while driving.
  driveThrottle: number
  driveSteer: number
  driveBrake: number
}

export class XRInputMap {
  private readonly inputSourceByController = new Map<THREE.XRTargetRaySpace, XRInputSource>()
  private readonly gripByController = new Map<THREE.XRTargetRaySpace, THREE.XRGripSpace>()
  private previousRightTriggerPressed = false
  private previousJumpPressed = false
  private previousTravelCyclePressed = false
  private previousWeaponCyclePressed = false
  private previousLeftMenuPressed = false

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
      this.previousJumpPressed = false
      this.previousTravelCyclePressed = false
      this.previousWeaponCyclePressed = false
      this.previousLeftMenuPressed = false
      return {
        leftController: null,
        leftGrip: null,
        rightController: null,
        rightTriggerPressed: false,
        jumpPressed: false,
        travelCyclePressed: false,
        weaponCyclePressed: false,
        leftMenuPressed: false,
        driveThrottle: 0,
        driveSteer: 0,
        driveBrake: 0
      }
    }

    let leftController: THREE.XRTargetRaySpace | null = null
    let leftGrip: THREE.XRGripSpace | null = null
    let rightController: THREE.XRTargetRaySpace | null = null
    let rightTriggerPressed = false
    let jumpPressed = false
    let travelCyclePressed = false
    let weaponCyclePressed = false
    let leftMenuPressed = false
    let leftStickX = 0
    let leftStickY = 0
    let driveBrake = 0

    for (const [controller, inputSource] of this.inputSourceByController) {
      const gamepad = inputSource.gamepad

      if (gamepad === null || gamepad === undefined) {
        continue
      }

      // Either grip squeeze brakes the car.
      driveBrake = Math.max(driveBrake, this.readGrip(gamepad))
      // A = "up" on BOTH hands: jump on foot, dismount while driving.
      jumpPressed ||= gamepad.buttons[XR_BUTTON.A]?.pressed ?? false

      if (inputSource.handedness === 'left') {
        leftController = controller
        leftGrip = this.gripByController.get(controller) ?? null
        // The left stick drives the car (throttle/steer); the right stick is
        // left to the locomotion turn, same as on foot.
        const [stickX, stickY] = this.readPrimaryStick(gamepad)
        leftStickX = stickX
        leftStickY = stickY
        // Left B = recenter (the "menu" verb on the left hand).
        leftMenuPressed ||= gamepad.buttons[XR_BUTTON.B]?.pressed ?? false
        continue
      }

      if (inputSource.handedness === 'right') {
        rightController = controller
        rightTriggerPressed ||= this.readTriggerValue(gamepad) > UI_TRIGGER_THRESHOLD
        // Right B = cycle the Surface/Overlook/Axis warp.
        travelCyclePressed ||= gamepad.buttons[XR_BUTTON.B]?.pressed ?? false
        // Right thumbstick click = cycle the selected throwable.
        weaponCyclePressed ||= gamepad.buttons[XR_BUTTON.stick]?.pressed ?? false
      }
    }

    const rightTriggerEdge = rightTriggerPressed && !this.previousRightTriggerPressed
    this.previousRightTriggerPressed = rightTriggerPressed
    const jumpEdge = jumpPressed && !this.previousJumpPressed
    this.previousJumpPressed = jumpPressed
    const travelCycleEdge = travelCyclePressed && !this.previousTravelCyclePressed
    this.previousTravelCyclePressed = travelCyclePressed
    const weaponCycleEdge = weaponCyclePressed && !this.previousWeaponCyclePressed
    this.previousWeaponCyclePressed = weaponCyclePressed
    const leftMenuEdge = leftMenuPressed && !this.previousLeftMenuPressed
    this.previousLeftMenuPressed = leftMenuPressed

    const drive = mapVrDriveInput(leftStickX, leftStickY, driveBrake)

    return {
      leftController,
      leftGrip,
      rightController,
      rightTriggerPressed: rightTriggerEdge,
      jumpPressed: jumpEdge,
      travelCyclePressed: travelCycleEdge,
      weaponCyclePressed: weaponCycleEdge,
      leftMenuPressed: leftMenuEdge,
      driveThrottle: drive.throttle,
      driveSteer: drive.steer,
      driveBrake: drive.brake
    }
  }

  // Quest controller haptics. navigator.vibrate is a no-op in the headset, so
  // throw / jump / land / crash feedback has to go through the gamepad's
  // haptic actuators instead.
  pulse(intensity: number, durationMs: number, hand: 'left' | 'right' | 'both' = 'both') {
    const amplitude = THREE.MathUtils.clamp(intensity, 0, 1)

    for (const inputSource of this.inputSourceByController.values()) {
      if (hand !== 'both' && inputSource.handedness !== hand) {
        continue
      }

      const gamepad = inputSource.gamepad

      if (gamepad === null || gamepad === undefined) {
        continue
      }

      // hapticActuators[].pulse is the WebXR shape Quest exposes; it is not in
      // the standard Gamepad lib types, so reach for it through a cast.
      const actuators = (
        gamepad as unknown as {
          hapticActuators?: ReadonlyArray<{ pulse?: (value: number, duration: number) => Promise<boolean> }>
        }
      ).hapticActuators

      void actuators?.[0]?.pulse?.(amplitude, durationMs)
    }
  }

  private readPrimaryStick(gamepad: Gamepad): readonly [number, number] {
    const firstPair = [gamepad.axes[0] ?? 0, gamepad.axes[1] ?? 0] as const
    const secondPair = [gamepad.axes[2] ?? 0, gamepad.axes[3] ?? 0] as const
    const firstSq = firstPair[0] * firstPair[0] + firstPair[1] * firstPair[1]
    const secondSq = secondPair[0] * secondPair[0] + secondPair[1] * secondPair[1]
    return secondSq > firstSq ? secondPair : firstPair
  }

  private readGrip(gamepad: Gamepad) {
    const grip = gamepad.buttons[XR_BUTTON.grip]

    if (grip === undefined) {
      return 0
    }

    return grip.value ?? (grip.pressed ? 1 : 0)
  }

  private readTriggerValue(gamepad: Gamepad) {
    const trigger = gamepad.buttons[XR_BUTTON.trigger]

    if (trigger === undefined) {
      return 0
    }

    return trigger.value ?? (trigger.pressed ? 1 : 0)
  }

}
