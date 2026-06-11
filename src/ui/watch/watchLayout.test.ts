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

test('createWatchExpandedLayout splits the spin row from the parameter rows', () => {
  const layout = createWatchExpandedLayout()

  expect(layout.spinRow.key).toBe('rpm')
  expect(layout.spinRow.buttons.map((button) => button.id)).toEqual([
    'rpm-coarse-decrement',
    'rpm-fine-decrement',
    'rpm-fine-increment',
    'rpm-coarse-increment'
  ])

  expect(layout.rows.map((row) => row.key)).toEqual([
    'radius',
    'length',
    'throwScale',
    'jetpackAcceleration',
    'reattachThreshold',
    'dayCycleSeconds'
  ])

  expect(layout.rows[4]?.buttons.map((button) => button.id)).toEqual([
    'reattach-threshold-coarse-decrement',
    'reattach-threshold-fine-decrement',
    'reattach-threshold-fine-increment',
    'reattach-threshold-coarse-increment'
  ])
})

test('travel buttons sit above the spin section', () => {
  const layout = createWatchExpandedLayout()

  for (const button of layout.respawnButtons) {
    expect(button.y).toBeLessThan(layout.spinSection.top)
  }
})
