import { expect, test } from 'bun:test'
import * as THREE from 'three'
import { PlayerBodyMotion, solveBodyLeg, solveBodyArm } from './playerBodyMotion'

test('standing and modest head turns keep both feet planted without footsteps', () => {
  const motion = new PlayerBodyMotion()
  const frame = { radius: 3200, azimuth: .12, axial: -200, heading: 0, grounded: true, deltaSeconds: 1 / 60 }
  motion.update(frame)
  const anchors = motion.feet.map(f => ({ ...f }))
  for (let n = 0; n < 600; n++) expect(motion.update({ ...frame, heading: Math.sin(n / 50) * .6 })).toBe(false)
  expect(motion.feet).toEqual(anchors)
  expect(motion.steps).toBe(0)
})

test('walking preserves stance anchors, alternates feet and settles after stopping', () => {
  for (const speed of [.8, 1.5, 3, 5]) {
    const motion = new PlayerBodyMotion()
    const frame = { radius: 3200, azimuth: .1, axial: 0, heading: 0, grounded: true, deltaSeconds: 1 / 60 }
    motion.update(frame)
    const contacts: number[] = []
    let maxReach = 0
    for (let n = 0; n < 360; n++) {
      const before = motion.feet.map(f => ({ ...f }))
      if (n < 240) frame.axial += speed / 60
      motion.update(frame)
      for (let i = 0; i < 2; i++) {
        const f = motion.feet[i]
        if (before[i].planted && f.planted) {
          expect(f.tangent).toBe(before[i].tangent)
          expect(f.axial).toBe(before[i].axial)
          expect(f.lift).toBe(0)
        }
        if (!before[i].planted && f.planted) contacts.push(i)
        maxReach = Math.max(maxReach, Math.hypot(f.tangent - motion.tangent, f.axial - motion.axial))
      }
      expect(motion.feet.filter(f => !f.planted).length).toBeLessThanOrEqual(1)
    }
    expect(contacts.length).toBeGreaterThan(3)
    expect(motion.feet.every(f => f.planted)).toBe(true)
    expect(maxReach).toBeLessThan(.95)
  }
})

test('wrap seam, teleports and leaving the ground never manufacture landing steps', () => {
  const motion = new PlayerBodyMotion()
  const frame = { radius: 180, azimuth: Math.PI - .0001, axial: 0, heading: 0, grounded: true, deltaSeconds: 1 / 60 }
  motion.update(frame)
  const t = motion.tangent
  motion.update({ ...frame, azimuth: -Math.PI + .0001 })
  expect(motion.tangent - t).toBeCloseTo(.036)
  const steps = motion.steps
  expect(motion.update({ ...frame, axial: 400 })).toBe(false)
  expect(motion.steps).toBe(steps)
  for (let n = 0; n < 60; n++) expect(motion.update({ ...frame, axial: 400 + n * .1, grounded: false })).toBe(false)
  expect(motion.update({ ...frame, axial: 406 })).toBe(false)
  expect(motion.feet.every(f => f.planted)).toBe(true)
})

test('leg solver preserves both segment lengths and places reachable ankle targets', () => {
  const pelvis = new THREE.Group(), hip = new THREE.Group(), knee = new THREE.Group(), ankle = new THREE.Group()
  pelvis.position.y = .86; hip.position.set(-.112, -.045, 0); knee.position.y = -.43; ankle.position.y = -.41
  pelvis.add(hip); hip.add(knee); knee.add(ankle)
  for (const target of [new THREE.Vector3(-.112, .055, 0), new THREE.Vector3(-.14, .08, .25), new THREE.Vector3(-.2, .16, -.3)]) {
    solveBodyLeg(hip, knee, target)
    pelvis.updateMatrixWorld(true)
    expect(ankle.getWorldPosition(new THREE.Vector3()).distanceTo(target)).toBeLessThan(1e-6)
    expect(knee.getWorldPosition(new THREE.Vector3()).distanceTo(hip.getWorldPosition(new THREE.Vector3()))).toBeCloseTo(.43, 7)
  }
})

test('tracked arms reach ordinary and extended grips while rejecting extreme targets', () => {
  for (const side of [-1, 1] as const) for (const target of [new THREE.Vector3(side * .2, .05, .3), new THREE.Vector3(side * .32, .2, .56)]) {
    const torso = new THREE.Group(), shoulder = new THREE.Group(), elbow = new THREE.Group(), palm = new THREE.Group()
    shoulder.position.set(side * .207, .376, 0); elbow.position.y = -.282; palm.position.y = -.249
    torso.add(shoulder); shoulder.add(elbow); elbow.add(palm)
    expect(solveBodyArm(shoulder, elbow, target, side)).toBe(true)
    const ratio = elbow.position.y / -.282
    palm.position.y = -.249 * ratio
    torso.updateMatrixWorld(true)
    expect(palm.getWorldPosition(new THREE.Vector3()).distanceTo(target)).toBeLessThan(1e-6)
    expect(ratio).toBeLessThanOrEqual(1.16)
    expect(solveBodyArm(shoulder, elbow, new THREE.Vector3(side * 1.5, 1, 1), side)).toBe(false)
  }
})
