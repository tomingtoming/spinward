import { expect, test } from 'bun:test'
import * as THREE from 'three'
import { beaconFlash, robotPose, WINDOW_ROBOT, WindowRobots, type WindowStrip } from './windowRobots'

const R = 3200, half = Math.PI / 6 * R
const strip: WindowStrip = { arc0: -(half + 2 * half), arc1: -half, axial0: -20000, axial1: 20000, floor: -16 }

test('robots sweep their cells continuously, inside the window, clear of the viaduct pier lines', () => {
  const cells = Math.ceil((strip.arc1 - strip.arc0) / WINDOW_ROBOT.cell)
  let robots = 0
  for (const i of [0, 3, cells - 2, cells - 1]) for (const j of [0, 47, 159]) {
    let previous = robotPose(strip, 1, i, j, 0)
    if (!previous) continue
    robots++
    for (let t = .5; t < 20000; t += .5) {
      const p = robotPose(strip, 1, i, j, t)!
      // No jumps: at most the distance travelled in half a second (plus float slack).
      expect(Math.hypot(p.arc - previous.arc, p.axial - previous.axial)).toBeLessThan(WINDOW_ROBOT.speed * .5 + 1e-6)
      expect(p.arc).toBeGreaterThan(strip.arc0 + WINDOW_ROBOT.halfWidth); expect(p.arc).toBeLessThan(strip.arc1)
      expect(p.axial).toBeGreaterThanOrEqual(strip.axial0 + j * WINDOW_ROBOT.cell + WINDOW_ROBOT.margin - 1e-6)
      expect(p.axial).toBeLessThanOrEqual(strip.axial0 + (j + 1) * WINDOW_ROBOT.cell - WINDOW_ROBOT.margin + 1e-6)
      // Lanes keep clear of every pier line; lane changes happen at cell ends only.
      if (p.heading[0] === 0) {
        const fromEdge = strip.arc1 - p.arc, pier = fromEdge - Math.round(fromEdge / 50) * 50
        expect(Math.abs(pier)).toBeGreaterThan(WINDOW_ROBOT.halfWidth + WINDOW_ROBOT.pier)
      }
      previous = p
    }
  }
  expect(robots).toBeGreaterThanOrEqual(10)
})

test('robot phases differ between cells and windows', () => {
  const a = robotPose(strip, 0, 2, 5, 100)!, b = robotPose(strip, 0, 3, 5, 100)!, c = robotPose(strip, 1, 2, 5, 100)!
  expect(new Set([a.axial - 5 * WINDOW_ROBOT.cell, b.axial - 5 * WINDOW_ROBOT.cell, c.axial - 5 * WINDOW_ROBOT.cell].map(v => v.toFixed(1))).size).toBeGreaterThan(1)
})

test('night lights: beacons flash locally, position lamps stay steady and appear only at night', () => {
  let low = 1, high = 0
  for (let t = 0; t < 2.2; t += .01) { const b = beaconFlash(t, .3); low = Math.min(low, b); high = Math.max(high, b) }
  expect(low).toBeCloseTo(.25, 2); expect(high).toBeCloseTo(1, 2)
  const R = 3200, strips = [0, 1, 2].map(band => { const arc1 = -(band * Math.PI * 2 / 3 * R + half); return { ...strip, arc0: arc1 - 2 * half, arc1 } })
  const robots = new WindowRobots(new THREE.Group(), strips, R)
  const far = robots.group.getObjectByName('window-robot-position-lamps') as THREE.Points
  expect(robots.positionLamps).toBeGreaterThan(6000)
  robots.setDaylight(1); expect(far.visible).toBe(false)
  robots.setDaylight(0); expect(far.visible).toBe(true)
  // Every lamp sits on a window, just above the glass.
  const p = far.geometry.getAttribute('position')
  for (let k = 0; k < robots.positionLamps; k += 37) {
    const r = Math.hypot(p.getX(k), p.getZ(k)), arc = Math.atan2(p.getZ(k), p.getX(k)) * R
    expect(r).toBeCloseTo(R + 16 - .86, 3)
    expect(strips.some(s => [0, -1, 1].some(m => arc + m * 2 * Math.PI * R > s.arc0 && arc + m * 2 * Math.PI * R < s.arc1))).toBe(true)
  }
  robots.dispose()
})
