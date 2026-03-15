import * as THREE from 'three'

import { getForwardDirection } from '../app/forwardDirection'
import { createLocomotionIntent } from '../app/locomotionIntent'
import type { PlayerTraversalMode } from '../app/playerTraversal'
import { inertialOrientationToRotating, rotatingOrientationToInertial } from '../sim/frameTransforms'
import {
  createJetpackAttitudeState,
  getJetpackThrustDirection,
  integrateJetpackAttitudeOrientation,
  resetJetpackAttitude,
  seedJetpackAttitudeFromWorldAngularVelocity,
  stepJetpackAttitude
} from './freeFlyJetpack'
import type { XRControllerSpaces } from './grabSystem'
import { consumeSnapTurn, createSnapTurnState } from './snapTurn'

const DEADZONE = 0.18
const SNAP_TURN_RADIANS = Math.PI / 6
const headForward = new THREE.Vector3()
const headRight = new THREE.Vector3()
const attachedMove = new THREE.Vector3()
const freeFlyForward = new THREE.Vector3()
const localUp = new THREE.Vector3(0, 1, 0)
const inverseRigQuaternion = new THREE.Quaternion()
const playerRigWorldQuaternion = new THREE.Quaternion()
const yawQuaternion = new THREE.Quaternion()
const desiredWorldOrientation = new THREE.Quaternion()
const worldAngularVelocity = new THREE.Vector3()
const intent = createLocomotionIntent()
const DETACH_LAUNCH_SPEED = 6

export class VRLocomotion {
  private readonly inputSourceByController = new Map<THREE.XRTargetRaySpace, XRInputSource>()
  private readonly gripByController = new Map<THREE.XRTargetRaySpace, THREE.XRGripSpace>()
  private readonly snapTurnState = createSnapTurnState()
  private readonly freeFlyAttitude = createJetpackAttitudeState()
  private readonly freeFlyInertialOrientation = new THREE.Quaternion()
  private previousPlayerMode: PlayerTraversalMode = 'attached'
  private snapYaw = 0

  constructor(
    controllers: XRControllerSpaces[],
    private readonly playerRig: THREE.Group,
    private readonly viewRig: THREE.Group,
    private readonly camera: THREE.PerspectiveCamera
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
      this.freeFlyInertialOrientation.identity()
      this.previousPlayerMode = 'attached'
      this.applyAttachedView()
      return intent
    }

    if (playerMode === 'free-fly' && this.previousPlayerMode !== 'free-fly') {
      this.captureFreeFlyInertialOrientation(frameAngle, omega)
    }

    let moveAxisX = 0
    let moveAxisY = 0
    let leftRollAxis = 0
    let leftPitchAxis = 0
    let leftAngularBrake = false
    let leftLinearBrake = false
    let leftSqueeze = 0
    let leftTrigger = 0
    let leftGrip: THREE.XRGripSpace | null = null
    let snapAxisX = 0
    let snapAxisMagnitudeSq = 0

    for (const [controller, inputSource] of this.inputSourceByController) {
      const gamepad = inputSource.gamepad

      if (gamepad === null || gamepad === undefined) {
        continue
      }

      const [axisX, axisY] = this.readPrimaryStick(gamepad)
      const stickMagnitudeSq = axisX * axisX + axisY * axisY

      if (inputSource.handedness === 'right' && stickMagnitudeSq > snapAxisMagnitudeSq) {
        snapAxisMagnitudeSq = stickMagnitudeSq
        snapAxisX = axisX
      }

      if (inputSource.handedness !== 'left') {
        continue
      }

      leftGrip = this.gripByController.get(controller) ?? null
      leftTrigger = Math.max(leftTrigger, this.readTriggerValue(gamepad))
      leftSqueeze = Math.max(leftSqueeze, this.readSqueezeValue(gamepad))

      if (playerMode === 'attached') {
        if (Math.abs(axisX) < DEADZONE && Math.abs(axisY) < DEADZONE) {
          continue
        }

        moveAxisX += axisX
        moveAxisY += axisY
        continue
      }

      if (Math.abs(axisX) >= DEADZONE) {
        leftRollAxis = axisX
      }

      if (Math.abs(axisY) >= DEADZONE) {
        leftPitchAxis = axisY
      }

      leftLinearBrake ||= this.readThumbstickPress(gamepad)
      leftAngularBrake ||= leftSqueeze > 0.05
    }

    const snapIntent = consumeSnapTurn(snapAxisX, this.snapTurnState)

    if (snapIntent !== 0) {
      this.snapYaw -= snapIntent * SNAP_TURN_RADIANS

      if (playerMode === 'free-fly') {
        yawQuaternion.setFromAxisAngle(localUp, -snapIntent * SNAP_TURN_RADIANS)
        this.freeFlyInertialOrientation.multiply(yawQuaternion).normalize()
      }
    }

    if (playerMode === 'free-fly') {
      stepJetpackAttitude(
        this.freeFlyAttitude,
        leftRollAxis,
        leftPitchAxis,
        deltaSeconds,
        leftAngularBrake
      )
      integrateJetpackAttitudeOrientation(this.freeFlyInertialOrientation, this.freeFlyAttitude, deltaSeconds)
      this.applyFreeFlyAttitude(frameAngle)
      this.previousPlayerMode = playerMode
      intent.freeFlyBrake = leftLinearBrake ? 1 : 0

      if (leftGrip !== null && leftTrigger > 0.05) {
        leftGrip.updateWorldMatrix(true, false)
        getJetpackThrustDirection(leftGrip.getWorldQuaternion(new THREE.Quaternion()), freeFlyForward)
        intent.freeFlyThrust.copy(freeFlyForward).multiplyScalar(leftTrigger)
      }

      return intent
    }

    resetJetpackAttitude(this.freeFlyAttitude)
    this.applyAttachedView()
    this.previousPlayerMode = playerMode

    if (leftGrip !== null && leftTrigger > 0.05) {
      leftGrip.updateWorldMatrix(true, false)
      getJetpackThrustDirection(leftGrip.getWorldQuaternion(new THREE.Quaternion()), freeFlyForward)
      intent.detachRequested = true
      intent.detachLaunchVelocity.copy(freeFlyForward).multiplyScalar(leftTrigger * DETACH_LAUNCH_SPEED)
    }

    attachedMove.set(0, 0, 0)
    inverseRigQuaternion.copy(this.playerRig.getWorldQuaternion(new THREE.Quaternion())).invert()
    headForward.copy(getForwardDirection(this.camera)).applyQuaternion(inverseRigQuaternion)
    headForward.y = 0

    if (headForward.lengthSq() < 1e-6) {
      headForward.set(0, 0, -1)
    } else {
      headForward.normalize()
    }

    headRight.copy(headForward).cross(localUp).normalize()
    attachedMove
      .addScaledVector(headForward, -moveAxisY)
      .addScaledVector(headRight, moveAxisX)

    if (attachedMove.lengthSq() > 1) {
      attachedMove.normalize()
    }

    intent.attachedAxis = attachedMove.x
    intent.attachedTangent = attachedMove.z
    return intent
  }

  private readPrimaryStick(gamepad: Gamepad) {
    const firstPair = [gamepad.axes[0] ?? 0, gamepad.axes[1] ?? 0] as const
    const secondPair = [gamepad.axes[2] ?? 0, gamepad.axes[3] ?? 0] as const

    const firstMagnitudeSq = firstPair[0] * firstPair[0] + firstPair[1] * firstPair[1]
    const secondMagnitudeSq = secondPair[0] * secondPair[0] + secondPair[1] * secondPair[1]

    return secondMagnitudeSq > firstMagnitudeSq ? secondPair : firstPair
  }

  private readTriggerValue(gamepad: Gamepad) {
    const trigger = gamepad.buttons[0]

    if (trigger === undefined) {
      return 0
    }

    return trigger.value ?? (trigger.pressed ? 1 : 0)
  }

  private readSqueezeValue(gamepad: Gamepad) {
    const squeeze = gamepad.buttons[1]

    if (squeeze === undefined) {
      return 0
    }

    return squeeze.value ?? (squeeze.pressed ? 1 : 0)
  }

  private readThumbstickPress(gamepad: Gamepad) {
    // xr-standard commonly exposes thumbstick click at index 3, with index 2 used by some profiles.
    const thumbstick =
      gamepad.buttons[3] ??
      gamepad.buttons[2]

    if (thumbstick === undefined) {
      return false
    }

    return thumbstick.pressed || (thumbstick.value ?? 0) > 0.5
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
}
