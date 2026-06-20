import * as THREE from 'three'

import { createLocomotionIntent } from '../app/locomotionIntent'
import { getForwardDirection } from '../app/forwardDirection'
import { HandClutchDebugView } from '../objects/handClutchDebug'
import type { PlayerTraversalMode } from '../app/playerTraversal'
import { inertialOrientationToRotating, rotatingOrientationToInertial } from '../sim/frameTransforms'
import {
  createGroundedClutchIntent,
  createHandClutchSample,
  createHandClutchState,
  createRotationClutchIntent,
  rebaseHandClutchState,
  resolveGroundedClutchIntent,
  resolveRotationClutchIntent,
  resetHandClutchState,
  sampleHandClutch
} from './handClutchLocomotion'
import {
  createJetpackAttitudeState as createJetpackOrientationState,
  integrateJetpackAttitudeOrientation,
  resetJetpackAttitude,
  seedJetpackAttitudeFromWorldAngularVelocity
} from './freeFlyJetpack'
import type { XRControllerSpaces } from './grabSystem'
import {
  SIM_PROFILE,
  type LocomotionProfile
} from './locomotionProfile'
import { consumeSnapTurn, createSnapTurnState } from './snapTurn'
import { XR_BUTTON } from './controlScheme'

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
const viewUp = new THREE.Vector3()
const stickMove = new THREE.Vector3()
const viewWorldQuaternion = new THREE.Quaternion()
const intent = createLocomotionIntent()
const groundedClutchIntent = createGroundedClutchIntent()
const clutchSample = createHandClutchSample()
const clutchRotationIntent = createRotationClutchIntent()
const CLUTCH_THRESHOLD = 0.05
const ATTACHED_YAW_SPEED = Math.PI * 0.6
// Scheme C: A is "up" on BOTH hands. Held (level read, not the edge-detected
// jump in main.ts) it thrusts the jetpack "up" relative to the view, mirroring
// PC Space. The button index lives in controlScheme.ts (XR_BUTTON.A).
// Point-and-throttle: the analog LEFT TRIGGER is the jetpack throttle. Ignore
// rest jitter below the deadzone and reach full thrust a little before a hard
// pull, so cruising does not require bottoming the trigger out.
const THROTTLE_DEADZONE = 0.08
const THROTTLE_FULL = 0.9

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
  // Lift-launch take-off (raise the clutched hand to detach) is OFF by default;
  // jump (A on either hand) is the one obvious launch. Restorable via settings.
  private liftLaunchEnabled = false
  // Per-frame feedback surface for haptics/audio, read by main.ts after update().
  readonly feedback = {
    throttle: 0,
    brakeAmount: 0,
    snapped: false,
    modeChanged: false
  }

  setProfile(profile: LocomotionProfile) {
    this.profile = profile
  }

  setLiftLaunchEnabled(enabled: boolean) {
    this.liftLaunchEnabled = enabled
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
      this.setFeedback(0, 0, snapIntent !== 0, playerMode !== this.previousPlayerMode)
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
      this.setFeedback(0, 0, false, false)
      this.clutchDebug.update(null, 'grounded')
      return intent
    }

    const modeChanged = playerMode !== this.previousPlayerMode

    if (playerMode === 'free-fly' && this.previousPlayerMode !== 'free-fly') {
      this.captureFreeFlyInertialOrientation(frameAngle, omega)
    }

    let leftSqueezeValue = 0
    let leftClutchActive = false
    let leftGripObject: THREE.XRGripSpace | null = null
    let leftController: THREE.XRTargetRaySpace | null = null
    let leftTriggerValue = 0
    let leftStickX = 0
    let leftStickY = 0
    let leftStickMagnitudeSq = 0
    let snapAxisX = 0
    let snapAxisMagnitudeSq = 0
    let ascendHeld = false

    for (const [controller, inputSource] of this.inputSourceByController) {
      const gamepad = inputSource.gamepad

      if (gamepad === null || gamepad === undefined) {
        continue
      }

      const [axisX, axisY] = this.readPrimaryStick(gamepad)
      const stickMagnitudeSq = axisX * axisX + axisY * axisY

      // Right stick X arms snap turn, in grounded AND free-fly. (Driving snaps
      // in its own branch above.)
      if (
        inputSource.handedness === 'right' &&
        stickMagnitudeSq > snapAxisMagnitudeSq
      ) {
        snapAxisMagnitudeSq = stickMagnitudeSq
        snapAxisX = axisX
      }

      // A held on EITHER hand = jetpack ascend ("up" on both hands; consumed in
      // the free-fly branch below). The edge-detected jump lives in xrInputMap.
      ascendHeld ||= gamepad.buttons[XR_BUTTON.A]?.pressed ?? false

      if (inputSource.handedness !== 'left') {
        continue
      }

      leftController = controller
      leftGripObject = this.gripByController.get(controller) ?? null
      // Left grip squeeze (analog): clutch-climb on the ground, STOP in flight.
      const squeeze = this.readSqueezeValue(gamepad)
      leftSqueezeValue = Math.max(leftSqueezeValue, squeeze)
      leftClutchActive ||= squeeze > CLUTCH_THRESHOLD
      // Left trigger (analog) is the jetpack throttle. The left hand's
      // select/grab is blocked (shouldBlockSelectStart), so the trigger is free.
      leftTriggerValue = Math.max(leftTriggerValue, this.readTriggerValue(gamepad))

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

    const snapIntent = consumeSnapTurn(snapAxisX, this.snapTurnState)

    // Grounded snap rotates the yaw rig; free-fly snap rotates the jetpack
    // attitude itself (handled in the free-fly branch below).
    if (snapIntent !== 0 && playerMode !== 'free-fly') {
      this.snapYaw -= snapIntent * SNAP_TURN_RADIANS
    }

    // On the ground the left grip is the clutch (climb/pull). In flight it is the
    // STOP brake instead, so we do not sample the clutch there.
    const clutchInput =
      playerMode === 'grounded'
        ? this.sampleLeftGripClutch(leftClutchActive, leftGripObject, playerMode, deltaSeconds)
        : null
    this.applyLeftStickMovement(leftStickX, leftStickY, playerMode)

    if (playerMode === 'free-fly') {
      // Point-and-throttle flight. No hand-tilt steering (it coupled thrust to
      // rotation and never settled). Turn with discrete snap; keep the
      // spin-seeded attitude integration so the view stays stable in the
      // rotating habitat and the horizon stays level — no roll, no pitch drift.
      if (snapIntent !== 0) {
        // Intrinsic yaw about the body's own up axis, the same axis the old
        // hand-yaw drove, applied as one discrete step.
        yawQuaternion.setFromAxisAngle(localUp, -snapIntent * SNAP_TURN_RADIANS)
        this.freeFlyInertialOrientation.multiply(yawQuaternion).normalize()
      }
      integrateJetpackAttitudeOrientation(
        this.freeFlyInertialOrientation,
        this.freeFlyAttitude,
        deltaSeconds
      )
      this.applyFreeFlyAttitude(frameAngle)
      this.previousPlayerMode = playerMode
      // Left grip = STOP: an analog brake on linear drift only. We deliberately
      // do NOT damp the seeded spin (omega) — keeping it holds the colony stable
      // in view; killing it would make the colony whirl and is more nauseating.
      intent.freeFlyBrake = leftSqueezeValue

      // Thrust along the LEFT controller's pointing ray, scaled by the analog
      // left trigger (throttle). Release the trigger and thrust stops at once —
      // no hidden anchor to return to. Adds to any left-stick thrust.
      const throttle = this.normalizeThrottle(leftTriggerValue)
      if (leftController !== null && throttle > 0) {
        leftController.updateWorldMatrix(true, false)
        getForwardDirection(leftController, viewForward)
        intent.freeFlyThrust.addScaledVector(viewForward, throttle)
      }

      // Right A held thrusts "up" relative to the view, mirroring PC Space.
      // mergeLocomotionIntent renormalises the sum, so the combined magnitude
      // never exceeds full jetpack acceleration.
      if (ascendHeld) {
        this.camera.updateWorldMatrix(true, false)
        viewUp
          .set(0, 1, 0)
          .applyQuaternion(this.camera.getWorldQuaternion(viewWorldQuaternion))
        intent.freeFlyThrust.add(viewUp)
      }

      this.setFeedback(throttle, leftSqueezeValue, snapIntent !== 0, modeChanged)
      this.clutchDebug.update(null, 'free-fly', {
        linearBrake: leftSqueezeValue > CLUTCH_THRESHOLD
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
      // Lift-launch take-off is gated off by default; jump (A) is the launch.
      intent.detachRequested = this.liftLaunchEnabled && groundedClutchIntent.detachRequested
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

    this.setFeedback(0, 0, snapIntent !== 0, modeChanged)
    this.clutchDebug.update(clutchInput, 'grounded', {
      detachReady:
        this.liftLaunchEnabled &&
        (groundedClutchIntent.detachRequested || groundedClutchIntent.lift >= 0.85)
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

  private readTriggerValue(gamepad: Gamepad) {
    const trigger = gamepad.buttons[0]

    if (trigger === undefined) {
      return 0
    }

    return trigger.value ?? (trigger.pressed ? 1 : 0)
  }

  // Analog left trigger (0..1) -> jetpack throttle (0..1) with a rest deadzone.
  private normalizeThrottle(triggerValue: number) {
    if (triggerValue <= THROTTLE_DEADZONE) {
      return 0
    }

    return THREE.MathUtils.clamp(
      (triggerValue - THROTTLE_DEADZONE) / (THROTTLE_FULL - THROTTLE_DEADZONE),
      0,
      1
    )
  }

  private setFeedback(
    throttle: number,
    brakeAmount: number,
    snapped: boolean,
    modeChanged: boolean
  ) {
    this.feedback.throttle = throttle
    this.feedback.brakeAmount = brakeAmount
    this.feedback.snapped = snapped
    this.feedback.modeChanged = modeChanged
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
    // Move where you LOOK: the basis is the head (camera), not the snap-turn rig.
    // So after a physical turn or a snap-turn the stick still drives you in your
    // current view direction, the same head-relative feel as the desktop WASD.
    this.camera.updateWorldMatrix(true, false)
    getForwardDirection(this.camera, viewForward)
    viewRight.set(1, 0, 0).applyQuaternion(this.camera.getWorldQuaternion(viewWorldQuaternion))
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
