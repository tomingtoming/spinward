import * as THREE from 'three'

const LOOK_SENSITIVITY = 0.003
const KEYBOARD_LOOK_SPEED = 1.4
const MAX_PITCH = Math.PI * 0.48

export class DesktopLookControls {
  private yaw = 0
  private pitch = 0
  private dragging = false
  private readonly pressedKeys = new Set<string>()

  constructor(
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
      event.code !== 'ArrowLeft' &&
      event.code !== 'ArrowRight' &&
      event.code !== 'ArrowUp' &&
      event.code !== 'ArrowDown'
    ) {
      return
    }

    this.pressedKeys.add(event.code)
  }

  private readonly handleKeyUp = (event: KeyboardEvent) => {
    this.pressedKeys.delete(event.code)
  }
}
