import * as THREE from 'three'
import { crossThrowTarget, getThrowTargetLayout } from '../gameplay/throwTarget'
import { computeEarthGhostPath } from '../gameplay/earthGhost'
import type { Ball } from './ball'

type Attempt = { previous: THREE.Vector3; earthHit: boolean }

// A visual scoring gate, not a solid collider: failed throws keep their real
// trajectory, making the Earth ghost comparison readable through the ring.
export class ThrowTarget {
  readonly group = new THREE.Group()
  private readonly ringMaterial = new THREE.MeshBasicMaterial({ color: 0x67e8f9 })
  private readonly ring = new THREE.Mesh(new THREE.TorusGeometry(0.64, 0.04, 8, 64), this.ringMaterial)
  private readonly canvas = document.createElement('canvas')
  private readonly texture = new THREE.CanvasTexture(this.canvas)
  private readonly labelMaterial = new THREE.SpriteMaterial({ map: this.texture, depthTest: true })
  private readonly label = new THREE.Sprite(this.labelMaterial)
  private attempts = new WeakMap<Ball, Attempt>()
  private layout = getThrowTargetLayout(3200)
  private radius = 0
  private remaining = 0
  hasHit = false
  private xrActive = false

  constructor(parent: THREE.Group, private readonly onHit: () => void = () => {}) {
    this.canvas.width = 1024
    this.canvas.height = 256
    this.texture.colorSpace = THREE.SRGBColorSpace
    this.label.scale.set(5, 1.25, 1)
    this.group.add(this.ring, this.label)
    parent.add(this.group)
    this.reset()
  }

  reset() {
    this.attempts = new WeakMap()
    this.remaining = 0
    this.showPrompt()
  }

  configure(radius: number, xrActive = false) {
    if (this.xrActive !== xrActive) {
      this.xrActive = xrActive
      this.showPrompt()
    }
    if (this.radius === radius) return
    this.radius = radius
    this.layout = getThrowTargetLayout(radius)
    this.ring.position.copy(this.layout.center)
    this.ring.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), this.layout.normal)
    this.label.position.copy(this.layout.center).addScaledVector(
      new THREE.Vector3(-Math.cos(this.layout.azimuth), 0, -Math.sin(this.layout.azimuth)), 1.55
    )
    this.reset()
  }

  track(ball: Ball, velocity: THREE.Vector3, omega: number) {
    // Only throws from the starting area are challenges; free exploration and
    // throws from behind the ring should not replace the sign's feedback.
    const start = new THREE.Vector3(this.radius - 1.6, 0, 0)
    if (ball.position.distanceTo(start) > 4 || velocity.dot(this.layout.normal) >= 0) return
    const path = computeEarthGhostPath(ball.position, velocity, omega, this.radius)
    let earthHit = false
    for (let i = 1; i < path.length; i++) {
      const crossing = crossThrowTarget(path[i - 1], path[i], ball.radius, this.layout)
      if (crossing !== null) {
        earthHit = crossing.hit
        break
      }
    }
    this.attempts.set(ball, { previous: ball.position.clone(), earthHit })
  }

  bounced(ball: Ball) {
    if (!this.attempts.has(ball)) return
    this.attempts.delete(ball)
    this.remaining = 6
    this.show('TRY AGAIN', 'Aim a little higher. Surface returns you here.', 0xfbbf24)
  }

  step(balls: readonly Ball[], deltaSeconds: number) {
    if (this.remaining > 0) {
      this.remaining -= deltaSeconds
      if (this.remaining <= 0) this.showPrompt()
    }
    for (const ball of balls) {
      const attempt = this.attempts.get(ball)
      if (attempt === undefined) continue
      if (ball.isGrabbed || ball.isExpired()) {
        this.attempts.delete(ball)
        continue
      }
      const crossing = crossThrowTarget(attempt.previous, ball.position, ball.radius, this.layout)
      attempt.previous.copy(ball.position)
      if (crossing === null) continue
      this.attempts.delete(ball)
      this.remaining = 6
      if (crossing.hit) {
        this.hasHit = true
        this.onHit()
      }
      this.show(
        crossing.hit ? 'THROUGH!' : 'MISSED — TRY AGAIN',
        attempt.earthHit
          ? crossing.hit ? this.nextChallenge() : 'The dashed Earth path clears it. This world is turning.'
          : crossing.hit ? 'Earth would miss. You found a different trajectory.' : 'Earth misses too. Adjust your aim and throw again.',
        crossing.hit ? 0x86efac : 0xfbbf24
      )
    }
  }

  private showPrompt() {
    this.show(
      this.hasHit ? 'CAN YOU DO IT WITH A HIGH ARC?' : 'THROUGH THE RING',
      this.hasHit ? this.nextChallenge() : this.xrActive
        ? 'Aim a little high. Hold the trigger, then release.'
        : 'Choose Ball below. Aim a little high and click or tap.',
      0x67e8f9
    )
  }

  private nextChallenge() {
    return this.xrActive
      ? 'Try a slower throw with a higher arc.'
      : 'Choose Speed: Slow below (Esc frees the mouse). Aim higher.'
  }

  private show(title: string, body: string, color: number) {
    this.ringMaterial.color.setHex(color)
    const ctx = this.canvas.getContext('2d')
    if (ctx === null) return
    ctx.clearRect(0, 0, 1024, 256)
    ctx.fillStyle = 'rgba(6, 13, 21, 0.88)'
    ctx.fillRect(0, 0, 1024, 256)
    ctx.textAlign = 'center'
    ctx.fillStyle = `#${color.toString(16).padStart(6, '0')}`
    ctx.font = 'bold 54px sans-serif'
    ctx.fillText(title, 512, 95)
    ctx.fillStyle = '#edf4f8'
    ctx.font = '30px sans-serif'
    ctx.fillText(body, 512, 165, 960)
    this.texture.needsUpdate = true
  }

  dispose() {
    this.group.removeFromParent()
    this.ring.geometry.dispose()
    this.ringMaterial.dispose()
    this.texture.dispose()
    this.labelMaterial.dispose()
  }
}
