import { describe, expect, test } from 'bun:test'
import * as THREE from 'three'
import { LAMP_SPACING_ARTERIAL, LAMP_SPACING_LOCAL, lampArmQuaternion, planLampSpots, selectNearbyLamps } from './streetLamps'
import type { CityIntersection, CityRoad } from './cityLayout'

const R = 3200
const avenue: CityRoad = { azimuth: 0.05, axial: 0, tangentWidth: 24, axialLength: 1000, kind: 'arterial' }
const street: CityRoad = { azimuth: 0, axial: 200, tangentWidth: 600, axialLength: 8, kind: 'local' }
const alley: CityRoad = { azimuth: 0.02, axial: 100, tangentWidth: 7.5, axialLength: 60, kind: 'alley' }
const crossing: CityIntersection = { azimuth: 0.05, axial: 200, avenueKind: 'arterial', streetKind: 'local', avenueWidth: 24, streetWidth: 8 }

describe('planLampSpots', () => {
  test('spaces lamps along each grid road, alternating kerbs, none in a crossing', () => {
    const spots = planLampSpots([avenue, street, alley], [crossing], R)
    const onAvenue = spots.filter((s) => s.isAvenue)
    const onStreet = spots.filter((s) => !s.isAvenue)
    expect(onAvenue.length).toBeGreaterThan(1000 / LAMP_SPACING_ARTERIAL - 3)
    expect(onStreet.length).toBeGreaterThan(600 / LAMP_SPACING_LOCAL - 3)
    expect(spots.some((s) => Math.abs(s.azimuth - alley.azimuth) < 1e-9 && Math.abs(s.axial - alley.axial) < 60)).toBe(false)
    // alternating sides
    for (let i = 1; i < onAvenue.length; i++) expect(onAvenue[i].side).toBe(-onAvenue[i - 1].side as 1 | -1)
    // clear of the crossing box on the avenue (street half width 4 + clearance 7)
    for (const s of onAvenue) expect(Math.abs(s.axial - 200)).toBeGreaterThan(4 + 7 - 1e-9)
    for (const s of onStreet) expect(Math.abs((s.azimuth - street.azimuth) * R - avenue.azimuth * R)).toBeGreaterThan(12 + 7 - 1e-9)
  })

  test('selectNearbyLamps keeps only spots within the surface range', () => {
    const spots = planLampSpots([avenue], [], R)
    const near = selectNearbyLamps(spots, R, avenue.azimuth, 0, 100)
    expect(near.length).toBeGreaterThan(0)
    for (const s of near) expect(Math.abs(s.axial)).toBeLessThanOrEqual(100)
    expect(selectNearbyLamps(spots, R, avenue.azimuth + 1, 0, 100).length).toBe(0)
  })
})

describe('lampArmQuaternion', () => {
  // Rotating frame, axis = +Y. A lamp at azimuth θ stands on the inner wall at
  // (cos θ, ·, sin θ)·r; inward (local up) is (−cos θ, 0, −sin θ) and the
  // tangent is (−sin θ, 0, cos θ). The arm's +Y must run horizontally over
  // the road: −side·tangent on avenues, −side·axial on streets — never along
  // the cylinder axis (2026-09-09: every arm pointed at the colony's end).
  const azimuths = [0, 0.05, Math.PI / 2, 2.1, Math.PI, -1.3]
  const y = new THREE.Vector3(0, 1, 0)
  const z = new THREE.Vector3(0, 0, 1)
  const x = new THREE.Vector3(1, 0, 0)

  test('avenue arms reach tangentially across the road, streets arms axially', () => {
    for (const azimuth of azimuths) {
      const inward = new THREE.Vector3(-Math.cos(azimuth), 0, -Math.sin(azimuth))
      const tangent = new THREE.Vector3(-Math.sin(azimuth), 0, Math.cos(azimuth))
      for (const side of [1, -1] as const) {
        const q = lampArmQuaternion(azimuth, true, side)
        expect(Math.abs(q.length() - 1)).toBeLessThan(1e-9)
        const along = y.clone().applyQuaternion(q)
        expect(along.distanceTo(tangent.clone().multiplyScalar(-side))).toBeLessThan(1e-9)
        expect(Math.abs(along.y)).toBeLessThan(1e-9)
        // local up stays the habitat's up (arm is horizontal, not tilted)
        expect(z.clone().applyQuaternion(q).distanceTo(inward)).toBeLessThan(1e-9)

        const qs = lampArmQuaternion(azimuth, false, side)
        const alongStreet = y.clone().applyQuaternion(qs)
        expect(alongStreet.distanceTo(new THREE.Vector3(0, -side, 0))).toBeLessThan(1e-9)
        expect(z.clone().applyQuaternion(qs).distanceTo(inward)).toBeLessThan(1e-9)
      }
    }
  })

  test('is a proper rotation (right-handed frame, not a mirror image)', () => {
    for (const azimuth of azimuths) {
      for (const isAvenue of [true, false]) {
        const q = lampArmQuaternion(azimuth, isAvenue, 1)
        const ex = x.clone().applyQuaternion(q)
        const ey = y.clone().applyQuaternion(q)
        const ez = z.clone().applyQuaternion(q)
        expect(ex.clone().cross(ey).distanceTo(ez)).toBeLessThan(1e-9)
      }
    }
  })
})
