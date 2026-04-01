import { expect, test } from 'bun:test'

import { createSettingsStore } from '../../state/settingsStore'
import {
  applyWatchAction,
  createWatchRenderSnapshot,
  isWatchActionDisabled
} from './watchBindings'

test('createWatchRenderSnapshot reflects derived watch values from the shared store', () => {
  const store = createSettingsStore(
    {
      type: 'ring',
      currentPresetId: 'elysium',
      radius: 30000,
      length: 2000,
      rpm: 60 / 348,
      simScale: 0.005,
      ballSpeedScale: 1.4,
      jetpackAcceleration: 13.5
    },
    {
      radialTolerance: 0.35
    },
    {
      enabled: true,
      mode: 'auto',
      intensity: 1.25
    }
  )
  store.setLocomotionProfileId('expert')

  const snapshot = createWatchRenderSnapshot(store, {
    playerMode: 'free-fly',
    region: 'outside',
    watchMenuOpen: true,
    observerMode: 'inertial-fixed',
    trailMode: 'both',
    ballCount: 3,
    absoluteVelocity: {
      x: 1.25,
      y: -2.5,
      z: 3.75,
      speed: 4.677071733
    }
  })

  expect(snapshot.currentPresetId).toBe('elysium')
  expect(snapshot.currentPresetName).toBe('Elysium')
  expect(snapshot.habitatType).toBe('ring')
  expect(snapshot.radius).toBe(30000)
  expect(snapshot.span).toBe(2000)
  expect(snapshot.simScale).toBeCloseTo(0.005, 6)
  expect(snapshot.wallSpeed).toBeCloseTo(snapshot.omega * snapshot.radius, 6)
  expect(snapshot.throwScale).toBeCloseTo(1.4, 6)
  expect(snapshot.jetpackAcceleration).toBeCloseTo(13.5, 6)
  expect(snapshot.reattachThreshold).toBeCloseTo(0.35, 6)
  expect(snapshot.farFieldResolvedMode).toBe('day')
  expect(snapshot.locomotionProfileId).toBe('expert')
  expect(snapshot.ballCount).toBe(3)
  expect(snapshot.absoluteVelocityX).toBeCloseTo(1.25, 6)
  expect(snapshot.absoluteVelocityY).toBeCloseTo(-2.5, 6)
  expect(snapshot.absoluteVelocityZ).toBeCloseTo(3.75, 6)
  expect(snapshot.absoluteSpeed).toBeCloseTo(4.677071733, 6)
})

test('applyWatchAction routes parameter, mode, and profile actions through the shared store', () => {
  const store = createSettingsStore()

  expect(applyWatchAction(store, 'rpm-fine-increment')).toBe(true)
  expect(store.habitat.rpm).toBeCloseTo(5.01, 6)

  expect(applyWatchAction(store, 'radius-coarse-increment')).toBe(true)
  expect(store.habitat.radius).toBe(30)

  expect(applyWatchAction(store, 'throw-scale-fine-increment')).toBe(true)
  expect(store.habitat.ballSpeedScale).toBeCloseTo(1.01, 6)

  expect(applyWatchAction(store, 'jetpack-acceleration-fine-increment')).toBe(true)
  expect(store.habitat.jetpackAcceleration).toBeCloseTo(12.1, 6)

  expect(applyWatchAction(store, 'reattach-threshold-fine-increment')).toBe(true)
  expect(store.reattach.radialTolerance).toBeCloseTo(0.21, 6)
  expect(store.reattach.maxNormalSpeed).toBeCloseTo(0.75, 6)
  expect(store.reattach.maxSurfaceSpeed).toBeCloseTo(1.45, 6)

  expect(applyWatchAction(store, 'far-field-mode-day')).toBe(true)
  expect(store.farField.mode).toBe('day')

  expect(applyWatchAction(store, 'far-field-intensity-fine-increment')).toBe(true)
  expect(store.farField.intensity).toBeCloseTo(1.1, 6)

  expect(applyWatchAction(store, 'profile-beginner')).toBe(true)
  expect(store.getLocomotionProfileId()).toBe('beginner')
})

test('isWatchActionDisabled only blocks axis-end respawn when the snapshot says so', () => {
  const store = createSettingsStore()
  const snapshot = createWatchRenderSnapshot(store, {
    playerMode: 'attached',
    region: 'inside',
    watchMenuOpen: true,
    observerMode: 'colony-fixed',
    trailMode: 'rotating',
    ballCount: 0,
    absoluteVelocity: {
      x: 0,
      y: 0,
      z: 0,
      speed: 0
    }
  })

  expect(isWatchActionDisabled(snapshot, 'respawn-axis-end')).toBe(false)
  expect(isWatchActionDisabled({ ...snapshot, axisEndRespawnEnabled: false }, 'respawn-axis-end')).toBe(true)
  expect(isWatchActionDisabled(snapshot, 'rpm-fine-increment')).toBe(false)
})
