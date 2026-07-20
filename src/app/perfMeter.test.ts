import { expect, test } from 'bun:test'

import { createPerfMeter } from './perfMeter'

test('fps stays 0 until the first averaging window closes', () => {
  const meter = createPerfMeter(0.5)

  for (let i = 0; i < 10; i += 1) {
    meter.frame(1 / 60, { calls: 100, triangles: 1000 })
  }

  expect(meter.stats().fps).toBe(0)
})

test('fps averages the frames inside a closed window', () => {
  const meter = createPerfMeter(0.5)

  // A full second of 60 Hz frames closes the 0.5 s window regardless of
  // float rounding in the accumulated delta.
  for (let i = 0; i < 60; i += 1) {
    meter.frame(1 / 60, { calls: 100, triangles: 1000 })
  }

  expect(meter.stats().fps).toBeCloseTo(60, 5)
})

test('a slower run of frames pulls the next window down', () => {
  const meter = createPerfMeter(0.5)

  for (let i = 0; i < 60; i += 1) {
    meter.frame(1 / 60, { calls: 100, triangles: 1000 })
  }
  for (let i = 0; i < 30; i += 1) {
    meter.frame(1 / 30, { calls: 100, triangles: 1000 })
  }

  expect(meter.stats().fps).toBeCloseTo(30, 5)
})

test('draw stats always reflect the most recent frame', () => {
  const meter = createPerfMeter(0.5)

  meter.frame(1 / 60, { calls: 100, triangles: 1000 })
  meter.frame(1 / 60, { calls: 250, triangles: 1800000 })

  expect(meter.stats().drawCalls).toBe(250)
  expect(meter.stats().triangles).toBe(1800000)
})
