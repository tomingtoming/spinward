import * as THREE from 'three'

import type { HandClutchSample } from '../xr/handClutchLocomotion'

const lineStart = new THREE.Vector3(0, 0, 0)
const lineEnd = new THREE.Vector3()

export class HandClutchDebugView {
  readonly group = new THREE.Group()

  private readonly anchorMarker = new THREE.Mesh(
    new THREE.SphereGeometry(0.015, 8, 8),
    new THREE.MeshBasicMaterial({
      color: 0x67e8f9,
      transparent: true,
      opacity: 0.9,
      depthWrite: false
    })
  )
  private readonly axes = new THREE.AxesHelper(0.14)
  private readonly deltaLine = new THREE.Line(
    new THREE.BufferGeometry().setFromPoints([lineStart, lineStart]),
    new THREE.LineBasicMaterial({
      color: 0x67e8f9,
      transparent: true,
      opacity: 0.95,
      depthWrite: false
    })
  )

  constructor() {
    this.group.renderOrder = 18
    this.group.visible = false
    this.group.add(this.axes, this.anchorMarker, this.deltaLine)
  }

  update(
    sample: HandClutchSample | null,
    mode: 'attached' | 'free-fly',
    options: {
      detachReady?: boolean
      linearBrake?: boolean
      angularBrake?: boolean
    } = {}
  ) {
    if (sample === null || !sample.active) {
      this.group.visible = false
      return
    }

    this.group.visible = true
    this.group.position.copy(sample.anchorWorldPosition)
    this.group.quaternion.copy(sample.controlFrameWorldQuaternion)

    lineEnd.copy(sample.localDisplacement)
    this.deltaLine.geometry.setFromPoints([lineStart, lineEnd])

    const color = options.detachReady
      ? 0x34d399
      : options.linearBrake
        ? 0xf59e0b
        : options.angularBrake
          ? 0xf97316
          : mode === 'attached'
            ? 0x67e8f9
            : 0xa78bfa

    ;(this.anchorMarker.material as THREE.MeshBasicMaterial).color.setHex(color)
    ;(this.deltaLine.material as THREE.LineBasicMaterial).color.setHex(color)
  }

  dispose() {
    this.anchorMarker.geometry.dispose()
    ;(this.anchorMarker.material as THREE.MeshBasicMaterial).dispose()
    this.deltaLine.geometry.dispose()
    ;(this.deltaLine.material as THREE.LineBasicMaterial).dispose()
  }
}
