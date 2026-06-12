import * as THREE from 'three'

import { getForwardDirection } from './forwardDirection'
import { createLocomotionIntent } from './locomotionIntent'

const LOOK_SENSITIVITY = 0.003
const KEYBOARD_LOOK_SPEED = 1.4
const MAX_PITCH = Math.PI * 0.48

const groundedForward = new THREE.Vector3()
const groundedRight = new THREE.Vector3()
const groundedMove = new THREE.Vector3()
const freeFlyForward = new THREE.Vector3()
const freeFlyMove = new THREE.Vector3()
const inverseRigQuaternion = new THREE.Quaternion()
const worldRight = new THREE.Vector3()
const detachLaunchVelocity = new THREE.Vector3()
const intent = createLocomotionIntent()
const DETACH_LAUNCH_SPEED = 6

export class DesktopLookControls {
  private yaw = 0
  private pitch = 0
  private dragging = false
  private readonly pressedKeys = new Set<string>()

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

  update(deltaSeconds: number, xrActive: boolean) {
    intent.groundedAxis = 0
    intent.groundedTangent = 0
    intent.freeFlyThrust.set(0, 0, 0)
    intent.freeFlyBrake = 0
    intent.detachRequested = false
    intent.detachLaunchVelocity.set(0, 0, 0)

    if (xrActive) {
      return intent
    }

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

    if (yawDelta !== 0 || pitchDelta !== 0) {
      this.applyLookDelta(yawDelta, pitchDelta)
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

      freeFlyForward.copy(getForwardDirection(this.camera))
      worldRight.set(1, 0, 0).applyQuaternion(this.camera.getWorldQuaternion(new THREE.Quaternion()))
      freeFlyMove
        .copy(freeFlyForward)
        .multiplyScalar(forwardInput)
        .addScaledVector(worldRight, rightInput)

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

    if (this.pressedKeys.has('ShiftLeft') || this.pressedKeys.has('ShiftRight')) {
      intent.freeFlyBrake = 1
    }

    return intent
  }

  private applyLookDelta(yawDelta: number, pitchDelta: number) {
    this.yaw += yawDelta
    this.pitch = THREE.MathUtils.clamp(this.pitch + pitchDelta, -MAX_PITCH, MAX_PITCH)
    this.camera.rotation.set(this.pitch, this.yaw, 0)
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

    this.applyLookDelta(-event.movementX * LOOK_SENSITIVITY, -event.movementY * LOOK_SENSITIVITY)
  }

  private readonly handleKeyDown = (event: KeyboardEvent) => {
    if (
      event.code !== 'KeyW' &&
      event.code !== 'KeyA' &&
      event.code !== 'KeyS' &&
      event.code !== 'KeyD' &&
      event.code !== 'ArrowLeft' &&
      event.code !== 'ArrowRight' &&
      event.code !== 'ArrowUp' &&
      event.code !== 'ArrowDown' &&
      event.code !== 'KeyF' &&
      event.code !== 'ShiftLeft' &&
      event.code !== 'ShiftRight'
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
