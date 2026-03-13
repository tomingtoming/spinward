import * as THREE from 'three'

import { applySurfaceRigState, moveSurfaceRigState, type SurfaceRigState } from './surfaceRig'

const LOOK_SENSITIVITY = 0.003
const KEYBOARD_LOOK_SPEED = 1.4
const MOVE_SPEED = 6
const MAX_PITCH = Math.PI * 0.48

const localForward = new THREE.Vector3()
const localRight = new THREE.Vector3()
const localMove = new THREE.Vector3()

export class DesktopLookControls {
  private yaw = 0
  private pitch = 0
  private dragging = false
  private readonly pressedKeys = new Set<string>()

  constructor(
    private readonly surfaceState: SurfaceRigState,
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

  syncToRig(radius: number) {
    applySurfaceRigState(this.playerRig, this.surfaceState, radius)
  }

  update(deltaSeconds: number, xrActive: boolean, radius: number, length: number) {
    if (xrActive) {
      return
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
      localForward.set(0, 0, -1).applyQuaternion(this.camera.quaternion)
      localForward.y = 0

      if (localForward.lengthSq() < 1e-6) {
        localForward.set(0, 0, -1)
      } else {
        localForward.normalize()
      }

      localRight.copy(localForward).cross(new THREE.Vector3(0, 1, 0)).normalize()
      localMove
        .copy(localForward)
        .multiplyScalar(forwardInput)
        .addScaledVector(localRight, rightInput)

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
    }

    this.syncToRig(radius)
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
      event.code !== 'ArrowDown'
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
