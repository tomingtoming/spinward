import { expect, test } from 'bun:test'
import { robotPose, WINDOW_ROBOT, type WindowStrip } from './windowRobots'

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
