import { expect, test } from 'bun:test'

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

test('applyPresetToSettingsStore maps Elysium thickness into the active span and scale', () => {
  const settingsStore = createSettingsStore()

  applyPresetToSettingsStore(settingsStore, 'elysium')

  expect(settingsStore.habitat.type).toBe('ring')
  expect(settingsStore.habitat.length).toBe(2000)
  expect(settingsStore.habitat.thickness).toBe(2000)
  expect(settingsStore.habitat.simScale).toBeCloseTo(0.005, 6)
})

test('canRespawnOnAxisEnd is only enabled for cylinder presets', () => {
  expect(canRespawnOnAxisEnd(getPresetById('izma')?.type ?? 'ring')).toBe(true)
  expect(canRespawnOnAxisEnd(getPresetById('elysium')?.type ?? 'cylinder')).toBe(false)
})
