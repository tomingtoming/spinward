import { describe, expect, test } from 'bun:test'
import * as THREE from 'three'
import {
  crossingQuaternionFor,
  layoutIntersection,
  selectNearbyIntersections,
  signalAspect,
  STRIPE_LENGTH,
  SIGNAL_CYCLE_SECONDS
} from './intersectionFurniture'
import type { CityIntersection } from './cityLayout'

const R = 3200
const arterialCross: CityIntersection = { azimuth: 0.1, axial: 500, avenueKind: 'arterial', streetKind: 'local', avenueWidth: 18, streetWidth: 10 }
const quietCross: CityIntersection = { azimuth: 0.1, axial: 500, avenueKind: 'local', streetKind: 'local', avenueWidth: 10, streetWidth: 10 }

describe('layoutIntersection', () => {
  test('crosswalk bars sit outside the junction box on all four legs', () => {
    const layout = layoutIntersection(arterialCross, R)
    // avenue legs: bars run axially (yaw 0) beyond ±(streetWidth/2 + setback)
    const avenueLegs = layout.stripes.filter((s) => s.yaw === 0)
    const streetLegs = layout.stripes.filter((s) => s.yaw !== 0)
    expect(avenueLegs.length).toBeGreaterThan(0)
    expect(streetLegs.length).toBeGreaterThan(0)
    for (const s of avenueLegs) {
      expect(Math.abs(s.a)).toBeGreaterThan(5 + STRIPE_LENGTH * 0.5)
      expect(Math.abs(s.t)).toBeLessThan(9)
    }
    for (const s of streetLegs) {
      expect(Math.abs(s.t)).toBeGreaterThan(9 + STRIPE_LENGTH * 0.5)
      expect(Math.abs(s.a)).toBeLessThan(5)
    }
    // bars across the 18 m avenue outnumber bars across the 10 m street
    expect(avenueLegs.length).toBeGreaterThan(streetLegs.length)
  })

  test('arterial crossings get four signal poles with arms and heads; quiet ones get two sign posts', () => {
    const signalled = layoutIntersection(arterialCross, R)
    expect(signalled.signalled).toBe(true)
    expect(signalled.poles.length).toBe(4)
    expect(signalled.arms.length).toBe(4)
    expect(signalled.heads.length).toBe(4)
    expect(signalled.plates.length).toBe(0)
    // poles stand clear of both roads
    for (const p of signalled.poles) {
      expect(Math.abs(p.t)).toBeGreaterThan(9)
      expect(Math.abs(p.a)).toBeGreaterThan(5)
    }
    const quiet = layoutIntersection(quietCross, R)
    expect(quiet.signalled).toBe(false)
    expect(quiet.poles.length).toBe(2)
    expect(quiet.plates.length).toBe(2)
    expect(quiet.heads.length).toBe(0)
  })
})

describe('selectNearbyIntersections', () => {
  test('keeps crossings within the surface range and wraps the azimuth seam', () => {
    const all: CityIntersection[] = [
      { ...quietCross, azimuth: 0.001, axial: 0 },
      { ...quietCross, azimuth: Math.PI * 2 - 0.001, axial: 0 }, // just across the seam
      { ...quietCross, azimuth: 0.5, axial: 0 }, // 1600 m away tangentially
      { ...quietCross, azimuth: 0, axial: 3000 } // far axially
    ]
    const near = selectNearbyIntersections(all, R, 0, 0, 400)
    expect(near.length).toBe(2)
  })
})

describe('signalAspect', () => {
  test('cycles green → amber → red with the offset and never leaves the range', () => {
    expect(signalAspect(0, 0)).toBe(0)
    expect(signalAspect(11, 0)).toBe(1)
    expect(signalAspect(20, 0)).toBe(2)
    expect(signalAspect(SIGNAL_CYCLE_SECONDS, 0)).toBe(0)
    for (let s = -50; s < 50; s += 0.7) {
      expect([0, 1, 2]).toContain(signalAspect(s, 7.3))
    }
  })
})

describe('crossingQuaternionFor', () => {
  test('is a proper rotation: local Z → axial, local Y → inward, unit length', () => {
    for (const azimuth of [0, 0.7, Math.PI, -2.1]) {
      const q = crossingQuaternionFor(azimuth)
      expect(q.length()).toBeCloseTo(1, 9)
      const z = new THREE.Vector3(0, 0, 1).applyQuaternion(q)
      const y = new THREE.Vector3(0, 1, 0).applyQuaternion(q)
      expect(z.x).toBeCloseTo(0, 6)
      expect(z.y).toBeCloseTo(1, 6)
      expect(y.x).toBeCloseTo(-Math.cos(azimuth), 6)
      expect(y.z).toBeCloseTo(-Math.sin(azimuth), 6)
      expect(y.y).toBeCloseTo(0, 6)
    }
  })
})
