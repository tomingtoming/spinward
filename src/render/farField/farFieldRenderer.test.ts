import { expect, mock, test } from 'bun:test'
import * as THREE from 'three'

import { DEFAULT_FAR_FIELD_SETTINGS } from './farFieldSettings'
import { FarFieldRenderer } from './farFieldRenderer'

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
