import { expect, test } from 'bun:test'
import * as THREE from 'three'
import { beaconFlash, robotPose, WINDOW_ROBOT, WindowRobots, wiperLanes, type WindowStrip } from './windowRobots'

const R = 3200, half = Math.PI / 6 * R
const strip: WindowStrip = { arc0: -(half + 2 * half), arc1: -half, axial0: -20000, axial1: 20000, floor: -16 }

test('wipers sweep their sections continuously, inside the window, between the viaduct pier lines', () => {
  const lanes = wiperLanes(strip.arc1 - strip.arc0)
  expect(lanes.length % 2).toBe(0)
  for (const across of lanes) {
    // Every beam spans the gap between two pier lines with room to spare.
    const off = across - Math.round(across / WINDOW_ROBOT.pierSpacing) * WINDOW_ROBOT.pierSpacing
    expect(Math.abs(off)).toBeGreaterThan(WINDOW_ROBOT.halfWidth + WINDOW_ROBOT.pier + 1)
  }
  for (let j = 0; j < 4; j++) {
    for (let t = 1; t < 3.2e6; t += 97) {
      const p = robotPose(strip, 1, j, t)!
      expect(p.arc - WINDOW_ROBOT.halfWidth).toBeGreaterThan(strip.arc0)
      expect(p.arc + WINDOW_ROBOT.halfWidth).toBeLessThan(strip.arc1)
      expect(p.axial).toBeGreaterThanOrEqual(strip.axial0 + j * WINDOW_ROBOT.section + WINDOW_ROBOT.margin - 1e-6)
      expect(p.axial).toBeLessThanOrEqual(strip.axial0 + (j + 1) * WINDOW_ROBOT.section - WINDOW_ROBOT.margin + 1e-6)
      if (p.heading[0] === 0) expect(lanes.some(l => Math.abs(strip.arc1 - l - p.arc) < 1e-6)).toBe(true)
    }
    // No jumps: at most the distance travelled in one second.
    for (let t = 0; t < 40000; t += 1) {
      const a = robotPose(strip, 1, j, t)!, b = robotPose(strip, 1, j, t + 1)!
      expect(Math.hypot(b.arc - a.arc, b.axial - a.axial)).toBeLessThan(WINDOW_ROBOT.speed + 1e-6)
    }
  }
})

test('a section takes about two weeks and wipers start at different points', () => {
  const lanes = wiperLanes(strip.arc1 - strip.arc0), run = WINDOW_ROBOT.section - 2 * WINDOW_ROBOT.margin
  const days = (lanes.length * run + 2 * (lanes.at(-1)! - lanes[0])) / WINDOW_ROBOT.speed / 86400
  expect(days).toBeGreaterThan(12); expect(days).toBeLessThan(17)
  const a = robotPose(strip, 0, 1, 100)!, b = robotPose(strip, 0, 2, 100)!, c = robotPose(strip, 1, 1, 100)!
  expect(new Set([a.arc, b.arc, c.arc].map(v => v.toFixed(1))).size).toBeGreaterThan(1)
})

test('twelve wipers; beacons flash locally, position lamps stay steady and appear only at night', () => {
  let low = 1, high = 0
  for (let t = 0; t < 2.2; t += .01) { const b = beaconFlash(t, .3); low = Math.min(low, b); high = Math.max(high, b) }
  expect(low).toBeCloseTo(.25, 2); expect(high).toBeCloseTo(1, 2)
  const strips = [0, 1, 2].map(band => { const arc1 = -(band * Math.PI * 2 / 3 * R + half); return { ...strip, arc0: arc1 - 2 * half, arc1 } })
  const robots = new WindowRobots(new THREE.Group(), strips, R)
  expect(robots.update(1234)).toBe(12)
  expect(robots.positionLamps).toBe(24)
  const far = robots.group.getObjectByName('window-robot-position-lamps') as THREE.Points
  robots.setDaylight(1); expect(far.visible).toBe(false)
  robots.setDaylight(0); expect(far.visible).toBe(true)
  const p = far.geometry.getAttribute('position')
  for (let k = 0; k < robots.positionLamps; k++) {
    const r = Math.hypot(p.getX(k), p.getZ(k)), arc = Math.atan2(p.getZ(k), p.getX(k)) * R
    expect(Math.abs(r - (R + 16 - 1.3))).toBeLessThan(.02) // the bogies stand on the glass
    expect(strips.some(s => [0, -1, 1].some(m => arc + m * 2 * Math.PI * R > s.arc0 && arc + m * 2 * Math.PI * R < s.arc1))).toBe(true)
  }
  robots.dispose()
})
