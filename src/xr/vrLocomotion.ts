import * as THREE from 'three'

import { createLocomotionIntent } from '../app/locomotionIntent'
import { getForwardDirection } from '../app/forwardDirection'
import { HandClutchDebugView } from '../objects/handClutchDebug'
import type { PlayerTraversalMode } from '../app/playerTraversal'
import { inertialOrientationToRotating, rotatingOrientationToInertial } from '../sim/frameTransforms'
import {
  applyRotationAxisProfile,
  createGroundedClutchIntent,
  createHandClutchSample,
  createHandClutchState,
  createRotationClutchIntent,
  rebaseHandClutchState,
  resolveGroundedClutchIntent,
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
import {
  SIM_PROFILE,
  type LocomotionProfile
} from './locomotionProfile'
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
const viewForward = new THREE.Vector3()
const viewRight = new THREE.Vector3()
const stickMove = new THREE.Vector3()
const viewWorldQuaternion = new THREE.Quaternion()
const intent = createLocomotionIntent()
const groundedClutchIntent = createGroundedClutchIntent()
const clutchSample = createHandClutchSample()
const clutchRotationIntent = createRotationClutchIntent()
const freeFlyThrust = new THREE.Vector3()
const FACE_BUTTON_THRESHOLD = 0.55
const CLUTCH_THRESHOLD = 0.05
const ATTACHED_YAW_SPEED = Math.PI * 0.6

export class VRLocomotion {
  private readonly inputSourceByController = new Map<THREE.XRTargetRaySpace, XRInputSource>()
  private readonly gripByController = new Map<THREE.XRTargetRaySpace, THREE.XRGripSpace>()
  private readonly snapTurnState = createSnapTurnState()
  private readonly freeFlyAttitude = createJetpackOrientationState()
  private readonly clutchState = createHandClutchState()
  private readonly freeFlyInertialOrientation = new THREE.Quaternion()
  readonly clutchDebug = new HandClutchDebugView()
  private previousPlayerMode: PlayerTraversalMode = 'grounded'
  private snapYaw = 0
  private profile: LocomotionProfile = SIM_PROFILE

  setProfile(profile: LocomotionProfile) {
    this.profile = profile
  }

  // Reset the view to the rig's forward (snap yaw 0) — the VR counterpart of
  // the desktop look reset, so climbing into the car faces the hood instead of
  // whatever way you had snap-turned while walking.
  faceForward() {
    this.snapYaw = 0
  }

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
    omega: number,
    driving = false
  ) {
    intent.groundedAxis = 0
    intent.groundedTangent = 0
    intent.freeFlyThrust.set(0, 0, 0)
    intent.freeFlyBrake = 0
    intent.detachRequested = false
    intent.detachLaunchVelocity.set(0, 0, 0)

    if (xrActive && driving) {
      // At the wheel: the LEFT stick throttles/steers the car (read by
      // XRInputMap), so here we leave the RIGHT stick doing its on-foot job —
      // snap-turning the view — and emit no walking locomotion. The snap yaw
      // rides on top of the car's heading, letting you look around while driving.
      resetHandClutchState(this.clutchState)
      let snapAxisX = 0
      let snapAxisMagnitudeSq = 0

      for (const [, inputSource] of this.inputSourceByController) {
        const gamepad = inputSource.gamepad

        if (gamepad === null || gamepad === undefined || inputSource.handedness !== 'right') {
          continue
        }

        const [axisX, axisY] = this.readPrimaryStick(gamepad)
        const stickMagnitudeSq = axisX * axisX + axisY * axisY

        if (stickMagnitudeSq > snapAxisMagnitudeSq) {
          snapAxisMagnitudeSq = stickMagnitudeSq
          snapAxisX = axisX
        }
      }

      const snapIntent = consumeSnapTurn(snapAxisX, this.snapTurnState)
      if (snapIntent !== 0) {
        this.snapYaw -= snapIntent * SNAP_TURN_RADIANS
      }

      this.applyGroundedView()
      this.previousPlayerMode = playerMode
      this.clutchDebug.update(null, 'grounded')
      return intent
    }

    if (!xrActive) {
      resetJetpackAttitude(this.freeFlyAttitude)
      resetHandClutchState(this.clutchState)
      this.freeFlyInertialOrientation.identity()
      this.previousPlayerMode = 'grounded'
      this.applyGroundedView()
      this.clutchDebug.update(null, 'grounded')
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
    let leftStickX = 0
    let leftStickY = 0
    let leftStickMagnitudeSq = 0
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
        playerMode === 'grounded' &&
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

      if (stickMagnitudeSq > leftStickMagnitudeSq) {
        leftStickMagnitudeSq = stickMagnitudeSq
        leftStickX = axisX
        leftStickY = axisY
      }
    }

    if (modeChanged) {
      if (leftClutchActive && leftGripObject !== null) {
        this.rebaseLeftGripClutch(leftGripObject, playerMode)
      } else {
        resetHandClutchState(this.clutchState)
      }
    }

    const snapIntent = playerMode === 'grounded'
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
    this.applyLeftStickMovement(leftStickX, leftStickY, playerMode)

    if (playerMode === 'free-fly') {
      if (clutchInput !== null) {
        resolveRotationClutchIntent(
          clutchInput,
          this.profile.rotation,
          clutchRotationIntent
        )
        clutchRotationIntent.roll = applyRotationAxisProfile(
          clutchRotationIntent.roll,
          this.profile.rollDeadzone,
          this.profile.rollGain
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
        leftAngularBrake,
        this.profile.angularAcceleration,
        this.profile.comfortDeadzone
      )
      integrateJetpackAttitudeOrientation(this.freeFlyInertialOrientation, this.freeFlyAttitude, deltaSeconds)
      this.applyFreeFlyAttitude(frameAngle)
      this.previousPlayerMode = playerMode
      intent.freeFlyBrake = leftLinearBrake ? 1 : 0

      if (clutchInput !== null) {
        intent.freeFlyThrust.copy(
          resolveFreeFlyClutchThrust(
            clutchInput,
            this.profile.freeFly,
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
    this.applyGroundedView()
    this.previousPlayerMode = playerMode

    if (clutchInput !== null) {
      resolveGroundedClutchIntent(
        clutchInput,
        this.profile.grounded,
        groundedClutchIntent
      )
      resolveRotationClutchIntent(
        clutchInput,
        this.profile.rotation,
        clutchRotationIntent
      )
      intent.groundedAxis = groundedClutchIntent.axis
      intent.groundedTangent = groundedClutchIntent.tangent
      intent.detachRequested = groundedClutchIntent.detachRequested
      intent.detachLaunchVelocity.copy(groundedClutchIntent.detachLaunchVelocity)
      this.snapYaw += clutchRotationIntent.yaw * ATTACHED_YAW_SPEED * deltaSeconds
    } else {
      groundedClutchIntent.axis = 0
      groundedClutchIntent.tangent = 0
      groundedClutchIntent.lift = 0
      groundedClutchIntent.detachRequested = false
      groundedClutchIntent.detachLaunchVelocity.set(0, 0, 0)
      clutchRotationIntent.pitch = 0
      clutchRotationIntent.yaw = 0
      clutchRotationIntent.roll = 0
    }

    this.clutchDebug.update(clutchInput, 'grounded', {
      detachReady: groundedClutchIntent.detachRequested || groundedClutchIntent.lift >= 0.85,
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

  private applyLeftStickMovement(
    stickX: number,
    stickY: number,
    playerMode: PlayerTraversalMode
  ) {
    const deadzone = this.profile.stickDeadzone
    if (stickX * stickX + stickY * stickY < deadzone * deadzone) {
      return
    }

    const forwardInput = -stickY
    const rightInput = stickX
    this.viewRig.updateWorldMatrix(true, false)
    getForwardDirection(this.viewRig, viewForward)
    viewRight.set(1, 0, 0).applyQuaternion(this.viewRig.getWorldQuaternion(viewWorldQuaternion))
    stickMove
      .copy(viewForward)
      .multiplyScalar(forwardInput)
      .addScaledVector(viewRight, rightInput)

    if (stickMove.lengthSq() > 1) {
      stickMove.normalize()
    }

    if (playerMode === 'free-fly') {
      intent.freeFlyThrust.add(stickMove)
      return
    }

    // Cylinder axis is world Y; tangent is circumferential at the player's azimuth
    intent.groundedAxis += stickMove.y
    const px = this.playerRig.position.x
    const pz = this.playerRig.position.z
    const r = Math.hypot(px, pz)
    if (r > 0.001) {
      // tangent direction = (-sinθ, 0, cosθ) = (-pz/r, 0, px/r)
      intent.groundedTangent += (-pz * stickMove.x + px * stickMove.z) / r
    }
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

  private applyGroundedView() {
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
    if (playerMode === 'grounded') {
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
