import * as THREE from 'three'
import { crossThrowTarget, getThrowTargetLayout } from '../gameplay/throwTarget'
import { computeEarthGhostPath } from '../gameplay/earthGhost'
import type { Ball } from './ball'
import type { TourCard } from '../app/tourGuide'
import { civicSign } from './civicSign'

type Attempt = { previous: THREE.Vector3; earthHit: boolean }

// Stable identities matter: the HUD repaints/uploads only when its card changes.
const PRACTICE_CARDS: TourCard[][] = [false, true].map(xr => [false, true].map(hit => ({
  title: 'BALL PRACTICE', body: [xr
    ? 'Aim above the hoop. Hold the trigger, then release.'
    : 'Aim above the hoop and click or tap to throw.',
  hit ? 'Try Speed: Slow and a higher arc.' : 'The dashed path shows the same throw on Earth.'], durationSeconds: 1
})))

// A visual scoring gate, not a solid collider: failed throws keep their real
// trajectory, making the Earth ghost comparison readable through the ring.
export class ThrowTarget {
  readonly group = new THREE.Group()
  private readonly ringMaterial = new THREE.MeshStandardMaterial({ color: 0xd8c59a, roughness: .72, metalness: .25 })
  private readonly ring = new THREE.Mesh(new THREE.TorusGeometry(.64, .04, 8, 48), this.ringMaterial)
  private readonly equipment = new THREE.Group()
  private readonly frameMaterial = new THREE.MeshStandardMaterial({ color: 0x455951, roughness: .78, metalness: .25 })
  private readonly pavingMaterial = new THREE.MeshStandardMaterial({ color: 0xb6ad96, roughness: 1 })
  private readonly sign = civicSign('THROWING LAWN', ['Ball practice · 8 m', 'Keep the lane clear'], 1.3)
  private feedback: TourCard | null = null
  private attempts = new WeakMap<Ball, Attempt>()
  private layout = getThrowTargetLayout(3200)
  private radius = 0
  private remaining = 0
  hasHit = false
  private xrActive = false

  constructor(parent: THREE.Group, private readonly onHit: () => void = () => {}) {
    this.group.name = 'public-throwing-lawn'
    this.equipment.add(this.ring)
    const box = (w: number, h: number, d: number, x: number, y: number, z: number, material = this.frameMaterial) => {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material)
      mesh.position.set(x, y, z); this.equipment.add(mesh)
    }
    this.ring.position.set(0, 1.8, -8)
    // Two feet and a cross-member visibly carry the target. The aperture
    // remains a scoring plane: do not fabricate an invisible solid disk.
    for (const x of [-.92, .92]) {
      box(.09, 2.15, .09, x, 1.075, -8)
      box(.4, .09, .7, x, .045, -8, this.pavingMaterial)
    }
    box(1.84, .08, .08, 0, 1.12, -8)
    box(.26, .07, .08, -.78, 1.8, -8)
    box(.26, .07, .08, .78, 1.8, -8)
    box(2.8, .035, 2.4, 0, .04, 0, this.pavingMaterial)
    box(2.2, .012, .06, 0, .064, -.8)
    this.sign.position.set(2.35, 0, .3)
    this.equipment.add(this.sign); this.group.add(this.equipment)
    parent.add(this.group)
    this.reset()
  }

  reset() {
    this.attempts = new WeakMap()
    this.remaining = 0
    this.showPrompt()
  }

  configure(radius: number, xrActive = false, origin: { azimuth: number; axial: number } | null = { azimuth: 0, axial: 0 }) {
    this.xrActive = xrActive
    this.group.visible = origin !== null
    if (!origin) return
    if (this.radius === radius && this.layout.azimuth === origin.azimuth && this.layout.start.y === origin.axial) return
    this.radius = radius
    this.layout = getThrowTargetLayout(radius, origin)
    const c = Math.cos(origin.azimuth), s = Math.sin(origin.azimuth)
    this.equipment.matrixAutoUpdate = false
    // +Z points back toward the thrower, -Z down the axial lane.
    this.equipment.matrix.makeBasis(new THREE.Vector3(s, 0, -c), new THREE.Vector3(-c, 0, -s), new THREE.Vector3(0, 1, 0))
      .setPosition(c * radius, origin.axial, s * radius)
    this.group.userData.layout = this.layout
    this.reset()
  }

  getCard(position: THREE.Vector3, usingBall: boolean): TourCard | null {
    if (!this.group.visible || position.distanceTo(this.layout.start) > 5) return null
    if (this.remaining > 0) return this.feedback
    if (!usingBall) return null
    return PRACTICE_CARDS[Number(this.xrActive)][Number(this.hasHit)]
  }

  track(ball: Ball, velocity: THREE.Vector3, omega: number) {
    // Only throws from the starting area are challenges; free exploration and
    // throws from behind the ring should not replace the sign's feedback.
    if (!this.group.visible || ball.position.distanceTo(this.layout.start) > 4 || velocity.dot(this.layout.normal) >= 0) return
    this.remaining = 8
    this.show('IN FLIGHT', 'Watch the ball and its dashed Earth path.', 0xd8c59a)
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
    this.show('TRY AGAIN', 'Aim a little higher and try again.', 0xfbbf24)
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

  private showPrompt() { this.feedback = null }

  private nextChallenge() { return 'Try a slower throw with a higher arc.' }

  private show(title: string, body: string, _color: number) {
    this.feedback = { title, body: [body], durationSeconds: 6 }
  }

  dispose() {
    this.sign.userData.dispose()
    this.equipment.traverse(o => { if (o instanceof THREE.Mesh) o.geometry.dispose() })
    this.ringMaterial.dispose(); this.frameMaterial.dispose(); this.pavingMaterial.dispose()
    this.group.removeFromParent()
  }
}
