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
  releaseRoot?: THREE.Object3D
  camera: THREE.PerspectiveCamera
  renderer: THREE.WebGLRenderer
  controllerRoot?: THREE.Object3D
  shouldBlockSelectStart?: (controller: THREE.XRTargetRaySpace) => boolean
  onEmptySelectStart?: (controller: THREE.XRTargetRaySpace) => GrabTarget | null | void
  onSqueezeStart?: (controller: THREE.XRTargetRaySpace) => void
}

export type XRControllerSpaces = Pick<ControllerState, 'controller' | 'grip'>

export class GrabSystem {
  private readonly raycaster = new THREE.Raycaster()
  private readonly controllerModelFactory = new XRControllerModelFactory()
  private readonly targets = new Set<GrabTarget>()
  private readonly controllers: ControllerState[]
  private readonly grabbedByController = new Map<THREE.XRTargetRaySpace, GrabTarget>()
  private readonly controllerByTarget = new Map<GrabTarget, THREE.XRTargetRaySpace>()
  private readonly hoverCounts = new Map<GrabTarget, number>()

  constructor(private readonly options: GrabSystemOptions) {
    this.raycaster.far = DEFAULT_RAY_LENGTH
    this.controllers = [this.buildController(0), this.buildController(1)]
  }

  registerTarget(target: GrabTarget) {
    this.targets.add(target)
  }

  unregisterTarget(target: GrabTarget) {
    const grabbingController = this.controllerByTarget.get(target)

    if (grabbingController !== undefined) {
      this.releaseGrab(grabbingController)
    }

    this.targets.delete(target)
    this.controllerByTarget.delete(target)
    this.hoverCounts.delete(target)

    for (const controller of this.controllers) {
      if (controller.hoveredTarget === target) {
        this.updateHoverCount(target, -1)
        controller.hoveredTarget = null
      }
    }
  }

  getControllers() {
    return this.controllers
  }

  getGrabbedTarget(controller?: THREE.XRTargetRaySpace) {
    if (controller !== undefined) {
      return this.grabbedByController.get(controller) ?? null
    }

    const [firstTarget] = this.grabbedByController.values()
    return firstTarget ?? null
  }

  isTargetGrabbed(target: GrabTarget) {
    return this.controllerByTarget.has(target)
  }

  releaseGrab(controller: THREE.XRTargetRaySpace) {
    const target = this.grabbedByController.get(controller)

    if (target === undefined) {
      return
    }

    ;(this.options.releaseRoot ?? this.options.scene).attach(target.object)
    target.onGrabEnd?.(controller)
    this.grabbedByController.delete(controller)
    this.controllerByTarget.delete(target)
  }

  update() {
    let hasHoveredTarget = false

    for (const controllerState of this.controllers) {
      // Each controller now owns its own grab slot, so both hands can hold/throw independently.
      const isHolding = this.grabbedByController.has(controllerState.controller)
      const hoveredTarget = isHolding ? null : this.findHoveredTarget(controllerState.controller)

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
      this.releaseGrab(event.target)
    })
    controller.addEventListener('squeezestart', (event) => {
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
    if (this.options.shouldBlockSelectStart?.(controller) ?? false) {
      return
    }

    if (this.grabbedByController.has(controller)) {
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
    if (this.controllerByTarget.has(target)) {
      return
    }

    // Objects are attached directly to the controller so the existing grab behavior stays intact.
    controller.attach(target.object)
    target.object.position.copy(target.holdOffset ?? DEFAULT_HOLD_OFFSET)

    if (target.holdRotation !== undefined) {
      target.object.rotation.copy(target.holdRotation)
    }

    target.onGrabStart?.(controller)
    this.grabbedByController.set(controller, target)
    this.controllerByTarget.set(target, controller)
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

    if (previousTarget !== null) {
      this.updateHoverCount(previousTarget, -1)
    }

    if (target !== null) {
      this.updateHoverCount(target, 1)
    }

    controllerState.hoveredTarget = target
  }

  private findHoveredTarget(controller: THREE.XRTargetRaySpace) {
    let closestTarget: GrabTarget | null = null
    let closestDistance = Number.POSITIVE_INFINITY

    this.raycaster.setFromXRController(controller)

    for (const target of this.targets) {
      if (this.controllerByTarget.has(target)) {
        continue
      }

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

  private updateHoverCount(target: GrabTarget, delta: number) {
    const nextCount = Math.max(0, (this.hoverCounts.get(target) ?? 0) + delta)

    if (nextCount === 0) {
      this.hoverCounts.delete(target)
    } else {
      this.hoverCounts.set(target, nextCount)
    }

    target.onHoverChange?.(nextCount > 0)
  }
}
