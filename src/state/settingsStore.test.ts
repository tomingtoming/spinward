import { expect, test } from 'bun:test'

import { createSettingsStore } from './settingsStore'

test('settingsStore adjusts habitat values and notifies listeners', () => {
  const store = createSettingsStore()
  let notifications = 0
  store.subscribe(() => {
    notifications += 1
  })

  store.adjustRpm(0.1)
  store.adjustRadius(10)
  store.adjustThrowScale(0.05)

  expect(store.habitat.rpm).toBeCloseTo(5.1, 6)
  expect(store.habitat.radius).toBe(30)
  expect(store.habitat.ballSpeedScale).toBeCloseTo(1.05, 6)
  expect(notifications).toBe(3)
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

  store.adjustLandingAssist(-10)
  store.adjustReattachThreshold(-10)

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
