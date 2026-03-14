import type { ObserverMode, TrailMode } from '../../app/observerMode'
import type { PlayerTraversalMode } from '../../app/playerTraversal'
import type { SettingsStore } from '../../state/settingsStore'
import type { WatchActionId } from './watchLayout'

export type WatchRenderSnapshot = {
  playerMode: PlayerTraversalMode
  region: 'inside' | 'outside'
  watchMenuOpen: boolean
  observerMode: ObserverMode
  trailMode: TrailMode
  radius: number
  rpm: number
  omega: number
  wallSpeed: number
  surfaceGravity: number
  ballCount: number
  throwScale: number
  landingAssist: number
  reattachThreshold: number
  radiusFineStep: number
  radiusCoarseStep: number
  rpmFineStep: number
  rpmCoarseStep: number
  throwScaleFineStep: number
  throwScaleCoarseStep: number
  landingAssistFineStep: number
  landingAssistCoarseStep: number
  reattachThresholdFineStep: number
  reattachThresholdCoarseStep: number
}

export const createWatchRenderSnapshot = (
  settingsStore: SettingsStore,
  runtime: {
    playerMode: PlayerTraversalMode
    region: 'inside' | 'outside'
    watchMenuOpen: boolean
    observerMode: ObserverMode
    trailMode: TrailMode
    ballCount: number
  }
): WatchRenderSnapshot => ({
  playerMode: runtime.playerMode,
  region: runtime.region,
  watchMenuOpen: runtime.watchMenuOpen,
  observerMode: runtime.observerMode,
  trailMode: runtime.trailMode,
  radius: settingsStore.habitat.radius,
  rpm: settingsStore.habitat.rpm,
  omega: (settingsStore.habitat.rpm * Math.PI) / 30,
  wallSpeed:
    ((settingsStore.habitat.rpm * Math.PI) / 30) * settingsStore.habitat.radius,
  surfaceGravity: settingsStore.getSurfaceGravity(),
  ballCount: runtime.ballCount,
  throwScale: settingsStore.habitat.ballSpeedScale,
  landingAssist: settingsStore.reattach.assistNormalDamping,
  reattachThreshold: settingsStore.reattach.radialTolerance,
  radiusFineStep: settingsStore.getRadiusFineStep(),
  radiusCoarseStep: settingsStore.getRadiusCoarseStep(),
  rpmFineStep: settingsStore.getRpmFineStep(),
  rpmCoarseStep: settingsStore.getRpmCoarseStep(),
  throwScaleFineStep: settingsStore.getThrowScaleFineStep(),
  throwScaleCoarseStep: settingsStore.getThrowScaleCoarseStep(),
  landingAssistFineStep: settingsStore.getLandingAssistFineStep(),
  landingAssistCoarseStep: settingsStore.getLandingAssistCoarseStep(),
  reattachThresholdFineStep: settingsStore.getReattachThresholdFineStep(),
  reattachThresholdCoarseStep: settingsStore.getReattachThresholdCoarseStep()
})

export const applyWatchAction = (
  settingsStore: SettingsStore,
  action: WatchActionId
) => {
  switch (action) {
    case 'rpm-coarse-decrement':
      settingsStore.adjustRpm(-1, 'coarse')
      break
    case 'rpm-fine-decrement':
      settingsStore.adjustRpm(-1, 'fine')
      break
    case 'rpm-fine-increment':
      settingsStore.adjustRpm(1, 'fine')
      break
    case 'rpm-coarse-increment':
      settingsStore.adjustRpm(1, 'coarse')
      break
    case 'radius-coarse-decrement':
      settingsStore.adjustRadius(-1, 'coarse')
      break
    case 'radius-fine-decrement':
      settingsStore.adjustRadius(-1, 'fine')
      break
    case 'radius-fine-increment':
      settingsStore.adjustRadius(1, 'fine')
      break
    case 'radius-coarse-increment':
      settingsStore.adjustRadius(1, 'coarse')
      break
    case 'throw-scale-coarse-decrement':
      settingsStore.adjustThrowScale(-1, 'coarse')
      break
    case 'throw-scale-fine-decrement':
      settingsStore.adjustThrowScale(-1, 'fine')
      break
    case 'throw-scale-fine-increment':
      settingsStore.adjustThrowScale(1, 'fine')
      break
    case 'throw-scale-coarse-increment':
      settingsStore.adjustThrowScale(1, 'coarse')
      break
    case 'landing-assist-coarse-decrement':
      settingsStore.adjustLandingAssist(-1, 'coarse')
      break
    case 'landing-assist-fine-decrement':
      settingsStore.adjustLandingAssist(-1, 'fine')
      break
    case 'landing-assist-fine-increment':
      settingsStore.adjustLandingAssist(1, 'fine')
      break
    case 'landing-assist-coarse-increment':
      settingsStore.adjustLandingAssist(1, 'coarse')
      break
    case 'reattach-threshold-coarse-decrement':
      settingsStore.adjustReattachThreshold(-1, 'coarse')
      break
    case 'reattach-threshold-fine-decrement':
      settingsStore.adjustReattachThreshold(-1, 'fine')
      break
    case 'reattach-threshold-fine-increment':
      settingsStore.adjustReattachThreshold(1, 'fine')
      break
    case 'reattach-threshold-coarse-increment':
      settingsStore.adjustReattachThreshold(1, 'coarse')
      break
  }
}
