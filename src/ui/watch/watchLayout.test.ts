import { expect, test } from 'bun:test'
import * as THREE from 'three'

import { createWatchExpandedLayout, getWatchButtonAtUv } from './watchLayout'

test('getWatchButtonAtUv returns the matching button for UV hits', () => {
  const layout = createWatchExpandedLayout(720, 860)
  const rpmIncrement = layout.buttons.find((button) => button.id === 'rpm-fine-increment')

  if (rpmIncrement === undefined) {
    throw new Error('rpm increment button was not created')
  }

  const uv = new THREE.Vector2(
    (rpmIncrement.x + rpmIncrement.width * 0.5) / layout.width,
    1 - (rpmIncrement.y + rpmIncrement.height * 0.5) / layout.height
  )

  expect(getWatchButtonAtUv(layout, uv)?.id).toBe('rpm-fine-increment')
})

test('getWatchButtonAtUv ignores points outside of interactive buttons', () => {
  const layout = createWatchExpandedLayout(720, 860)

  expect(getWatchButtonAtUv(layout, new THREE.Vector2(0.08, 0.95))).toBeNull()
})

test('getWatchButtonAtUv reaches the playground preset button', () => {
  const layout = createWatchExpandedLayout()
  const playgroundButton = layout.buttons.find((button) => button.id === 'preset-apply-playground')

  if (playgroundButton === undefined) {
    throw new Error('playground preset button was not created')
  }

  const uv = new THREE.Vector2(
    (playgroundButton.x + playgroundButton.width * 0.5) / layout.width,
    1 - (playgroundButton.y + playgroundButton.height * 0.5) / layout.height
  )

  expect(getWatchButtonAtUv(layout, uv)?.id).toBe('preset-apply-playground')
})
