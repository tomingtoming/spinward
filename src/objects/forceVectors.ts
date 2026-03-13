import * as THREE from 'three'

import { createForceBreakdown, computeForceBreakdown } from '../sim/forceBreakdown'
import type { Ball } from './ball'

type ForceVectorUpdate = {
  ball: Ball | null
  omega: number
  scale: number
  visible: boolean
}

const direction = new THREE.Vector3()

export class ForceVectorArrows {
  readonly group = new THREE.Group()

  private readonly breakdown = createForceBreakdown()
  private readonly centrifugalArrow = new THREE.ArrowHelper(
    new THREE.Vector3(1, 0, 0),
    new THREE.Vector3(),
    1,
    0xf97316
  )
  private readonly coriolisArrow = new THREE.ArrowHelper(
    new THREE.Vector3(1, 0, 0),
    new THREE.Vector3(),
    1,
    0x60a5fa
  )
  private readonly totalArrow = new THREE.ArrowHelper(
    new THREE.Vector3(1, 0, 0),
    new THREE.Vector3(),
    1,
    0x34d399
  )

  constructor() {
    this.group.add(this.centrifugalArrow)
    this.group.add(this.coriolisArrow)
    this.group.add(this.totalArrow)
    this.group.visible = false
  }

  update({ ball, omega, scale, visible }: ForceVectorUpdate) {
    if (!visible || ball === null) {
      this.group.visible = false
      return
    }

    this.group.visible = true
    computeForceBreakdown(omega, ball.position, ball.velocity, this.breakdown)

    this.updateArrow(this.centrifugalArrow, ball.position, this.breakdown.centrifugal, scale)
    this.updateArrow(this.coriolisArrow, ball.position, this.breakdown.coriolis, scale)
    this.updateArrow(this.totalArrow, ball.position, this.breakdown.total, scale)
  }

  private updateArrow(
    arrow: THREE.ArrowHelper,
    origin: THREE.Vector3,
    vector: THREE.Vector3,
    scale: number
  ) {
    const length = vector.length() * scale

    if (length < 0.001) {
      arrow.visible = false
      return
    }

    arrow.visible = true
    arrow.position.copy(origin)
    arrow.setDirection(direction.copy(vector).normalize())
    arrow.setLength(length, Math.min(0.45, length * 0.3), Math.min(0.22, length * 0.18))
  }
}
