import { describe, expect, test } from 'bun:test'
import * as THREE from 'three'
import { BALL_THROW_SPEEDS, crossThrowTarget, getThrowTargetLayout } from './throwTarget'
import { computeEarthGhostPath } from './earthGhost'
import { inertialPositionToRotating, rotatingVelocityToInertial } from '../sim/frameTransforms'

describe('throw target sweep', () => {
  const layout = getThrowTargetLayout(3200)
  const point = (x: number, y: number) => layout.center.clone().add(new THREE.Vector3(x, y, 0))

  test('fast front-to-back throws score even between frames', () => {
    expect(crossThrowTarget(point(0, 10), point(0, -10), 0.18, layout)?.hit).toBe(true)
  })

  test('a ball clipping the rim misses although its center is in the hole', () => {
    expect(crossThrowTarget(point(0.5, 1), point(0.5, -1), 0.18, layout)?.hit).toBe(false)
  })

  test('reverse, parallel and already-passed segments do not score', () => {
    expect(crossThrowTarget(point(0, -1), point(0, 1), 0.18, layout)).toBeNull()
    expect(crossThrowTarget(point(0, 1), point(1, 1), 0.18, layout)).toBeNull()
    expect(crossThrowTarget(point(0, -1), point(0, -2), 0.18, layout)).toBeNull()
  })

  test('target stays above the floor and faces the initial axial view at every scale', () => {
    for (const radius of [10, 18, 3200, 30000]) {
      const target = getThrowTargetLayout(radius)
      expect(radius - Math.hypot(target.center.x, target.center.z)).toBeCloseTo(1.8)
      expect(target.center.y).toBe(-8)
      expect(target.normal.y).toBe(1)
    }
  })
})

// Independent inertial straight-line flight: prove the gate is reachable and
// that the same goal can distinguish an Earth prediction from a colony throw.
test.each(Object.values(BALL_THROW_SPEEDS))('Izma target is reachable at %d m/s from the PC eye height', (speed) => {
  const radius = 3200
  const omega = Math.sqrt(9.81 / radius)
  const target = getThrowTargetLayout(radius)
  const start = new THREE.Vector3(radius - 1.8, -0.35, 0)
  let reachable = false
  let revealsSpin = false
  for (let degrees = 5; degrees <= 80; degrees++) {
    const angle = degrees * Math.PI / 180
    const velocity = new THREE.Vector3(-speed * Math.sin(angle), -speed * Math.cos(angle), 0)
    const inertialVelocity = rotatingVelocityToInertial(start, velocity, omega, 0)
    let previous = start.clone()
    let realHit = false
    for (let t = 1 / 120; t < 4; t += 1 / 120) {
      const position = inertialPositionToRotating(start.clone().addScaledVector(inertialVelocity, t), omega * t)
      if (Math.hypot(position.x, position.z) > radius - 0.18) break
      const crossing = crossThrowTarget(previous, position, 0.18, target)
      if (crossing !== null) { realHit = crossing.hit; break }
      previous = position
    }
    const ghost = computeEarthGhostPath(start, velocity, omega, radius)
    const earthHit = ghost.some((p, i) => i > 0 && crossThrowTarget(ghost[i - 1], p, 0.18, target)?.hit)
    reachable ||= realHit
    revealsSpin ||= earthHit && !realHit
  }
  expect(reachable).toBe(true)
  if (speed === BALL_THROW_SPEEDS.slow) expect(revealsSpin).toBe(true)
})
