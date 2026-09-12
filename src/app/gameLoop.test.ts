import { expect, test } from 'bun:test'
import * as THREE from 'three'
import { GameLoop } from './gameLoop'

test('physics steps stay positive across duplicate or regressing frame timestamps', () => {
  let frame!: (time: number) => void
  const steps: number[] = []
  const xr = new THREE.EventDispatcher<{ sessionstart: {}; sessionend: {} }>()
  const renderer = { xr, setAnimationLoop: (callback: typeof frame) => { frame = callback } }
  new GameLoop(renderer as unknown as THREE.WebGLRenderer, ({ deltaSeconds }) => steps.push(deltaSeconds)).start()
  for (const time of [1000, 1016, 1016, 1015, 1032, 5000]) frame(time)
  expect(steps[1]).toBeCloseTo(.016, 8)
  for (const step of steps) {
    expect(Number.isFinite(step)).toBe(true)
    expect(step).toBeGreaterThan(0)
    expect(step).toBeLessThanOrEqual(.05)
  }
  expect(steps.at(-1)).toBe(.05)
  xr.dispatchEvent({ type: 'sessionstart' })
  frame(7000)
  expect(steps.at(-1)).toBeCloseTo(1 / 60, 8)
  xr.dispatchEvent({ type: 'sessionend' })
  frame(6995)
  expect(steps.at(-1)).toBeCloseTo(1 / 60, 8)
})
