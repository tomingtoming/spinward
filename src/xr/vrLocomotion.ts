import * as THREE from 'three'

import { createLocomotionIntent } from '../app/locomotionIntent'
import { HandClutchDebugView } from '../objects/handClutchDebug'
import type { PlayerTraversalMode } from '../app/playerTraversal'
import { inertialOrientationToRotating, rotatingOrientationToInertial } from '../sim/frameTransforms'
import {
  applyRotationAxisProfile,
  DEFAULT_ATTACHED_CLUTCH_CONFIG,
  DEFAULT_FREE_FLY_CLUTCH_CONFIG,
  DEFAULT_ROTATION_CLUTCH_CONFIG,
  createAttachedClutchIntent,
  createHandClutchSample,
  createHandClutchState,
  createRotationClutchIntent,
  rebaseHandClutchState,
  resolveAttachedClutchIntent,
  resolveFreeFlyClutchThrust,
  resolveRotationClutchIntent,
  resetHandClutchState,
  sampleHandClutch
} from './handClutchLocomotion'
import {
  createJetpackAttitudeState as createJetpackOrientationState,
  integrateJetpackAttitudeOrientation,
  resetJetpackAttitude,
  seedJetpackAttitudeFromWorldAngularVelocity,
  stepJetpackAttitudeAxes
} from './freeFlyJetpack'
import type { XRControllerSpaces } from './grabSystem'
import { consumeSnapTurn, createSnapTurnState } from './snapTurn'

const SNAP_TURN_RADIANS = Math.PI / 6
const localUp = new THREE.Vector3(0, 1, 0)
const controlFrameQuaternion = new THREE.Quaternion()
const controlFramePosition = new THREE.Vector3()
const gripWorldPosition = new THREE.Vector3()
const gripWorldQuaternion = new THREE.Quaternion()
const playerRigWorldQuaternion = new THREE.Quaternion()
const yawQuaternion = new THREE.Quaternion()
const desiredWorldOrientation = new THREE.Quaternion()
const worldAngularVelocity = new THREE.Vector3()
const intent = createLocomotionIntent()
const attachedClutchIntent = createAttachedClutchIntent()
const clutchSample = createHandClutchSample()
const clutchRotationIntent = createRotationClutchIntent()
const freeFlyThrust = new THREE.Vector3()
const FACE_BUTTON_THRESHOLD = 0.55
const CLUTCH_THRESHOLD = 0.05
const ATTACHED_YAW_SPEED = Math.PI * 0.6
const FREE_FLY_ROLL_DEADZONE = 0.24
const FREE_FLY_ROLL_GAIN = 0.55

export class VRLocomotion {
  private readonly inputSourceByController = new Map<THREE.XRTargetRaySpace, XRInputSource>()
  private readonly gripByController = new Map<THREE.XRTargetRaySpace, THREE.XRGripSpace>()
  private readonly snapTurnState = createSnapTurnState()
  private readonly freeFlyAttitude = createJetpackOrientationState()
  private readonly clutchState = createHandClutchState()
  private readonly freeFlyInertialOrientation = new THREE.Quaternion()
  readonly clutchDebug = new HandClutchDebugView()
  private previousPlayerMode: PlayerTraversalMode = 'attached'
  private snapYaw = 0

  constructor(
    controllers: XRControllerSpaces[],
    private readonly playerRig: THREE.Group,
    private readonly viewRig: THREE.Group,
    _camera: THREE.PerspectiveCamera
  ) {
    this.viewRig.rotation.order = 'YXZ'

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

  update(
    deltaSeconds: number,
    xrActive: boolean,
    playerMode: PlayerTraversalMode,
    frameAngle: number,
    omega: number
  ) {
    intent.attachedAxis = 0
    intent.attachedTangent = 0
    intent.freeFlyThrust.set(0, 0, 0)
    intent.freeFlyBrake = 0
    intent.detachRequested = false
    intent.detachLaunchVelocity.set(0, 0, 0)

    if (!xrActive) {
      resetJetpackAttitude(this.freeFlyAttitude)
      resetHandClutchState(this.clutchState)
      this.freeFlyInertialOrientation.identity()
      this.previousPlayerMode = 'attached'
      this.applyAttachedView()
      this.clutchDebug.update(null, 'attached')
      return intent
    }

    const modeChanged = playerMode !== this.previousPlayerMode

    if (playerMode === 'free-fly' && this.previousPlayerMode !== 'free-fly') {
      this.captureFreeFlyInertialOrientation(frameAngle, omega)
    }

    let leftAngularBrake = false
    let leftLinearBrake = false
    let leftClutchActive = false
    let leftGripObject: THREE.XRGripSpace | null = null
    let snapAxisX = 0
    let snapAxisMagnitudeSq = 0

    for (const [controller, inputSource] of this.inputSourceByController) {
      const gamepad = inputSource.gamepad

      if (gamepad === null || gamepad === undefined) {
        continue
      }

      const [axisX, axisY] = this.readPrimaryStick(gamepad)
      const stickMagnitudeSq = axisX * axisX + axisY * axisY

      if (
        playerMode === 'attached' &&
        inputSource.handedness === 'right' &&
        stickMagnitudeSq > snapAxisMagnitudeSq
      ) {
        snapAxisMagnitudeSq = stickMagnitudeSq
        snapAxisX = axisX
      }

      if (inputSource.handedness !== 'left') {
        continue
      }

      leftGripObject = this.gripByController.get(controller) ?? null
      leftClutchActive ||= this.readSqueezeValue(gamepad) > CLUTCH_THRESHOLD
      leftAngularBrake ||= this.readFaceButton(gamepad, 4) > FACE_BUTTON_THRESHOLD
      leftLinearBrake ||= this.readFaceButton(gamepad, 5) > FACE_BUTTON_THRESHOLD
    }

    if (modeChanged) {
      if (leftClutchActive && leftGripObject !== null) {
        this.rebaseLeftGripClutch(leftGripObject, playerMode)
      } else {
        resetHandClutchState(this.clutchState)
      }
    }

    const snapIntent = playerMode === 'attached'
      ? consumeSnapTurn(snapAxisX, this.snapTurnState)
      : 0

    if (snapIntent !== 0) {
      this.snapYaw -= snapIntent * SNAP_TURN_RADIANS
    }

    const clutchInput = this.sampleLeftGripClutch(
      leftClutchActive,
      leftGripObject,
      playerMode,
      deltaSeconds
    )

    if (playerMode === 'free-fly') {
      if (clutchInput !== null) {
        resolveRotationClutchIntent(
          clutchInput,
          DEFAULT_ROTATION_CLUTCH_CONFIG,
          clutchRotationIntent
        )
        clutchRotationIntent.roll = applyRotationAxisProfile(
          clutchRotationIntent.roll,
          FREE_FLY_ROLL_DEADZONE,
          FREE_FLY_ROLL_GAIN
        )
      } else {
        clutchRotationIntent.pitch = 0
        clutchRotationIntent.yaw = 0
        clutchRotationIntent.roll = 0
      }

      stepJetpackAttitudeAxes(
        this.freeFlyAttitude,
        clutchRotationIntent.pitch,
        clutchRotationIntent.yaw,
        clutchRotationIntent.roll,
        deltaSeconds,
        leftAngularBrake
      )
      integrateJetpackAttitudeOrientation(this.freeFlyInertialOrientation, this.freeFlyAttitude, deltaSeconds)
      this.applyFreeFlyAttitude(frameAngle)
      this.previousPlayerMode = playerMode
      intent.freeFlyBrake = leftLinearBrake ? 1 : 0

      if (clutchInput !== null) {
        intent.freeFlyThrust.copy(
          resolveFreeFlyClutchThrust(
            clutchInput,
            DEFAULT_FREE_FLY_CLUTCH_CONFIG,
            freeFlyThrust
          )
        )
      }

      this.clutchDebug.update(clutchInput, 'free-fly', {
        linearBrake: leftLinearBrake,
        angularBrake: leftAngularBrake
      })
      return intent
    }

    resetJetpackAttitude(this.freeFlyAttitude)
    this.applyAttachedView()
    this.previousPlayerMode = playerMode

    if (clutchInput !== null) {
      resolveAttachedClutchIntent(
        clutchInput,
        DEFAULT_ATTACHED_CLUTCH_CONFIG,
        attachedClutchIntent
      )
      resolveRotationClutchIntent(
        clutchInput,
        DEFAULT_ROTATION_CLUTCH_CONFIG,
        clutchRotationIntent
      )
      intent.attachedAxis = attachedClutchIntent.axis
      intent.attachedTangent = attachedClutchIntent.tangent
      intent.detachRequested = attachedClutchIntent.detachRequested
      intent.detachLaunchVelocity.copy(attachedClutchIntent.detachLaunchVelocity)
      this.snapYaw += clutchRotationIntent.yaw * ATTACHED_YAW_SPEED * deltaSeconds
    } else {
      attachedClutchIntent.axis = 0
      attachedClutchIntent.tangent = 0
      attachedClutchIntent.lift = 0
      attachedClutchIntent.detachRequested = false
      attachedClutchIntent.detachLaunchVelocity.set(0, 0, 0)
      clutchRotationIntent.pitch = 0
      clutchRotationIntent.yaw = 0
      clutchRotationIntent.roll = 0
    }

    this.clutchDebug.update(clutchInput, 'attached', {
      detachReady: attachedClutchIntent.detachRequested || attachedClutchIntent.lift >= 0.85,
      linearBrake: leftLinearBrake,
      angularBrake: leftAngularBrake
    })
    return intent
  }

  private readPrimaryStick(gamepad: Gamepad) {
    const firstPair = [gamepad.axes[0] ?? 0, gamepad.axes[1] ?? 0] as const
    const secondPair = [gamepad.axes[2] ?? 0, gamepad.axes[3] ?? 0] as const

    const firstMagnitudeSq = firstPair[0] * firstPair[0] + firstPair[1] * firstPair[1]
    const secondMagnitudeSq = secondPair[0] * secondPair[0] + secondPair[1] * secondPair[1]

    return secondMagnitudeSq > firstMagnitudeSq ? secondPair : firstPair
  }

  private readSqueezeValue(gamepad: Gamepad) {
    const squeeze = gamepad.buttons[1]

    if (squeeze === undefined) {
      return 0
    }

    return squeeze.value ?? (squeeze.pressed ? 1 : 0)
  }

  private readFaceButton(gamepad: Gamepad, index: number) {
    const button = gamepad.buttons[index]

    if (button === undefined) {
      return 0
    }

    return button.value ?? (button.pressed ? 1 : 0)
  }

  private applyFreeFlyAttitude(frameAngle: number) {
    inertialOrientationToRotating(
      this.freeFlyInertialOrientation,
      frameAngle,
      desiredWorldOrientation
    )
    this.playerRig.getWorldQuaternion(playerRigWorldQuaternion)
    this.viewRig.quaternion.copy(playerRigWorldQuaternion.invert()).multiply(desiredWorldOrientation)
  }

  private applyAttachedView() {
    yawQuaternion.setFromAxisAngle(localUp, this.snapYaw)
    this.viewRig.quaternion.copy(yawQuaternion)
  }

  private captureFreeFlyInertialOrientation(frameAngle: number, omega: number) {
    this.viewRig.updateWorldMatrix(true, false)
    rotatingOrientationToInertial(
      this.viewRig.getWorldQuaternion(desiredWorldOrientation),
      frameAngle,
      this.freeFlyInertialOrientation
    )
    seedJetpackAttitudeFromWorldAngularVelocity(
      this.freeFlyAttitude,
      this.freeFlyInertialOrientation,
      worldAngularVelocity.set(0, omega, 0)
    )
  }

  private sampleLeftGripClutch(
    clutchActive: boolean,
    leftGrip: THREE.XRGripSpace | null,
    playerMode: PlayerTraversalMode,
    deltaSeconds: number
  ) {
    if (!clutchActive || leftGrip === null) {
      const inactiveSample = sampleHandClutch(
        this.clutchState,
        false,
        null,
        null,
        null,
        null,
        deltaSeconds,
        clutchSample
      )
      return inactiveSample.active ? inactiveSample : null
    }

    leftGrip.updateWorldMatrix(true, false)
    leftGrip.getWorldPosition(gripWorldPosition)
    leftGrip.getWorldQuaternion(gripWorldQuaternion)
    this.resolveControlFrame(playerMode)

    const sample = sampleHandClutch(
      this.clutchState,
      true,
      gripWorldPosition,
      gripWorldQuaternion,
      controlFramePosition,
      controlFrameQuaternion,
      deltaSeconds,
      clutchSample
    )
    return sample.active ? sample : null
  }

  private rebaseLeftGripClutch(
    leftGrip: THREE.XRGripSpace,
    playerMode: PlayerTraversalMode
  ) {
    leftGrip.updateWorldMatrix(true, false)
    leftGrip.getWorldPosition(gripWorldPosition)
    leftGrip.getWorldQuaternion(gripWorldQuaternion)
    this.resolveControlFrame(playerMode)
    rebaseHandClutchState(
      this.clutchState,
      gripWorldPosition,
      gripWorldQuaternion,
      controlFramePosition,
      controlFrameQuaternion
    )
  }

  private resolveControlFrame(playerMode: PlayerTraversalMode) {
    if (playerMode === 'attached') {
      this.playerRig.updateWorldMatrix(true, false)
      this.playerRig.getWorldPosition(controlFramePosition)
      this.playerRig.getWorldQuaternion(controlFrameQuaternion)
      return
    }

    this.viewRig.updateWorldMatrix(true, false)
    this.viewRig.getWorldPosition(controlFramePosition)
    this.viewRig.getWorldQuaternion(controlFrameQuaternion)
  }
}
