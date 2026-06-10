import { expect, test } from 'bun:test'

import {
  normalizeCylinderAzimuth,
  quantizeCylinderShellFocus,
  resolveCylinderShellUvTransform,
  splitCylinderShellArcs,
  subtractArcIntervals
} from './cylinder'

test('splitCylinderShellArcs covers the full circumference with near and far shells', () => {
  const arcs = splitCylinderShellArcs(0, Math.PI * 0.75)

  expect(arcs.near.arcRadians + arcs.far.arcRadians).toBeCloseTo(Math.PI * 2, 6)
  expect(arcs.near.thetaStart).toBeCloseTo(Math.PI * 0.125, 6)
  expect(arcs.far.thetaStart).toBeCloseTo(Math.PI * 0.875, 6)
})

test('quantizeCylinderShellFocus snaps to stable angular buckets', () => {
  const stepRadians = Math.PI / 12

  expect(quantizeCylinderShellFocus(0.1, stepRadians)).toBeCloseTo(0, 6)
  expect(quantizeCylinderShellFocus(0.32, stepRadians)).toBeCloseTo(stepRadians, 6)
})

test('normalizeCylinderAzimuth wraps angles into the cylinder range', () => {
  expect(normalizeCylinderAzimuth(-Math.PI / 2)).toBeCloseTo(Math.PI * 1.5, 6)
  expect(normalizeCylinderAzimuth(Math.PI * 2.5)).toBeCloseTo(Math.PI * 0.5, 6)
})

test('resolveCylinderShellUvTransform anchors partial shell textures in world space', () => {
  const transform = resolveCylinderShellUvTransform(40, {
    thetaStart: Math.PI / 7,
    arcRadians: Math.PI
  })

  expect(transform.repeatX).toBeCloseTo(20, 6)
  expect(transform.offsetX).toBeCloseTo(40 / 14 - 2, 6)
})

test('subtractArcIntervals returns the original interval when nothing overlaps', () => {
  const result = subtractArcIntervals(0, Math.PI / 2, [
    { start: Math.PI, length: Math.PI / 4 }
  ])
  expect(result).toEqual([{ start: 0, length: Math.PI / 2 }])
})

test('subtractArcIntervals splits the interval around an interior hole', () => {
  const result = subtractArcIntervals(0, 1, [{ start: 0.4, length: 0.2 }])
  expect(result).toHaveLength(2)
  expect(result[0].start).toBeCloseTo(0, 9)
  expect(result[0].length).toBeCloseTo(0.4, 9)
  expect(result[1].start).toBeCloseTo(0.6, 9)
  expect(result[1].length).toBeCloseTo(0.4, 9)
})

test('subtractArcIntervals handles holes wrapping across the interval start', () => {
  // Hole [-0.1, 0.1) overlaps the head of the interval [0, 1).
  const result = subtractArcIntervals(0, 1, [
    { start: Math.PI * 2 - 0.1, length: 0.2 }
  ])
  expect(result).toHaveLength(1)
  expect(result[0].start).toBeCloseTo(0.1, 9)
  expect(result[0].length).toBeCloseTo(0.9, 9)
})

test('subtractArcIntervals removes everything when the holes cover the interval', () => {
  expect(subtractArcIntervals(0.2, 0.5, [{ start: 0, length: 1 }])).toEqual([])
})

test('subtractArcIntervals carves the three window strips out of a full far arc', () => {
  const windows = [0, 1, 2].map((index) => ({
    start: Math.PI / 6 + (index * Math.PI * 2) / 3 - Math.PI / 6,
    length: Math.PI / 3
  }))
  const result = subtractArcIntervals(0, Math.PI * 2, windows)
  const totalLand = result.reduce((sum, interval) => sum + interval.length, 0)
  expect(totalLand).toBeCloseTo(Math.PI, 6)
})
