import { expect, test } from 'bun:test'

import { createSettingsStore } from './settingsStore'

test('settingsStore adjusts habitat values and notifies listeners', () => {
  const store = createSettingsStore()
  let notifications = 0
  store.subscribe(() => {
    notifications += 1
  })

  expect(store.getRpmFineStep()).toBeCloseTo(0.01, 6)
  expect(store.getRadiusFineStep()).toBeCloseTo(1, 6)

  store.adjustRpm(1, 'fine')
  store.adjustRadius(10, 'fine')
  store.adjustThrowScale(1, 'fine')
  store.adjustJetpackAcceleration(1, 'fine')

  expect(store.habitat.rpm).toBeCloseTo(5.01, 6)
  expect(store.habitat.radius).toBe(28)
  expect(store.habitat.ballSpeedScale).toBeCloseTo(1.01, 6)
  expect(store.habitat.jetpackAcceleration).toBeCloseTo(12.1, 6)
  expect(notifications).toBe(4)
})

test('settingsStore clamps grouped assist and reattach adjustments', () => {
  const store = createSettingsStore(
    {},
    {
      assistNormalDamping: 0.2,
      assistSurfaceDamping: 0.1,
      assistRadialPull: 0.1,
      radialTolerance: 0.06,
      maxNormalSpeed: 0.15,
      maxSurfaceSpeed: 0.15
    }
  )

  expect(store.getLandingAssistFineStep()).toBeCloseTo(0.1, 6)
  expect(store.getReattachThresholdFineStep()).toBeCloseTo(0.01, 6)

  store.adjustLandingAssist(-10, 'coarse')
  store.adjustReattachThreshold(-10, 'coarse')

  expect(store.reattach.assistNormalDamping).toBeGreaterThanOrEqual(0)
  expect(store.reattach.assistSurfaceDamping).toBeGreaterThanOrEqual(0)
  expect(store.reattach.assistRadialPull).toBeGreaterThanOrEqual(0)
  expect(store.reattach.radialTolerance).toBeCloseTo(0.05, 6)
  expect(store.reattach.maxNormalSpeed).toBeCloseTo(0.1, 6)
  expect(store.reattach.maxSurfaceSpeed).toBeCloseTo(0.1, 6)
})

test('settingsStore computes surface gravity from the shared habitat state', () => {
  const store = createSettingsStore({ radius: 20, rpm: 6 })

  expect(store.getSurfaceGravity()).toBeGreaterThan(7)
})

test('settingsStore keeps preset assignment explicit and returns to custom on manual habitat edits', () => {
  const store = createSettingsStore()

  store.setHabitatConfig({
    radius: 3200,
    rpm: 0.5286,
    simScale: 0.02,
    currentPresetId: 'izma'
  })

  expect(store.habitat.currentPresetId).toBe('izma')

  store.adjustRadius(1, 'fine')

  expect(store.habitat.currentPresetId).toBe('custom')
})

test('settingsStore updates far-field controls through the shared store', () => {
  const store = createSettingsStore()

  expect(store.getFarFieldIntensityFineStep()).toBeCloseTo(0.1, 6)

  store.setFarFieldEnabled(false)
  store.setFarFieldMode('day')
  store.adjustFarFieldIntensity(1, 'fine')

  expect(store.farField.enabled).toBe(false)
  expect(store.farField.mode).toBe('day')
  expect(store.farField.intensity).toBeCloseTo(1.1, 6)
})
