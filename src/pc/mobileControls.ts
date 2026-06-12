import * as THREE from 'three'

import { computeDeviceOrientationQuaternion } from './deviceOrientation'

export const isTouchDevice = () =>
  typeof window !== 'undefined' &&
  (navigator.maxTouchPoints > 0 || 'ontouchstart' in window)

type MobileControlHandlers = {
  onThrow: () => void
  onJump: () => void
  onTravel: (target: 'surface' | 'overlook' | 'axis') => void
  onToggleDrive: () => void
  onToggleSettings: () => void
  // True while a 2D UI (quick panel) should swallow canvas pointers.
  isUiPointerBlocked: () => boolean
}

type DeviceOrientationPermissionRequester = {
  requestPermission?: () => Promise<'granted' | 'denied'>
}

export type MobileMoveInput = {
  forward: number
  right: number
}

const TAP_MAX_MOVEMENT_PX = 12
const TAP_MAX_DURATION_MS = 350
const TOUCH_LOOK_SENSITIVITY = 0.0045
const MAX_PITCH = Math.PI * 0.48
const STICK_RADIUS_PX = 64
// Left fraction of the screen acts as the movement stick.
const MOVE_ZONE_FRACTION = 0.42

// Touch / smartphone layer. Two simultaneous pointers: the left zone is a
// floating virtual stick (walk / fly / drive), the right zone drags the view
// (or taps to throw). Buttons cover jump, travel, drive, gyro and settings.
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
  private readonly jumpButton: HTMLButtonElement
  private readonly driveButton: HTMLButtonElement
  private readonly brakeButton: HTMLButtonElement
  private readonly stickBase: HTMLDivElement
  private readonly stickNub: HTMLDivElement

  private lookPointerId: number | null = null
  private pointerDownAt = 0
  private pointerTravelPx = 0
  private lastPointerX = 0
  private lastPointerY = 0

  private movePointerId: number | null = null
  private moveOriginX = 0
  private moveOriginY = 0
  private readonly moveInput: MobileMoveInput = { forward: 0, right: 0 }

  private brakeHeld = false
  private driving = false

  constructor(
    private readonly camera: THREE.PerspectiveCamera,
    private readonly element: HTMLElement,
    private readonly handlers: MobileControlHandlers
  ) {
    this.overlay = document.createElement('div')
    // Styled via .mobile-controls; sits above three.js's VRButton.
    this.overlay.className = 'mobile-controls'

    const makeButton = (label: string, onTap: () => void) => {
      const button = document.createElement('button')
      button.textContent = label
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

    this.jumpButton = makeButton('Jump', () => this.handlers.onJump())
    makeButton('①', () => this.handlers.onTravel('surface'))
    makeButton('②', () => this.handlers.onTravel('overlook'))
    makeButton('③', () => this.handlers.onTravel('axis'))
    this.driveButton = makeButton('Drive', () => this.handlers.onToggleDrive())
    this.driveButton.classList.add('is-hidden')
    this.brakeButton = makeButton('Brake', () => {})
    this.brakeButton.classList.add('is-hidden')
    this.brakeButton.addEventListener('pointerdown', (event) => {
      event.stopPropagation()
      this.brakeHeld = true
    })
    const releaseBrake = () => {
      this.brakeHeld = false
    }
    this.brakeButton.addEventListener('pointerup', releaseBrake)
    this.brakeButton.addEventListener('pointercancel', releaseBrake)
    this.brakeButton.addEventListener('pointerleave', releaseBrake)
    this.gyroButton = makeButton('Gyro', () => this.toggleGyro())
    makeButton('⚙', () => this.handlers.onToggleSettings())

    this.stickBase = document.createElement('div')
    this.stickBase.className = 'mobile-stick'
    this.stickNub = document.createElement('div')
    this.stickNub.className = 'mobile-stick-nub'
    this.stickBase.append(this.stickNub)

    document.body.append(this.overlay, this.stickBase)
    this.element.addEventListener('pointerdown', this.handlePointerDown)
    window.addEventListener('pointermove', this.handlePointerMove)
    window.addEventListener('pointerup', this.handlePointerUp)
    window.addEventListener('pointercancel', this.handlePointerUp)
  }

  dispose() {
    this.overlay.remove()
    this.stickBase.remove()
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

  // Stick deflection: forward in [-1, 1] (up is +), right in [-1, 1].
  getMoveInput(): MobileMoveInput {
    return this.moveInput
  }

  isBrakeHeld() {
    return this.brakeHeld
  }

  setDriveAvailable(available: boolean) {
    this.driveButton.classList.toggle('is-hidden', !available && !this.driving)
  }

  setDriving(driving: boolean) {
    if (this.driving === driving) {
      return
    }

    this.driving = driving
    this.driveButton.textContent = driving ? 'Exit' : 'Drive'
    this.jumpButton.classList.toggle('is-hidden', driving)
    this.brakeButton.classList.toggle('is-hidden', !driving)

    if (!driving) {
      this.brakeHeld = false
    }
  }

  private toggleGyro() {
    if (this.gyroEnabled) {
      this.gyroEnabled = false
      this.gyroButton.classList.remove('is-active')
      window.removeEventListener('deviceorientation', this.handleDeviceOrientation)
      return
    }

    const requester = DeviceOrientationEvent as unknown as DeviceOrientationPermissionRequester

    const enable = () => {
      this.gyroEnabled = true
      this.gyroButton.classList.add('is-active')
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

  private showStick(x: number, y: number) {
    this.stickBase.style.left = `${x}px`
    this.stickBase.style.top = `${y}px`
    this.stickBase.classList.add('is-active')
    this.stickNub.style.transform = 'translate(-50%, -50%)'
  }

  private moveStickNub(dx: number, dy: number) {
    this.stickNub.style.transform = `translate(calc(${dx}px - 50%), calc(${dy}px - 50%))`
  }

  private hideStick() {
    this.stickBase.classList.remove('is-active')
  }

  private readonly handlePointerDown = (event: PointerEvent) => {
    if (event.pointerType !== 'touch' || this.handlers.isUiPointerBlocked()) {
      return
    }

    if (
      event.clientX < window.innerWidth * MOVE_ZONE_FRACTION &&
      this.movePointerId === null
    ) {
      // Floating stick: it is born where the thumb lands.
      this.movePointerId = event.pointerId
      this.moveOriginX = event.clientX
      this.moveOriginY = event.clientY
      this.moveInput.forward = 0
      this.moveInput.right = 0
      this.showStick(event.clientX, event.clientY)
      return
    }

    if (this.lookPointerId === null) {
      this.lookPointerId = event.pointerId
      this.pointerDownAt = performance.now()
      this.pointerTravelPx = 0
      this.lastPointerX = event.clientX
      this.lastPointerY = event.clientY
    }
  }

  private readonly handlePointerMove = (event: PointerEvent) => {
    if (event.pointerId === this.movePointerId) {
      const dx = event.clientX - this.moveOriginX
      const dy = event.clientY - this.moveOriginY
      const length = Math.hypot(dx, dy)
      const scale = length > STICK_RADIUS_PX ? STICK_RADIUS_PX / length : 1
      this.moveInput.right = (dx * scale) / STICK_RADIUS_PX
      this.moveInput.forward = (-dy * scale) / STICK_RADIUS_PX
      this.moveStickNub(dx * scale, dy * scale)
      return
    }

    if (event.pointerId !== this.lookPointerId) {
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
    if (event.pointerId === this.movePointerId) {
      this.movePointerId = null
      this.moveInput.forward = 0
      this.moveInput.right = 0
      this.hideStick()
      return
    }

    if (event.pointerId !== this.lookPointerId) {
      return
    }

    this.lookPointerId = null
    const heldMs = performance.now() - this.pointerDownAt

    if (this.pointerTravelPx <= TAP_MAX_MOVEMENT_PX && heldMs <= TAP_MAX_DURATION_MS) {
      this.handlers.onThrow()
    }
  }
}
