import * as THREE from 'three'

import type { PlayerTraversalState } from '../app/playerTraversal'
import { inertialPositionToRotating } from '../sim/frameTransforms'

type DockingGuideConfig = {
  radius: number
  length: number
  frameAngle: number
  ready: boolean
  endCapMargin?: number
}

export type DockingGuideState = {
  visible: boolean
  playerPosition: THREE.Vector3
  targetPosition: THREE.Vector3
  normal: THREE.Vector3
  ready: boolean
}

const guidePosition = new THREE.Vector3()
const guideNormal = new THREE.Vector3()
const ringNormal = new THREE.Vector3(0, 0, 1)
const targetPosition = new THREE.Vector3()
const linePoints = [new THREE.Vector3(), new THREE.Vector3()]

const createDockingGuideState = (): DockingGuideState => ({
  visible: false,
  playerPosition: new THREE.Vector3(),
  targetPosition: new THREE.Vector3(),
  normal: new THREE.Vector3(1, 0, 0),
  ready: false
})

export const computeDockingGuideState = (
  state: PlayerTraversalState,
  config: DockingGuideConfig,
  target = createDockingGuideState()
) => {
  target.ready = config.ready

  if (state.mode !== 'free-fly') {
    target.visible = false
    return target
  }

  target.visible = true
  inertialPositionToRotating(state.inertialPosition, config.frameAngle, guidePosition)
  target.playerPosition.copy(guidePosition)

  const halfLength = Math.max(0, config.length * 0.5 - (config.endCapMargin ?? 1.5))
  const radialDistance = Math.hypot(guidePosition.x, guidePosition.z)

  if (radialDistance <= 1e-6) {
    guideNormal.set(1, 0, 0)
  } else {
    guideNormal.set(guidePosition.x / radialDistance, 0, guidePosition.z / radialDistance)
  }

  target.normal.copy(guideNormal)
  targetPosition.copy(guideNormal).multiplyScalar(config.radius)
  targetPosition.y = THREE.MathUtils.clamp(guidePosition.y, -halfLength, halfLength)
  target.targetPosition.copy(targetPosition)

  return target
}

export class DockingGuide {
  readonly group = new THREE.Group()

  private readonly line = new THREE.Line(
    new THREE.BufferGeometry().setFromPoints(linePoints),
    new THREE.LineBasicMaterial({ color: 0x60a5fa, transparent: true, opacity: 0.75 })
  )
  private readonly ring = new THREE.Mesh(
    new THREE.RingGeometry(0.38, 0.54, 32),
    new THREE.MeshBasicMaterial({
      color: 0x60a5fa,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.72
    })
  )

  constructor() {
    this.group.add(this.line)
    this.group.add(this.ring)
    this.group.visible = false
  }

  update(state: DockingGuideState) {
    if (!state.visible) {
      this.group.visible = false
      return
    }

    this.group.visible = true
    const color = state.ready ? 0x34d399 : 0x60a5fa

    this.line.material.color.setHex(color)
    this.ring.material.color.setHex(color)
    linePoints[0].copy(state.playerPosition)
    linePoints[1].copy(state.targetPosition)
    this.line.geometry.setFromPoints(linePoints)
    this.ring.position.copy(state.targetPosition)
    this.ring.quaternion.setFromUnitVectors(ringNormal, state.normal)
  }
}
