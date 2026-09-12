import * as THREE from 'three'

const DEFAULT_LENGTH = 1.8

export type LaserHit = {
  distance: number
  uv: THREE.Vector2
}

export class LaserPointer {
  private readonly raycaster = new THREE.Raycaster()
  private readonly line = new THREE.Line(
    new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(0, 0, 0),
      new THREE.Vector3(0, 0, -1)
    ]),
    new THREE.LineBasicMaterial({ color: 0x67e8f9 })
  )
  private controller: THREE.XRTargetRaySpace | null = null

  constructor() {
    this.line.visible = false
  }

  setController(controller: THREE.XRTargetRaySpace | null) {
    if (this.controller === controller) {
      return
    }

    this.line.removeFromParent()
    this.controller = controller
    controller?.add(this.line)
  }

  update(target: THREE.Object3D | null, enabled: boolean): LaserHit | null {
    if (!enabled || this.controller === null) {
      this.line.visible = false
      return null
    }

    this.line.visible = true
    const hit = this.hitTest(this.controller, target)
    this.line.scale.z = hit?.distance ?? DEFAULT_LENGTH
    this.line.material.color.set(hit === null ? 0x67e8f9 : 0xd9fbff)

    return hit
  }

  /** Also queried at selectstart, before the next render-loop hover update.
   * The whole panel owns its input, including disabled controls and padding. */
  hitTest(controller: THREE.XRTargetRaySpace, target: THREE.Object3D | null): LaserHit | null {
    if (!target) return null
    controller.updateWorldMatrix(true, false)
    target.updateWorldMatrix(true, false)
    this.raycaster.far = DEFAULT_LENGTH
    this.raycaster.setFromXRController(controller)
    const hit = this.raycaster.intersectObject(target, false)[0]
    return hit?.uv ? { distance: hit.distance, uv: hit.uv.clone() } : null
  }
}
