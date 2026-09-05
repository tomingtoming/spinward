import { describe, expect, test } from 'bun:test'
import { createResolutionGovernor, DESKTOP_GOVERNOR, resolvePixelRatio } from './resolutionGovernor'

const make = (initialRatio = 2) => createResolutionGovernor({ initialRatio, ...DESKTOP_GOVERNOR })

// Feed frames at a fixed rate for a span of time; collect step-downs.
const run = (
  governor: ReturnType<typeof make>,
  fromMs: number,
  seconds: number,
  fps: number
): { steps: number[]; endMs: number } => {
  const steps: number[] = []
  const dt = 1000 / fps
  let t = fromMs
  const end = fromMs + seconds * 1000
  while (t < end) {
    t += dt
    const next = governor.frame(t)
    if (next !== null) steps.push(next)
  }
  return { steps, endMs: t }
}

describe('createResolutionGovernor', () => {
  test('does nothing before start() or during the grace period', () => {
    const g = make()
    expect(g.frame(0)).toBeNull()
    g.start(1000)
    expect(run(g, 1000, DESKTOP_GOVERNOR.graceSeconds - 0.5, 10).steps).toEqual([])
    expect(g.ratio()).toBe(2)
  })

  test('fast frames never step', () => {
    const g = make()
    g.start(0)
    expect(run(g, 0, 20, 60).steps).toEqual([])
    expect(g.ratio()).toBe(2)
  })

  test('two consecutive slow windows step down once; sustained slowness walks the ladder', () => {
    const g = make()
    g.start(0)
    const first = run(g, 0, 3 + 1.5 * 2 + 0.3, 20)
    expect(first.steps).toEqual([1.5])
    const rest = run(g, first.endMs, 8, 20)
    expect(rest.steps).toEqual([1, 0.75])
    expect(g.ratio()).toBe(0.75)
    // Ladder exhausted: stays put.
    expect(run(g, first.endMs + 8000, 5, 5).steps).toEqual([])
  })

  test('a single slow window followed by fast frames is a hitch, not a slow machine', () => {
    const g = make()
    g.start(0)
    const slow = run(g, 0, 3 + 1.6, 20)
    expect(slow.steps).toEqual([])
    const fast = run(g, slow.endMs, 3, 60)
    expect(fast.steps).toEqual([])
    const slowAgain = run(g, fast.endMs, 1.6, 20)
    // Counter reset by the fast window: one slow window is still not enough.
    expect(slowAgain.steps).toEqual([])
  })

  test('a window spanning a freeze is discarded', () => {
    const g = make()
    g.start(0)
    run(g, 0, 3.1, 60) // past grace, window open
    // Debugger paused for 30 s: one frame arrives after a huge gap.
    expect(g.frame(3100 + 30000)).toBeNull()
    expect(g.frame(3100 + 30000 + 1600)).toBeNull()
    expect(g.ratio()).toBe(2)
  })

  test('resume() after a hidden tab drops the open window and the slow streak', () => {
    const g = make()
    g.start(0)
    run(g, 0, 3 + 1.6, 20) // one slow window banked
    g.resume()
    const after = run(g, 4600, 1.6, 20)
    // Streak was reset: this is the first slow window again, no step.
    expect(after.steps).toEqual([])
    expect(g.ratio()).toBe(2)
  })

  test('a software renderer at a few seconds per frame still steps down', () => {
    const g = make()
    g.start(0)
    const out = run(g, 0, 3 + 4 * 6, 0.4) // 2.5 s per frame
    expect(out.steps.length).toBeGreaterThan(0)
    expect(out.steps[0]).toBe(1.5)
  })

  test('only steps strictly below the initial ratio are used', () => {
    const g = make(1)
    g.start(0)
    const out = run(g, 0, 3 + 1.5 * 2 + 0.3, 10)
    expect(out.steps).toEqual([0.75])
  })
})

describe('resolvePixelRatio', () => {
  test('device ratio under the tier cap when unpinned', () => {
    expect(resolvePixelRatio(null, 2, Number.POSITIVE_INFINITY)).toEqual({ ratio: 2, pinned: false })
    expect(resolvePixelRatio(null, 3, 1.75)).toEqual({ ratio: 1.75, pinned: false })
  })

  test('?dpr= pins within (0, 4]', () => {
    expect(resolvePixelRatio('1', 2, Number.POSITIVE_INFINITY)).toEqual({ ratio: 1, pinned: true })
    expect(resolvePixelRatio('0.5', 2, 1.75)).toEqual({ ratio: 0.5, pinned: true })
  })

  test('garbage falls back to detection', () => {
    for (const bad of ['', 'x', '0', '-1', '9', 'NaN']) {
      expect(resolvePixelRatio(bad, 2, 1.75)).toEqual({ ratio: 1.75, pinned: false })
    }
  })
})
