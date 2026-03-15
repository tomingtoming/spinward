import { expect, test } from 'bun:test'

import {
  normalizeCylinderAzimuth,
  quantizeCylinderShellFocus,
  resolveCylinderShellUvTransform,
  splitCylinderShellArcs
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
