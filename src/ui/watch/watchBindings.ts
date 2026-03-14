import type { ObserverMode, TrailMode } from '../../app/observerMode'
import type { PlayerTraversalMode } from '../../app/playerTraversal'
import { canRespawnOnAxisEnd, getPresetName } from '../../presets/presetManager'
import { getHabitatSpan } from '../../sim/habitatConfig'
import type { SettingsStore } from '../../state/settingsStore'
import { rpmToOmega } from '../../units/units'
import type { WatchActionId } from './watchLayout'

export type WatchRenderSnapshot = {
  playerMode: PlayerTraversalMode
  region: 'inside' | 'outside'
  watchMenuOpen: boolean
  observerMode: ObserverMode
  trailMode: TrailMode
  habitatType: 'cylinder' | 'ring'
  currentPresetId: string
  currentPresetName: string
  radius: number
  span: number
  rpm: number
  omega: number
  wallSpeed: number
  surfaceGravity: number
  simScale: number
  ballCount: number
  throwScale: number
  landingAssist: number
  reattachThreshold: number
  axisEndRespawnEnabled: boolean
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
  habitatType: settingsStore.habitat.type,
  currentPresetId: settingsStore.habitat.currentPresetId,
  currentPresetName: getPresetName(settingsStore.habitat.currentPresetId),
  radius: settingsStore.habitat.radius,
  span: getHabitatSpan(settingsStore.habitat),
  rpm: settingsStore.habitat.rpm,
  omega: rpmToOmega(settingsStore.habitat.rpm),
  wallSpeed: rpmToOmega(settingsStore.habitat.rpm) * settingsStore.habitat.radius,
  surfaceGravity: settingsStore.getSurfaceGravity(),
  simScale: settingsStore.habitat.simScale,
  ballCount: runtime.ballCount,
  throwScale: settingsStore.habitat.ballSpeedScale,
  landingAssist: settingsStore.reattach.assistNormalDamping,
  reattachThreshold: settingsStore.reattach.radialTolerance,
  axisEndRespawnEnabled: canRespawnOnAxisEnd(settingsStore.habitat.type),
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

export const isWatchActionDisabled = (
  snapshot: WatchRenderSnapshot,
  action: WatchActionId
) => action === 'respawn-axis-end' && !snapshot.axisEndRespawnEnabled

export const applyWatchAction = (
  settingsStore: SettingsStore,
  action: WatchActionId
) => {
  switch (action) {
    case 'rpm-coarse-decrement':
      settingsStore.adjustRpm(-1, 'coarse')
      return true
    case 'rpm-fine-decrement':
      settingsStore.adjustRpm(-1, 'fine')
      return true
    case 'rpm-fine-increment':
      settingsStore.adjustRpm(1, 'fine')
      return true
    case 'rpm-coarse-increment':
      settingsStore.adjustRpm(1, 'coarse')
      return true
    case 'radius-coarse-decrement':
      settingsStore.adjustRadius(-1, 'coarse')
      return true
    case 'radius-fine-decrement':
      settingsStore.adjustRadius(-1, 'fine')
      return true
    case 'radius-fine-increment':
      settingsStore.adjustRadius(1, 'fine')
      return true
    case 'radius-coarse-increment':
      settingsStore.adjustRadius(1, 'coarse')
      return true
    case 'throw-scale-coarse-decrement':
      settingsStore.adjustThrowScale(-1, 'coarse')
      return true
    case 'throw-scale-fine-decrement':
      settingsStore.adjustThrowScale(-1, 'fine')
      return true
    case 'throw-scale-fine-increment':
      settingsStore.adjustThrowScale(1, 'fine')
      return true
    case 'throw-scale-coarse-increment':
      settingsStore.adjustThrowScale(1, 'coarse')
      return true
    case 'landing-assist-coarse-decrement':
      settingsStore.adjustLandingAssist(-1, 'coarse')
      return true
    case 'landing-assist-fine-decrement':
      settingsStore.adjustLandingAssist(-1, 'fine')
      return true
    case 'landing-assist-fine-increment':
      settingsStore.adjustLandingAssist(1, 'fine')
      return true
    case 'landing-assist-coarse-increment':
      settingsStore.adjustLandingAssist(1, 'coarse')
      return true
    case 'reattach-threshold-coarse-decrement':
      settingsStore.adjustReattachThreshold(-1, 'coarse')
      return true
    case 'reattach-threshold-fine-decrement':
      settingsStore.adjustReattachThreshold(-1, 'fine')
      return true
    case 'reattach-threshold-fine-increment':
      settingsStore.adjustReattachThreshold(1, 'fine')
      return true
    case 'reattach-threshold-coarse-increment':
      settingsStore.adjustReattachThreshold(1, 'coarse')
      return true
    default:
      return false
  }
}
