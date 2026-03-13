import * as THREE from 'three'
import { XRControllerModelFactory } from 'three/addons/webxr/XRControllerModelFactory.js'

const DEFAULT_HOLD_OFFSET = new THREE.Vector3(0, -0.05, -0.7)
const DEFAULT_RAY_LENGTH = 5

export type GrabTarget = {
  object: THREE.Object3D
  holdOffset?: THREE.Vector3
  holdRotation?: THREE.Euler
  onHoverChange?: (hovered: boolean) => void
  onGrabStart?: (controller: THREE.XRTargetRaySpace) => void
  onGrabEnd?: (controller: THREE.XRTargetRaySpace) => void
}

type ControllerState = {
  controller: THREE.XRTargetRaySpace
  grip: THREE.XRGripSpace
  ray: THREE.Line<THREE.BufferGeometry, THREE.LineBasicMaterial>
  hoveredTarget: GrabTarget | null
}

type GrabSystemOptions = {
  scene: THREE.Scene
  camera: THREE.PerspectiveCamera
  renderer: THREE.WebGLRenderer
  controllerRoot?: THREE.Object3D
  onEmptySelectStart?: (controller: THREE.XRTargetRaySpace) => GrabTarget | null | void
  onSqueezeStart?: (controller: THREE.XRTargetRaySpace) => void
}

type GrabState = {
  controller: THREE.XRTargetRaySpace
  target: GrabTarget
}

export class GrabSystem {
  private readonly raycaster = new THREE.Raycaster()
  private readonly controllerModelFactory = new XRControllerModelFactory()
  private readonly viewerPosition = new THREE.Vector3()
  private readonly viewerDirection = new THREE.Vector3()
  private readonly targets = new Set<GrabTarget>()
  private readonly controllers: ControllerState[]
  private grabbed: GrabState | null = null

  constructor(private readonly options: GrabSystemOptions) {
    this.raycaster.far = DEFAULT_RAY_LENGTH
    this.controllers = [this.buildController(0), this.buildController(1)]
  }

  registerTarget(target: GrabTarget) {
    this.targets.add(target)
  }

  unregisterTarget(target: GrabTarget) {
    if (this.grabbed?.target === target) {
      this.releaseGrab()
    }

    this.targets.delete(target)

    for (const controller of this.controllers) {
      if (controller.hoveredTarget === target) {
        controller.hoveredTarget.onHoverChange?.(false)
        controller.hoveredTarget = null
      }
    }
  }

  getControllers() {
    return this.controllers
  }

  getGrabbedTarget() {
    return this.grabbed?.target ?? null
  }

  releaseGrab() {
    if (this.grabbed === null) {
      return
    }

    const { controller, target } = this.grabbed
    this.options.scene.attach(target.object)
    target.onGrabEnd?.(controller)
    this.grabbed = null
  }

  placeObjectInFrontOfViewer(object: THREE.Object3D, distance = 1.5) {
    const viewer = this.options.renderer.xr.isPresenting
      ? this.options.renderer.xr.getCamera()
      : this.options.camera

    viewer.getWorldPosition(this.viewerPosition)
    this.viewerDirection.set(0, 0, -1).applyQuaternion(viewer.quaternion)
    this.viewerDirection.y = 0

    if (this.viewerDirection.lengthSq() === 0) {
      this.viewerDirection.set(0, 0, -1)
    } else {
      this.viewerDirection.normalize()
    }

    object.position.copy(this.viewerPosition).addScaledVector(this.viewerDirection, distance)
  }

  update() {
    let hasHoveredTarget = false

    for (const controllerState of this.controllers) {
      const isHolding = this.grabbed?.controller === controllerState.controller
      const hoveredTarget = this.grabbed === null ? this.findHoveredTarget(controllerState.controller) : null

      this.setHoveredTarget(controllerState, hoveredTarget)

      controllerState.ray.scale.z = hoveredTarget?.distance ?? DEFAULT_RAY_LENGTH
      controllerState.ray.material.color.set(
        isHolding ? 0x34d399 : hoveredTarget === null ? 0xffffff : 0x7dd3fc
      )

      hasHoveredTarget ||= hoveredTarget !== null
    }

    return { hasHoveredTarget }
  }

  private buildController(index: number): ControllerState {
    const controller = this.options.renderer.xr.getController(index)
    const grip = this.options.renderer.xr.getControllerGrip(index)
    const ray = this.makeControllerRay()

    controller.add(ray)
    controller.addEventListener('selectstart', (event) => {
      this.handleSelectStart(event.target)
    })
    controller.addEventListener('selectend', (event) => {
      if (this.grabbed?.controller === event.target) {
        this.releaseGrab()
      }
    })
    controller.addEventListener('squeezestart', (event) => {
      this.releaseGrab()
      this.options.onSqueezeStart?.(event.target)
    })

    grip.add(this.controllerModelFactory.createControllerModel(grip))
    const controllerRoot = this.options.controllerRoot ?? this.options.scene
    controllerRoot.add(controller)
    controllerRoot.add(grip)

    return { controller, grip, ray, hoveredTarget: null }
  }

  private makeControllerRay() {
    const geometry = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(0, 0, 0),
      new THREE.Vector3(0, 0, -1)
    ])
    const material = new THREE.LineBasicMaterial({ color: 0xffffff })
    const ray = new THREE.Line(geometry, material)
    ray.name = 'ray'
    ray.scale.z = DEFAULT_RAY_LENGTH
    return ray
  }

  private handleSelectStart(controller: THREE.XRTargetRaySpace) {
    if (this.grabbed !== null) {
      return
    }

    const hoveredTarget = this.findHoveredTarget(controller)?.target ?? null

    if (hoveredTarget !== null) {
      this.grabTarget(controller, hoveredTarget)
      return
    }

    const createdTarget = this.options.onEmptySelectStart?.(controller) ?? null

    if (createdTarget !== null) {
      this.grabTarget(controller, createdTarget)
    }
  }

  private grabTarget(controller: THREE.XRTargetRaySpace, target: GrabTarget) {
    controller.attach(target.object)
    target.object.position.copy(target.holdOffset ?? DEFAULT_HOLD_OFFSET)

    if (target.holdRotation !== undefined) {
      target.object.rotation.copy(target.holdRotation)
    }

    target.onGrabStart?.(controller)
    this.grabbed = { controller, target }
  }

  private setHoveredTarget(
    controllerState: ControllerState,
    nextTarget: { distance: number; target: GrabTarget } | null
  ) {
    const previousTarget = controllerState.hoveredTarget
    const target = nextTarget?.target ?? null

    if (previousTarget === target) {
      return
    }

    previousTarget?.onHoverChange?.(false)
    target?.onHoverChange?.(true)
    controllerState.hoveredTarget = target
  }

  private findHoveredTarget(controller: THREE.XRTargetRaySpace) {
    let closestTarget: GrabTarget | null = null
    let closestDistance = Number.POSITIVE_INFINITY

    this.raycaster.setFromXRController(controller)

    for (const target of this.targets) {
      const [intersection] = this.raycaster.intersectObject(target.object, true)

      if (intersection === undefined || intersection.distance >= closestDistance) {
        continue
      }

      closestTarget = target
      closestDistance = intersection.distance
    }

    return closestTarget === null
      ? null
      : {
          distance: closestDistance,
          target: closestTarget
        }
  }
}
