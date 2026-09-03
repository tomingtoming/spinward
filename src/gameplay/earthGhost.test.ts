import { describe, expect, test } from 'bun:test'
import * as THREE from 'three'
import { computeEarthGhostPath, feltGravityAt } from './earthGhost'

const R = 3200
const omega = Math.sqrt(9.81 / R) // 1 g at the floor

describe('earth ghost', () => {
  test('felt gravity is ω²r', () => {
    expect(feltGravityAt(new THREE.Vector3(R, 0, 0), omega)).toBeCloseTo(9.81, 6)
    expect(feltGravityAt(new THREE.Vector3(R * 0.5, 100, 0), omega)).toBeCloseTo(9.81 * 0.5, 6)
  })

  test('a dropped ball lands after sqrt(2h/g) straight below the release point', () => {
    const h = 20
    const start = new THREE.Vector3(R - h, 0, 0)
    const path = computeEarthGhostPath(start, new THREE.Vector3(), omega, R, { dt: 1 / 120 })
    const end = path[path.length - 1]
    expect(end.x).toBeCloseTo(R, 1)
    expect(end.y).toBeCloseTo(0, 6)
    expect(end.z).toBeCloseTo(0, 6)
    const seconds = (path.length - 1) / 120
    expect(seconds).toBeCloseTo(Math.sqrt((2 * h) / 9.81), 1)
  })

  test('a level throw is a flat-Earth parabola: no sideways (Coriolis) drift, range v·t', () => {
    const h = 1.6
    const start = new THREE.Vector3(R - h, 0, 0)
    const v = 20
    // Along the axis (+y), level.
    const path = computeEarthGhostPath(start, new THREE.Vector3(0, v, 0), omega, R, { dt: 1 / 240 })
    const end = path[path.length - 1]
    const tFall = Math.sqrt((2 * h) / 9.81)
    expect(end.y).toBeCloseTo(v * tFall, 0)
    expect(end.z).toBeCloseTo(0, 6) // Earth intuition never curves sideways
    expect(end.x).toBeCloseTo(R, 2) // ends on the floor line
    for (const p of path) expect(p.x).toBeLessThanOrEqual(R + 1e-6)
  })

  test('caps by time and point count, and returns the release point for degenerate input', () => {
    const start = new THREE.Vector3(R - 500, 0, 0)
    const up = new THREE.Vector3(-200, 0, 0) // thrown hard toward the axis
    const capped = computeEarthGhostPath(start, up, omega, R, { dt: 0.1, maxSeconds: 1, maxPoints: 1000 })
    // 1 s at dt 0.1 → 10 steps (+ release); float accumulation may allow one more.
    expect(capped.length).toBeGreaterThanOrEqual(11)
    expect(capped.length).toBeLessThanOrEqual(12)
    const few = computeEarthGhostPath(start, up, omega, R, { maxPoints: 5 })
    expect(few.length).toBe(5)
    expect(computeEarthGhostPath(new THREE.Vector3(0, 0, 0), up, omega, R).length).toBe(1)
  })
})
