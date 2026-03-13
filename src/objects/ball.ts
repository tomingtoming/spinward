import * as THREE from 'three'

import { advanceBallState } from '../sim/ballStep'
import type { GrabTarget } from '../xr/grabSystem'

type BallOptions = {
  initialPosition: THREE.Vector3
  initialVelocity?: THREE.Vector3
  radius?: number
  color?: number
  maxTrailPoints: number
  lifetimeSeconds: number
  onReleased?: (controller: THREE.XRTargetRaySpace, ball: Ball) => void
}

type BallStepConfig = {
  deltaSeconds: number
  radius: number
  length: number
  omega: number
  restitution: number
}

const DEFAULT_HOLD_OFFSET = new THREE.Vector3(0, -0.03, -0.35)

export class Ball {
  readonly radius: number
  readonly mesh: THREE.Mesh<THREE.SphereGeometry, THREE.MeshStandardMaterial>
  readonly trail: THREE.Line<THREE.BufferGeometry, THREE.LineBasicMaterial>
  readonly velocity: THREE.Vector3
  readonly grabTarget: GrabTarget

  private readonly lifetimeSeconds: number
  private readonly maxTrailPoints: number
  private readonly trailPoints: THREE.Vector3[] = []
  private readonly onReleased?: (controller: THREE.XRTargetRaySpace, ball: Ball) => void

  private hovered = false
  private grabbed = false
  private ageSeconds = 0

  constructor(options: BallOptions) {
    this.radius = options.radius ?? 0.18
    this.velocity = options.initialVelocity?.clone() ?? new THREE.Vector3()
    this.lifetimeSeconds = options.lifetimeSeconds
    this.maxTrailPoints = options.maxTrailPoints
    this.onReleased = options.onReleased

    const material = new THREE.MeshStandardMaterial({
      color: options.color ?? 0xf59e0b,
      emissive: 0x000000
    })

    this.mesh = new THREE.Mesh(
      new THREE.SphereGeometry(this.radius, 24, 24),
      material
    )
    this.mesh.position.copy(options.initialPosition)

    this.trail = new THREE.Line(
      new THREE.BufferGeometry(),
      new THREE.LineBasicMaterial({
        color: options.color ?? 0xfbbf24,
        transparent: true,
        opacity: 0.8
      })
    )

    this.resetTrail()
    this.updateAppearance()

    this.grabTarget = {
      object: this.mesh,
      holdOffset: DEFAULT_HOLD_OFFSET,
      onHoverChange: (hovered) => {
        this.hovered = hovered
        this.updateAppearance()
      },
      onGrabStart: () => {
        this.grabbed = true
        this.velocity.set(0, 0, 0)
        this.resetTrail()
        this.updateAppearance()
      },
      onGrabEnd: (controller) => {
        this.grabbed = false
        this.updateAppearance()
        this.onReleased?.(controller, this)
      }
    }
  }

  get position() {
    return this.mesh.position
  }

  get isGrabbed() {
    return this.grabbed
  }

  isExpired() {
    return !this.grabbed && this.ageSeconds > this.lifetimeSeconds
  }

  setVelocity(nextVelocity: THREE.Vector3) {
    this.velocity.copy(nextVelocity)
  }

  step(config: BallStepConfig) {
    if (this.grabbed) {
      return
    }

    this.ageSeconds += config.deltaSeconds
    advanceBallState(
      {
        position: this.position,
        velocity: this.velocity,
        radius: this.radius
      },
      config
    )
    this.appendTrailPoint()
  }

  dispose() {
    this.mesh.parent?.remove(this.mesh)
    this.trail.parent?.remove(this.trail)
    this.mesh.geometry.dispose()
    this.mesh.material.dispose()
    this.trail.geometry.dispose()
    this.trail.material.dispose()
  }

  private resetTrail() {
    this.trailPoints.length = 0
    this.trailPoints.push(this.position.clone())
    this.trail.geometry.setFromPoints(this.trailPoints)
  }

  private appendTrailPoint() {
    this.trailPoints.push(this.position.clone())

    while (this.trailPoints.length > this.maxTrailPoints) {
      this.trailPoints.shift()
    }

    this.trail.geometry.setFromPoints(this.trailPoints)
  }

  private updateAppearance() {
    this.mesh.material.emissive.setHex(
      this.grabbed ? 0x5b3410 : this.hovered ? 0x3a2507 : 0x000000
    )
  }
}
