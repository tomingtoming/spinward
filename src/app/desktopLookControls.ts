import * as THREE from 'three'

import { getForwardDirection } from './forwardDirection'
import { introRevealDurationSeconds, introRevealPitch } from './introReveal'
import { createLocomotionIntent } from './locomotionIntent'
import {
  createJetpackAttitudeState,
  integrateJetpackAttitudeOrientation,
  resetJetpackAttitude,
  stepJetpackAttitudeAxes
} from '../xr/freeFlyJetpack'

const LOOK_SENSITIVITY = 0.003
const KEYBOARD_LOOK_SPEED = 1.4
const MAX_PITCH = Math.PI * 0.48
// Q/E roll is rate-based (KSP-style): holding a key spins up a roll rate that
// persists/coasts on release; B damps it back to rest. This is the build-up
// angular ACCELERATION (rad/s²) — gentle, so fine banking is easy.
const ROLL_ANGULAR_ACCEL = Math.PI * 0.4
// How fast the bank eases back to level once you stop free-flying.
const ROLL_LEVEL_RATE = 9

const groundedForward = new THREE.Vector3()
const groundedRight = new THREE.Vector3()
const groundedMove = new THREE.Vector3()
const freeFlyForward = new THREE.Vector3()
const freeFlyMove = new THREE.Vector3()
const freeFlyUp = new THREE.Vector3()
const cameraWorldQuaternion = new THREE.Quaternion()
const inverseRigQuaternion = new THREE.Quaternion()
const worldRight = new THREE.Vector3()
const detachLaunchVelocity = new THREE.Vector3()
const freeFlyDelta = new THREE.Quaternion()
const X_AXIS = new THREE.Vector3(1, 0, 0)
const Y_AXIS = new THREE.Vector3(0, 1, 0)
const Z_AXIS = new THREE.Vector3(0, 0, 1)
const intent = createLocomotionIntent()
const DETACH_LAUNCH_SPEED = 6
// How fast the inherited free-fly pitch eases back to level after landing.
const GROUNDING_PITCH_RATE = 8

// Scratch for decomposing the free-fly attitude into the grounded surface frame
// on landing (so the heading is kept and the tilt eases upright, not snapped).
const groundUp = new THREE.Vector3()
const groundTangent = new THREE.Vector3()
const groundBasis = new THREE.Matrix4()
const groundRigQuaternion = new THREE.Quaternion()
const landingCameraQuaternion = new THREE.Quaternion()
const landingEuler = new THREE.Euler(0, 0, 0, 'YXZ')

export class DesktopLookControls {
  private yaw = 0
  private pitch = 0
  private roll = 0
  // Free-fly uses a full quaternion attitude (no pitch clamp, no gimbal lock —
  // look straight up, loop, fly inverted). Grounded stays on the clamped Euler
  // above. We seed/recover between the two on mode changes.
  private readonly attitude = new THREE.Quaternion()
  // Q/E roll accumulates a roll rate here (only the z component is used) and
  // integrates into `attitude`, so the bank persists after the key is released.
  private readonly rollAttitude = createJetpackAttitudeState()
  private freeFlyActive = false
  private wasFreeFly = false
  private dragging = false
  // True while easing the inherited free-fly pitch back to level after a landing.
  private standingUp = false
  private readonly pressedKeys = new Set<string>()
  // One-shot boot "look up" reveal; null when idle or cancelled.
  private introElapsed: number | null = null

  constructor(
    private readonly playerRig: THREE.Group,
    private readonly camera: THREE.PerspectiveCamera,
    private readonly element: HTMLElement
  ) {
    this.camera.rotation.order = 'YXZ'

    this.element.addEventListener('contextmenu', this.handleContextMenu)
    this.element.addEventListener('pointerdown', this.handlePointerDown)
    window.addEventListener('pointerup', this.handlePointerUp)
    window.addEventListener('pointermove', this.handlePointerMove)
    window.addEventListener('keydown', this.handleKeyDown)
    window.addEventListener('keyup', this.handleKeyUp)
  }

  dispose() {
    this.element.removeEventListener('contextmenu', this.handleContextMenu)
    this.element.removeEventListener('pointerdown', this.handlePointerDown)
    window.removeEventListener('pointerup', this.handlePointerUp)
    window.removeEventListener('pointermove', this.handlePointerMove)
    window.removeEventListener('keydown', this.handleKeyDown)
    window.removeEventListener('keyup', this.handleKeyUp)
  }

  update(
    deltaSeconds: number,
    xrActive: boolean,
    touchMove?: { forward: number; right: number },
    freeFlyActive = false
  ) {
    intent.groundedAxis = 0
    intent.groundedTangent = 0
    intent.freeFlyThrust.set(0, 0, 0)
    intent.freeFlyBrake = 0
    intent.detachRequested = false
    intent.detachLaunchVelocity.set(0, 0, 0)

    if (xrActive) {
      this.introElapsed = null
      return intent
    }

    if (this.introElapsed !== null) {
      const userTookControl =
        this.dragging ||
        this.pressedKeys.size > 0 ||
        (touchMove !== undefined && (touchMove.forward !== 0 || touchMove.right !== 0))

      if (userTookControl) {
        this.introElapsed = null
      } else {
        this.introElapsed += deltaSeconds
        const done = this.introElapsed >= introRevealDurationSeconds()
        this.pitch = done ? 0 : introRevealPitch(this.introElapsed)
        this.camera.rotation.set(this.pitch, this.yaw, this.roll)

        if (done) {
          this.introElapsed = null
        }

        return intent
      }
    }

    // Seed/recover the free-fly attitude across mode changes so the view never
    // jumps. Cached for the async drag handler too.
    this.freeFlyActive = freeFlyActive
    if (freeFlyActive && !this.wasFreeFly) {
      // Grounded → free-fly: hand the orientation to the RIG so the whole
      // jetpack/body rolls, pitches and yaws (not just the eye). Seed it from
      // the current world view, neutralise the camera, and the rig carries the
      // attitude from here. Start with no inherited roll rate.
      this.camera.getWorldQuaternion(this.attitude)
      this.camera.rotation.set(0, 0, 0)
      this.playerRig.quaternion.copy(this.attitude)
      resetJetpackAttitude(this.rollAttitude)
    } else if (!freeFlyActive && this.wasFreeFly) {
      // Landing kills any coasting roll so the stand-up ease starts from rest.
      resetJetpackAttitude(this.rollAttitude)
      // Fallback for non-landing free-fly→grounded (e.g. a respawn). A natural
      // landing calls notifyLanded() a frame earlier, so the heading is applied
      // on the SAME frame the body settles — no one-frame snap to level forward.
      this.applyLandedOrientation()
    }
    this.wasFreeFly = freeFlyActive

    let yawDelta = 0
    let pitchDelta = 0

    if (this.pressedKeys.has('ArrowLeft')) {
      yawDelta += KEYBOARD_LOOK_SPEED * deltaSeconds
    }

    if (this.pressedKeys.has('ArrowRight')) {
      yawDelta -= KEYBOARD_LOOK_SPEED * deltaSeconds
    }

    if (this.pressedKeys.has('ArrowUp')) {
      pitchDelta += KEYBOARD_LOOK_SPEED * deltaSeconds
    }

    if (this.pressedKeys.has('ArrowDown')) {
      pitchDelta -= KEYBOARD_LOOK_SPEED * deltaSeconds
    }

    if (freeFlyActive) {
      // Full 6DOF: pitch/yaw/roll accumulate around the camera's OWN axes, so
      // there is no pitch clamp and no gimbal lock. Q/E build a roll RATE (KSP
      // RCS style): holding spins it up, releasing keeps it coasting.
      const rollInput =
        (this.pressedKeys.has('KeyQ') ? 1 : 0) - (this.pressedKeys.has('KeyE') ? 1 : 0)
      // B damps the roll rate back toward rest (the RCS angular brake).
      const rollBraking = this.pressedKeys.has('KeyB')
      stepJetpackAttitudeAxes(
        this.rollAttitude,
        0,
        0,
        rollInput,
        deltaSeconds,
        rollBraking,
        ROLL_ANGULAR_ACCEL
      )

      // Keyboard arrows still nudge yaw/pitch directly (mouse drag does too).
      if (yawDelta !== 0 || pitchDelta !== 0) {
        this.applyFreeFlyLook(yawDelta, pitchDelta, 0)
      }

      // Integrate the coasting roll rate into the attitude and apply.
      integrateJetpackAttitudeOrientation(this.attitude, this.rollAttitude, deltaSeconds)
      this.attitude.normalize()
      this.playerRig.quaternion.copy(this.attitude)
    } else {
      if (yawDelta !== 0 || pitchDelta !== 0) {
        this.applyLookDelta(yawDelta, pitchDelta)
      }

      // Taking the look over (pitching, or dragging) ends the stand-up ease.
      if (pitchDelta !== 0 || this.dragging) {
        this.standingUp = false
      }

      // Stand up after landing: ease the inherited free-fly pitch back to level
      // (roll eases just below), keeping the heading you flew in on.
      if (this.standingUp) {
        this.pitch =
          Math.abs(this.pitch) < 1e-3
            ? 0
            : this.pitch * Math.exp(-GROUNDING_PITCH_RATE * Math.max(0, deltaSeconds))

        if (this.pitch === 0) {
          this.standingUp = false
        }

        this.applyCameraRotation()
      }

      // The grounded view stays upright: ease any residual bank back to level.
      if (this.roll !== 0) {
        this.roll =
          Math.abs(this.roll) < 1e-3
            ? 0
            : this.roll * Math.exp(-ROLL_LEVEL_RATE * Math.max(0, deltaSeconds))
        this.applyCameraRotation()
      }
    }

    let forwardInput = 0
    let rightInput = 0

    if (this.pressedKeys.has('KeyW')) {
      forwardInput += 1
    }

    if (this.pressedKeys.has('KeyS')) {
      forwardInput -= 1
    }

    if (this.pressedKeys.has('KeyD')) {
      rightInput += 1
    }

    if (this.pressedKeys.has('KeyA')) {
      rightInput -= 1
    }

    // The virtual stick rides on the same camera-relative mapping as WASD.
    if (touchMove !== undefined) {
      forwardInput = THREE.MathUtils.clamp(forwardInput + touchMove.forward, -1, 1)
      rightInput = THREE.MathUtils.clamp(rightInput + touchMove.right, -1, 1)
    }

    // Grounded walk stays planar (camera-yaw relative). Space/Shift never walk.
    if (forwardInput !== 0 || rightInput !== 0) {
      inverseRigQuaternion.copy(this.playerRig.getWorldQuaternion(new THREE.Quaternion())).invert()
      groundedForward.copy(getForwardDirection(this.camera)).applyQuaternion(inverseRigQuaternion)
      groundedForward.y = 0

      if (groundedForward.lengthSq() < 1e-6) {
        groundedForward.set(0, 0, -1)
      } else {
        groundedForward.normalize()
      }

      groundedRight.copy(groundedForward).cross(new THREE.Vector3(0, 1, 0)).normalize()
      groundedMove
        .copy(groundedForward)
        .multiplyScalar(forwardInput)
        .addScaledVector(groundedRight, rightInput)

      if (groundedMove.lengthSq() > 1) {
        groundedMove.normalize()
      }

      intent.groundedAxis = groundedMove.x
      intent.groundedTangent = groundedMove.z
    }

    // Free-fly jetpack: KSP-style camera-relative 6DOF — WASD thrusts forward/
    // back/left/right, Shift thrusts up and Ctrl thrusts down (KSP throttle
    // keys), all relative to where you are looking. Space stays the jump only.
    let upInput = 0

    if (this.pressedKeys.has('ShiftLeft') || this.pressedKeys.has('ShiftRight')) {
      upInput += 1
    }

    if (this.pressedKeys.has('ControlLeft') || this.pressedKeys.has('ControlRight')) {
      upInput -= 1
    }

    if (forwardInput !== 0 || rightInput !== 0 || upInput !== 0) {
      this.camera.getWorldQuaternion(cameraWorldQuaternion)
      freeFlyForward.copy(getForwardDirection(this.camera))
      worldRight.set(1, 0, 0).applyQuaternion(cameraWorldQuaternion)
      freeFlyUp.set(0, 1, 0).applyQuaternion(cameraWorldQuaternion)
      freeFlyMove
        .copy(freeFlyForward)
        .multiplyScalar(forwardInput)
        .addScaledVector(worldRight, rightInput)
        .addScaledVector(freeFlyUp, upInput)

      if (freeFlyMove.lengthSq() > 1) {
        freeFlyMove.normalize()
      }

      intent.freeFlyThrust.copy(freeFlyMove)
    }

    if (this.pressedKeys.has('KeyF')) {
      detachLaunchVelocity.copy(getForwardDirection(this.camera)).multiplyScalar(DETACH_LAUNCH_SPEED)
      intent.detachRequested = true
      intent.detachLaunchVelocity.copy(detachLaunchVelocity)
    }

    return intent
  }

  // Snap the view to the rig's forward (yaw 0): entering the car keeps the
  // camera aligned with the hood instead of whatever way you last looked.
  resetLook() {
    this.yaw = 0
    this.pitch = 0
    this.roll = 0
    this.camera.rotation.set(0, 0, 0)
  }

  // Land facing the way you flew in: decompose the free-fly world attitude into
  // the grounded surface frame (rig basis X=+Y axial, Y=inward "up", Z=tangent,
  // matching applySurfaceRigState), keep the yaw (heading) and seed pitch/roll so
  // the stand-up ease can level them out instead of snapping to a fixed forward.
  private applyLandedOrientation() {
    const azimuth = Math.atan2(this.playerRig.position.z, this.playerRig.position.x)
    groundUp.set(-Math.cos(azimuth), 0, -Math.sin(azimuth))
    groundTangent.set(-Math.sin(azimuth), 0, Math.cos(azimuth))
    groundBasis.makeBasis(Y_AXIS, groundUp, groundTangent)
    groundRigQuaternion.setFromRotationMatrix(groundBasis)
    landingCameraQuaternion.copy(groundRigQuaternion).invert().multiply(this.attitude)
    landingEuler.setFromQuaternion(landingCameraQuaternion, 'YXZ')
    this.yaw = landingEuler.y
    this.pitch = THREE.MathUtils.clamp(landingEuler.x, -MAX_PITCH, MAX_PITCH)
    this.roll = landingEuler.z
    this.standingUp = true
    this.applyCameraRotation()
  }

  // The runtime calls this the moment the body settles onto the wall, AFTER the
  // grounded rig is posed, so the heading/tilt land on the same frame (no snap).
  notifyLanded() {
    this.applyLandedOrientation()
    // Suppress the lagged free-fly→grounded fallback in update() this transition.
    this.wasFreeFly = false
  }

  // First grounded boot only: tilt the view up to reveal the colony overhead,
  // hold, then ease back to the horizon. No-op if the view has already moved.
  startIntroReveal() {
    if (this.dragging || this.pitch !== 0 || this.yaw !== 0) {
      return
    }
    this.introElapsed = 0
  }

  // Let the reveal bow out the instant the player takes control by any means
  // (including the separate mobile look/gyro path).
  cancelIntroReveal() {
    this.introElapsed = null
  }

  private applyLookDelta(yawDelta: number, pitchDelta: number) {
    this.yaw += yawDelta
    this.pitch = THREE.MathUtils.clamp(this.pitch + pitchDelta, -MAX_PITCH, MAX_PITCH)
    this.applyCameraRotation()
  }

  private applyCameraRotation() {
    // YXZ order: roll (Z) banks the horizon without moving the look direction.
    this.camera.rotation.set(this.pitch, this.yaw, this.roll)
  }

  // Free 6DOF look: rotate the attitude about the camera's OWN axes (intrinsic),
  // so pitch never clamps and there is no gimbal lock.
  private applyFreeFlyLook(yawDelta: number, pitchDelta: number, rollDelta: number) {
    if (pitchDelta !== 0) {
      this.attitude.multiply(freeFlyDelta.setFromAxisAngle(X_AXIS, pitchDelta))
    }
    if (yawDelta !== 0) {
      this.attitude.multiply(freeFlyDelta.setFromAxisAngle(Y_AXIS, yawDelta))
    }
    if (rollDelta !== 0) {
      this.attitude.multiply(freeFlyDelta.setFromAxisAngle(Z_AXIS, rollDelta))
    }
    this.attitude.normalize()
    // The rig carries the free-fly attitude, so the jetpack body rolls with the
    // view (the camera stays neutral, parented under the rig).
    this.playerRig.quaternion.copy(this.attitude)
  }

  private readonly handleContextMenu = (event: MouseEvent) => {
    event.preventDefault()
  }

  private readonly handlePointerDown = (event: PointerEvent) => {
    if (event.button !== 2) {
      return
    }

    this.dragging = true
    this.element.setPointerCapture(event.pointerId)
    event.preventDefault()
  }

  private readonly handlePointerUp = (event: PointerEvent) => {
    if (event.button !== 2) {
      return
    }

    this.dragging = false

    if (this.element.hasPointerCapture(event.pointerId)) {
      this.element.releasePointerCapture(event.pointerId)
    }
  }

  private readonly handlePointerMove = (event: PointerEvent) => {
    if (!this.dragging) {
      return
    }

    const yawDelta = -event.movementX * LOOK_SENSITIVITY
    const pitchDelta = -event.movementY * LOOK_SENSITIVITY

    if (this.freeFlyActive) {
      this.applyFreeFlyLook(yawDelta, pitchDelta, 0)
    } else {
      this.applyLookDelta(yawDelta, pitchDelta)
    }
  }

  private readonly handleKeyDown = (event: KeyboardEvent) => {
    if (
      event.code !== 'KeyW' &&
      event.code !== 'KeyA' &&
      event.code !== 'KeyS' &&
      event.code !== 'KeyD' &&
      event.code !== 'KeyQ' &&
      event.code !== 'KeyE' &&
      event.code !== 'KeyB' &&
      event.code !== 'ArrowLeft' &&
      event.code !== 'ArrowRight' &&
      event.code !== 'ArrowUp' &&
      event.code !== 'ArrowDown' &&
      event.code !== 'KeyF' &&
      event.code !== 'Space' &&
      event.code !== 'ShiftLeft' &&
      event.code !== 'ShiftRight' &&
      event.code !== 'ControlLeft' &&
      event.code !== 'ControlRight'
    ) {
      return
    }

    event.preventDefault()
    this.pressedKeys.add(event.code)
  }

  private readonly handleKeyUp = (event: KeyboardEvent) => {
    this.pressedKeys.delete(event.code)
  }
}
