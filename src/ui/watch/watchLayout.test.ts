import { expect, test } from 'bun:test'
import * as THREE from 'three'
import { PLACE_DESTINATIONS } from '../../app/placeVisits'

import {
  createAllWatchLayouts,
  createWatchLayout,
  getWatchButtonAtUv,
  navTargetForAction,
  type WatchButton,
  type WatchScreenLayout
} from './watchLayout'

const centerUv = (layout: WatchScreenLayout, button: WatchButton) =>
  new THREE.Vector2(
    (button.x + button.width * 0.5) / layout.width,
    1 - (button.y + button.height * 0.5) / layout.height
  )

test('home screen keeps travel, spin and the category nav one tap away', () => {
  const layout = createWatchLayout('home')

  expect(layout.spinRow?.key).toBe('rpm')
  expect(layout.travelButtons?.map((button) => button.id)).toEqual([
    'respawn-inner-wall',
    'respawn-old-town',
    'respawn-overlook',
    'respawn-axis-end',
    'respawn-exterior'
  ])
  expect(layout.categoryButtons?.map((button) => button.id)).toEqual([
    'weather-rain-toggle',
    'audio-mute-toggle',
    'nav-habitat',
    'nav-tweaks',
    'nav-legend'
  ])
  // The tinkering parameters are no longer on home.
  expect(layout.rows).toBeUndefined()
  expect(layout.placesButton?.id).toBe('nav-places')
})

test('getWatchButtonAtUv resolves a UV hit on the home rpm stepper', () => {
  const layout = createWatchLayout('home')
  const rpmIncrement = layout.buttons.find((button) => button.id === 'rpm-fine-increment')

  if (rpmIncrement === undefined) {
    throw new Error('rpm increment button was not created')
  }

  expect(getWatchButtonAtUv(layout, centerUv(layout, rpmIncrement))?.id).toBe('rpm-fine-increment')
})

test('getWatchButtonAtUv resolves a UV hit on a home category button', () => {
  const layout = createWatchLayout('home')
  const habitat = layout.buttons.find((button) => button.id === 'nav-habitat')

  if (habitat === undefined) {
    throw new Error('habitat nav button was not created')
  }

  expect(getWatchButtonAtUv(layout, centerUv(layout, habitat))?.id).toBe('nav-habitat')
})

test('getWatchButtonAtUv ignores points outside of interactive buttons', () => {
  const layout = createWatchLayout('home')

  expect(getWatchButtonAtUv(layout, new THREE.Vector2(0.5, 0.99))).toBeNull()
})

test('habitat screen nests presets plus radius/length behind a Back button', () => {
  const layout = createWatchLayout('habitat')

  expect(layout.backButton?.id).toBe('nav-home')
  expect(layout.presetButtons?.map((button) => button.id)).toEqual([
    'preset-apply-playground',
    'preset-apply-izma',
    'preset-apply-cooper',
    'preset-apply-elysium'
  ])
  expect(layout.rows?.map((row) => row.key)).toEqual(['radius', 'length'])

  const playground = layout.buttons.find((button) => button.id === 'preset-apply-playground')

  if (playground === undefined) {
    throw new Error('playground preset button was not created')
  }

  expect(getWatchButtonAtUv(layout, centerUv(layout, playground))?.id).toBe('preset-apply-playground')
})

test('tweaks screen nests the tinkering parameters behind a Back button', () => {
  const layout = createWatchLayout('tweaks')

  expect(layout.backButton?.id).toBe('nav-home')
  expect(layout.rows?.map((row) => row.key)).toEqual([
    'throwScale',
    'jetpackAcceleration',
    'reattachThreshold',
    'dayCycleSeconds'
  ])
  expect(layout.rows?.[2]?.buttons.map((button) => button.id)).toEqual([
    'reattach-threshold-coarse-decrement',
    'reattach-threshold-fine-decrement',
    'reattach-threshold-fine-increment',
    'reattach-threshold-coarse-increment'
  ])
})

test('navTargetForAction maps nav buttons to screens and ignores actions', () => {
  expect(navTargetForAction('nav-home')).toBe('home')
  expect(navTargetForAction('nav-places')).toBe('places')
  expect(navTargetForAction('nav-habitat')).toBe('habitat')
  expect(navTargetForAction('nav-tweaks')).toBe('tweaks')
  expect(navTargetForAction('nav-legend')).toBe('legend')
  expect(navTargetForAction('rpm-fine-increment')).toBeNull()
  expect(navTargetForAction('preset-apply-izma')).toBeNull()
})

test('createAllWatchLayouts returns one layout per screen', () => {
  const layouts = createAllWatchLayouts()

  expect(Object.keys(layouts).sort()).toEqual([
    'habitat',
    'home',
    'legend',
    'places',
    'tweaks'
  ])
  expect(layouts.home.screen).toBe('home')
  expect(layouts.tweaks.screen).toBe('tweaks')
  expect(layouts.legend.screen).toBe('legend')
})

test('wrist places offer the same destinations as the ordinary travel menus', () => {
  const layout = createWatchLayout('places')
  expect(layout.placeButtons?.map(button => button.id)).toEqual(PLACE_DESTINATIONS.map(place => place.id))
  expect(layout.backButton?.id).toBe('nav-home')
  for (const button of layout.placeButtons!) {
    expect(button.width).toBeGreaterThanOrEqual(280)
    expect(button.height).toBeGreaterThanOrEqual(80)
    expect(button.y + button.height).toBeLessThan(layout.placesSection!.top + layout.placesSection!.height)
  }
  expect(layout.placesSection!.top + layout.placesSection!.height + 92).toBeLessThanOrEqual(layout.height)
})

test('every wrist target is inside the canvas, disjoint and reachable through its UV centre', () => {
  for (const layout of Object.values(createAllWatchLayouts())) for (const [i, button] of layout.buttons.entries()) {
    expect(button.x).toBeGreaterThanOrEqual(0)
    expect(button.y).toBeGreaterThanOrEqual(0)
    expect(button.x + button.width).toBeLessThanOrEqual(layout.width)
    expect(button.y + button.height).toBeLessThanOrEqual(layout.height)
    expect(getWatchButtonAtUv(layout, centerUv(layout, button))?.id).toBe(button.id)
    for (const other of layout.buttons.slice(i + 1)) {
      const overlap = Math.min(button.x + button.width, other.x + other.width) > Math.max(button.x, other.x) &&
        Math.min(button.y + button.height, other.y + other.height) > Math.max(button.y, other.y)
      expect(overlap).toBe(false)
    }
  }
})
