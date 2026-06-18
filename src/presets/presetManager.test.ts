import { expect, test } from 'bun:test'

import { getWindowArcs } from '../objects/cityLayout'
import { createSettingsStore } from '../state/settingsStore'
import {
  applyPresetToSettingsStore,
  canRespawnOnAxisEnd,
  getPresetById
} from './presetManager'

test('applyPresetToSettingsStore updates the shared habitat values for Izma', () => {
  const settingsStore = createSettingsStore()

  const preset = applyPresetToSettingsStore(settingsStore, 'izma')

  expect(preset.name).toBe('Izma Colony')
  expect(settingsStore.habitat.currentPresetId).toBe('izma')
  expect(settingsStore.habitat.radius).toBe(3200)
  expect(settingsStore.habitat.length).toBe(40000)
  expect(settingsStore.habitat.rpm).toBeCloseTo(60 / 113.5, 6)
  expect(settingsStore.habitat.simScale).toBeCloseTo(0.02, 6)
})

test('applyPresetToSettingsStore restores the default playground colony', () => {
  const settingsStore = createSettingsStore({
    radius: 3200,
    length: 40000,
    rpm: 0.5,
    simScale: 0.02,
    currentPresetId: 'cooper'
  })

  const preset = applyPresetToSettingsStore(settingsStore, 'playground')

  expect(preset.name).toBe('Playground Colony')
  expect(settingsStore.habitat.currentPresetId).toBe('playground')
  expect(settingsStore.habitat.radius).toBe(18)
  expect(settingsStore.habitat.length).toBe(120)
  expect(settingsStore.habitat.rpm).toBe(5)
  expect(settingsStore.habitat.simScale).toBe(1)
})

test('applyPresetToSettingsStore maps Elysium thickness into the active span and scale', () => {
  const settingsStore = createSettingsStore()

  applyPresetToSettingsStore(settingsStore, 'elysium')

  expect(settingsStore.habitat.type).toBe('ring')
  expect(settingsStore.habitat.length).toBe(2000)
  expect(settingsStore.habitat.thickness).toBe(2000)
  expect(settingsStore.habitat.simScale).toBeCloseTo(0.005, 6)
})

test('canRespawnOnAxisEnd is enabled for all current presets', () => {
  expect(canRespawnOnAxisEnd(getPresetById('playground')?.type ?? 'cylinder')).toBe(true)
  expect(canRespawnOnAxisEnd(getPresetById('izma')?.type ?? 'ring')).toBe(true)
  expect(canRespawnOnAxisEnd(getPresetById('elysium')?.type ?? 'cylinder')).toBe(true)
})

test('full-floor presets carry one full-circle land arc; only Izma keeps three strips', () => {
  const settingsStore = createSettingsStore()

  for (const presetId of ['playground', 'cooper', 'elysium']) {
    applyPresetToSettingsStore(settingsStore, presetId)
    expect(settingsStore.habitat.topology.landArcs).toHaveLength(1)
    expect(settingsStore.habitat.topology.landArcs[0].arcRadians).toBeCloseTo(Math.PI * 2, 6)
  }

  applyPresetToSettingsStore(settingsStore, 'izma')
  expect(settingsStore.habitat.topology.landArcs).toHaveLength(3)
})

test('lighting type drives the end caps: only Izma is side-lit; full-floor presets are end-lit', () => {
  // End-cap geometry is derived from whether the colony has longitudinal side
  // windows (side-lit → both ends opaque) or not (end-lit → a glazed +Y daylight
  // window). The legacy endStructure flag no longer drives it.
  const settingsStore = createSettingsStore()

  applyPresetToSettingsStore(settingsStore, 'izma')
  expect(getWindowArcs(settingsStore.habitat.topology).length).toBeGreaterThan(0)

  for (const presetId of ['playground', 'cooper', 'elysium']) {
    applyPresetToSettingsStore(settingsStore, presetId)
    expect(getWindowArcs(settingsStore.habitat.topology)).toHaveLength(0)
  }
})
