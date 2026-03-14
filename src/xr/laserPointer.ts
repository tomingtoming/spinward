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
    this.raycaster.far = DEFAULT_LENGTH
    this.raycaster.setFromXRController(this.controller)

    const hit = target === null ? undefined : this.raycaster.intersectObject(target, false)[0]
    this.line.scale.z = hit?.distance ?? DEFAULT_LENGTH
    this.line.material.color.set(hit === undefined ? 0x67e8f9 : 0xd9fbff)

    if (hit === undefined || hit.uv === undefined) {
      return null
    }

    return {
      distance: hit.distance,
      uv: hit.uv.clone()
    }
  }
}
