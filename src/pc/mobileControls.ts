import * as THREE from 'three'

import { computeDeviceOrientationQuaternion } from './deviceOrientation'

export const isTouchDevice = () =>
  typeof window !== 'undefined' &&
  (navigator.maxTouchPoints > 0 || 'ontouchstart' in window)

type MobileControlHandlers = {
  onThrow: () => void
  onJump: () => void
  onTravel: (target: 'surface' | 'overlook' | 'axis') => void
}

type DeviceOrientationPermissionRequester = {
  requestPermission?: () => Promise<'granted' | 'denied'>
}

const TAP_MAX_MOVEMENT_PX = 12
const TAP_MAX_DURATION_MS = 350
const TOUCH_LOOK_SENSITIVITY = 0.0045
const MAX_PITCH = Math.PI * 0.48

const BUTTON_STYLE =
  'pointer-events:auto;background:rgba(8,24,36,0.78);color:#d8ecf6;' +
  'border:1px solid rgba(103,232,249,0.45);border-radius:10px;' +
  'padding:10px 14px;font:600 14px sans-serif;min-width:52px;'

// Touch / smartphone layer: one-finger drag (or gyro) to look, tap to throw,
// on-screen buttons for jump and the three travel points.
export class MobileControls {
  private yaw = 0
  private pitch = 0
  private gyroEnabled = false
  private hasGyroSample = false
  private gyroAlpha = 0
  private gyroBeta = 0
  private gyroGamma = 0
  private readonly gyroQuaternion = new THREE.Quaternion()
  private readonly overlay: HTMLDivElement
  private readonly gyroButton: HTMLButtonElement
  private activePointerId: number | null = null
  private pointerDownAt = 0
  private pointerTravelPx = 0
  private lastPointerX = 0
  private lastPointerY = 0

  constructor(
    private readonly camera: THREE.PerspectiveCamera,
    private readonly element: HTMLElement,
    private readonly handlers: MobileControlHandlers
  ) {
    this.overlay = document.createElement('div')
    // Sits above three.js's VRButton (z-index 999, centered at the bottom).
    this.overlay.style.cssText =
      'position:fixed;bottom:74px;left:50%;transform:translateX(-50%);' +
      'display:flex;gap:10px;z-index:1000;pointer-events:none;'

    const makeButton = (label: string, onTap: () => void) => {
      const button = document.createElement('button')
      button.textContent = label
      button.style.cssText = BUTTON_STYLE
      button.addEventListener('pointerdown', (event) => {
        event.stopPropagation()
      })
      button.addEventListener('click', (event) => {
        event.preventDefault()
        onTap()
      })
      this.overlay.append(button)
      return button
    }

    makeButton('Jump', () => this.handlers.onJump())
    makeButton('①', () => this.handlers.onTravel('surface'))
    makeButton('②', () => this.handlers.onTravel('overlook'))
    makeButton('③', () => this.handlers.onTravel('axis'))
    this.gyroButton = makeButton('Gyro', () => this.toggleGyro())

    document.body.append(this.overlay)
    this.element.addEventListener('pointerdown', this.handlePointerDown)
    window.addEventListener('pointermove', this.handlePointerMove)
    window.addEventListener('pointerup', this.handlePointerUp)
    window.addEventListener('pointercancel', this.handlePointerUp)
  }

  dispose() {
    this.overlay.remove()
    this.element.removeEventListener('pointerdown', this.handlePointerDown)
    window.removeEventListener('pointermove', this.handlePointerMove)
    window.removeEventListener('pointerup', this.handlePointerUp)
    window.removeEventListener('pointercancel', this.handlePointerUp)
    window.removeEventListener('deviceorientation', this.handleDeviceOrientation)
  }

  update(xrActive: boolean) {
    if (xrActive) {
      return
    }

    if (this.gyroEnabled && this.hasGyroSample) {
      computeDeviceOrientationQuaternion(
        this.gyroAlpha,
        this.gyroBeta,
        this.gyroGamma,
        this.getScreenOrientationRad(),
        this.gyroQuaternion
      )
      this.camera.quaternion.copy(this.gyroQuaternion)
    }
  }

  private toggleGyro() {
    if (this.gyroEnabled) {
      this.gyroEnabled = false
      this.gyroButton.style.background = 'rgba(8,24,36,0.78)'
      window.removeEventListener('deviceorientation', this.handleDeviceOrientation)
      return
    }

    const requester = DeviceOrientationEvent as unknown as DeviceOrientationPermissionRequester

    const enable = () => {
      this.gyroEnabled = true
      this.gyroButton.style.background = 'rgba(15,92,115,0.9)'
      window.addEventListener('deviceorientation', this.handleDeviceOrientation)
    }

    // iOS requires an explicit permission request from a user gesture.
    if (typeof requester.requestPermission === 'function') {
      requester
        .requestPermission()
        .then((state) => {
          if (state === 'granted') {
            enable()
          }
        })
        .catch(() => {})
      return
    }

    enable()
  }

  private getScreenOrientationRad() {
    const angle =
      typeof screen !== 'undefined' && screen.orientation !== undefined
        ? screen.orientation.angle
        : 0
    return THREE.MathUtils.degToRad(angle)
  }

  private readonly handleDeviceOrientation = (event: DeviceOrientationEvent) => {
    if (event.alpha === null || event.beta === null || event.gamma === null) {
      return
    }

    this.hasGyroSample = true
    this.gyroAlpha = THREE.MathUtils.degToRad(event.alpha)
    this.gyroBeta = THREE.MathUtils.degToRad(event.beta)
    this.gyroGamma = THREE.MathUtils.degToRad(event.gamma)
  }

  private readonly handlePointerDown = (event: PointerEvent) => {
    if (event.pointerType !== 'touch' || this.activePointerId !== null) {
      return
    }

    this.activePointerId = event.pointerId
    this.pointerDownAt = performance.now()
    this.pointerTravelPx = 0
    this.lastPointerX = event.clientX
    this.lastPointerY = event.clientY
  }

  private readonly handlePointerMove = (event: PointerEvent) => {
    if (event.pointerId !== this.activePointerId) {
      return
    }

    const deltaX = event.clientX - this.lastPointerX
    const deltaY = event.clientY - this.lastPointerY
    this.lastPointerX = event.clientX
    this.lastPointerY = event.clientY
    this.pointerTravelPx += Math.hypot(deltaX, deltaY)

    if (this.gyroEnabled) {
      return
    }

    this.yaw -= deltaX * TOUCH_LOOK_SENSITIVITY
    this.pitch = THREE.MathUtils.clamp(
      this.pitch - deltaY * TOUCH_LOOK_SENSITIVITY,
      -MAX_PITCH,
      MAX_PITCH
    )
    this.camera.rotation.set(this.pitch, this.yaw, 0)
  }

  private readonly handlePointerUp = (event: PointerEvent) => {
    if (event.pointerId !== this.activePointerId) {
      return
    }

    this.activePointerId = null
    const heldMs = performance.now() - this.pointerDownAt

    if (this.pointerTravelPx <= TAP_MAX_MOVEMENT_PX && heldMs <= TAP_MAX_DURATION_MS) {
      this.handlers.onThrow()
    }
  }
}
