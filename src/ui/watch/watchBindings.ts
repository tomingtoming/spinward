import type { PlayerTraversalMode } from '../../app/playerTraversal'
import type { SettingsStore } from '../../state/settingsStore'
import type { WatchActionId } from './watchLayout'

export type WatchRenderSnapshot = {
  playerMode: PlayerTraversalMode
  region: 'inside' | 'outside'
  watchMenuOpen: boolean
  radius: number
  rpm: number
  surfaceGravity: number
  ballCount: number
  throwScale: number
  landingAssist: number
  reattachThreshold: number
}

export const createWatchRenderSnapshot = (
  settingsStore: SettingsStore,
  runtime: {
    playerMode: PlayerTraversalMode
    region: 'inside' | 'outside'
    watchMenuOpen: boolean
    ballCount: number
  }
): WatchRenderSnapshot => ({
  playerMode: runtime.playerMode,
  region: runtime.region,
  watchMenuOpen: runtime.watchMenuOpen,
  radius: settingsStore.habitat.radius,
  rpm: settingsStore.habitat.rpm,
  surfaceGravity: settingsStore.getSurfaceGravity(),
  ballCount: runtime.ballCount,
  throwScale: settingsStore.habitat.ballSpeedScale,
  landingAssist: settingsStore.reattach.assistNormalDamping,
  reattachThreshold: settingsStore.reattach.radialTolerance
})

export const applyWatchAction = (
  settingsStore: SettingsStore,
  action: WatchActionId
) => {
  switch (action) {
    case 'rpm-decrement':
      settingsStore.adjustRpm(-0.1)
      break
    case 'rpm-increment':
      settingsStore.adjustRpm(0.1)
      break
    case 'radius-decrement':
      settingsStore.adjustRadius(-10)
      break
    case 'radius-increment':
      settingsStore.adjustRadius(10)
      break
    case 'throw-scale-decrement':
      settingsStore.adjustThrowScale(-0.05)
      break
    case 'throw-scale-increment':
      settingsStore.adjustThrowScale(0.05)
      break
    case 'landing-assist-decrement':
      settingsStore.adjustLandingAssist(-1)
      break
    case 'landing-assist-increment':
      settingsStore.adjustLandingAssist(1)
      break
    case 'reattach-threshold-decrement':
      settingsStore.adjustReattachThreshold(-1)
      break
    case 'reattach-threshold-increment':
      settingsStore.adjustReattachThreshold(1)
      break
  }
}
