import { describe, expect, test } from 'bun:test'
import { ThreeBandWalker, type SourceWorld, type WalkPose } from './walker'
import { omegaForSurfaceG } from '../../units/units'

const initial = (): WalkPose => ({ x: 0, y: 0, h: 0, yaw: 0, pitch: 0, rejected: 0 })
const flat = (): SourceWorld => ({ readyAt: () => true, ground: () => 0, blocked: () => false,
  move: (p, dx, dy) => ({ ...p, x: p.x + dx, y: p.y + dy, h: 0 }) })

describe('three-band rotating-frame body', () => {
  for (const band of [0, 1, 2]) test(`1g jump and landing on band ${band}`, () => {
    const walker = new ThreeBandWalker(flat(), { band, anchor: { local: [-37, 1525] } }, initial(), 3200, omegaForSurfaceG(9.81, 3200))
    let apex = 0, landed = -1
    for (let i = 0; i < 180; i++) {
      const p = walker.step(1 / 120, 0, 0, i === 0)
      apex = Math.max(apex, p.h)
      if (i > 0 && walker.grounded) { landed = i / 120; break }
    }
    expect(apex).toBeCloseTo(4 ** 2 / (2 * 9.81), 1)
    expect(landed).toBeCloseTo(8 / 9.81, 1)
    expect(walker.state.h).toBe(0)
    expect(Math.abs(walker.state.y)).toBeLessThan(.000001)
    // A radial jump in a spinning frame has a measurable Coriolis drift.
    expect(Math.abs(walker.state.x)).toBeGreaterThan(.02)
    expect(Math.abs(walker.state.x)).toBeLessThan(.2)
  })
  test('missing destination collision freezes flight and resumes without a stored time jump', () => {
    let available = true
    const world = flat(); world.readyAt = () => available
    const walker = new ThreeBandWalker(world, { band: 0, anchor: { local: [0, 0] } }, initial(), 3200, omegaForSurfaceG(9.81, 3200))
    walker.step(.05, 1.45, 0, true)
    const before = { ...walker.state }, velocity = walker.velocity.clone()
    available = false
    for (let i = 0; i < 100; i++) walker.step(.05, 1.45, 0)
    expect(walker.waiting).toBe(true); expect(walker.state).toEqual(before); expect(walker.velocity.equals(velocity)).toBe(true)
    available = true; walker.step(500, 1.45, 0)
    expect(walker.state.h - before.h).toBeLessThan(.2)
    expect(walker.waiting).toBe(false)
  })
  test('airborne body cannot cross a thin building footprint', () => {
    const world = flat(); world.blocked = x => x >= .3 && x < .32
    const walker = new ThreeBandWalker(world, { band: 0, anchor: { local: [0, 0] } }, initial(), 3200, omegaForSurfaceG(9.81, 3200))
    for (let i = 0; i < 14; i++) walker.step(.05, 1.45, 0, i === 0)
    expect(walker.state.x).toBeLessThan(.3)
  })
})
