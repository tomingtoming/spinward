import { expect, mock, test } from 'bun:test'
import * as THREE from 'three'

import { DEFAULT_FAR_FIELD_SETTINGS } from './farFieldSettings'
import { FarFieldRenderer, getFarFieldThetaStart } from './farFieldRenderer'

test('far-field renderer rebuilds when settings change', () => {
  const scene = new THREE.Scene()
  const settings = { ...DEFAULT_FAR_FIELD_SETTINGS }
  const habitat = { radius: 3200, span: 40000, presetId: 'izma' }
  const renderer = new FarFieldRenderer(scene, () => settings, () => habitat)
  const rebuildSpy = mock(() => undefined)

  renderer.rebuild = rebuildSpy as typeof renderer.rebuild
  renderer.sync()
  settings.intensity = 1.4
  renderer.sync()

  expect(rebuildSpy).toHaveBeenCalledTimes(2)
})

test('far-field band centers on the opposite wall around -X', () => {
  const arcRadians = THREE.MathUtils.degToRad(120)
  const geometry = new THREE.CylinderGeometry(
    10,
    10,
    20,
    24,
    1,
    true,
    getFarFieldThetaStart(arcRadians),
    arcRadians
  )
  const positions = geometry.attributes.position
  let centroidX = 0
  let centroidZ = 0

  for (let index = 0; index < positions.count; index += 1) {
    centroidX += positions.getX(index)
    centroidZ += positions.getZ(index)
  }

  centroidX /= positions.count
  centroidZ /= positions.count

  expect(centroidX).toBeLessThan(-1)
  expect(Math.abs(centroidZ)).toBeLessThan(1)

  geometry.dispose()
})
