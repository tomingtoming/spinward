import type { ObserverMode, TrailMode } from '../../app/observerMode'
import type { PlayerTraversalMode } from '../../app/playerTraversal'
import { canRespawnOnAxisEnd, getPresetName } from '../../presets/presetManager'
import { resolveFarFieldMode } from '../../render/farField/farFieldSettings'
import { getHabitatSpan } from '../../sim/habitatConfig'
import type { SettingsStore } from '../../state/settingsStore'
import { rpmToOmega } from '../../units/units'
import type { LocomotionProfileId } from '../../xr/locomotionProfile'
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
  jetpackAcceleration: number
  reattachThreshold: number
  farFieldEnabled: boolean
  farFieldMode: 'night' | 'day' | 'auto'
  farFieldResolvedMode: 'night' | 'day'
  farFieldIntensity: number
  farFieldIntensityFineStep: number
  farFieldIntensityCoarseStep: number
  locomotionProfileId: LocomotionProfileId
  axisEndRespawnEnabled: boolean
  radiusFineStep: number
  radiusCoarseStep: number
  rpmFineStep: number
  rpmCoarseStep: number
  throwScaleFineStep: number
  throwScaleCoarseStep: number
  jetpackAccelerationFineStep: number
  jetpackAccelerationCoarseStep: number
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
  jetpackAcceleration: settingsStore.habitat.jetpackAcceleration,
  reattachThreshold: settingsStore.reattach.radialTolerance,
  farFieldEnabled: settingsStore.farField.enabled,
  farFieldMode: settingsStore.farField.mode,
  farFieldResolvedMode: resolveFarFieldMode(
    settingsStore.farField.mode,
    settingsStore.habitat.currentPresetId
  ),
  farFieldIntensity: settingsStore.farField.intensity,
  locomotionProfileId: settingsStore.getLocomotionProfileId(),
  axisEndRespawnEnabled: canRespawnOnAxisEnd(settingsStore.habitat.type),
  radiusFineStep: settingsStore.getRadiusFineStep(),
  radiusCoarseStep: settingsStore.getRadiusCoarseStep(),
  rpmFineStep: settingsStore.getRpmFineStep(),
  rpmCoarseStep: settingsStore.getRpmCoarseStep(),
  throwScaleFineStep: settingsStore.getThrowScaleFineStep(),
  throwScaleCoarseStep: settingsStore.getThrowScaleCoarseStep(),
  jetpackAccelerationFineStep: settingsStore.getJetpackAccelerationFineStep(),
  jetpackAccelerationCoarseStep: settingsStore.getJetpackAccelerationCoarseStep(),
  reattachThresholdFineStep: settingsStore.getReattachThresholdFineStep(),
  reattachThresholdCoarseStep: settingsStore.getReattachThresholdCoarseStep(),
  farFieldIntensityFineStep: settingsStore.getFarFieldIntensityFineStep(),
  farFieldIntensityCoarseStep: settingsStore.getFarFieldIntensityCoarseStep()
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
    case 'profile-beginner':
      settingsStore.setLocomotionProfileId('beginner')
      return true
    case 'profile-sim':
      settingsStore.setLocomotionProfileId('sim')
      return true
    case 'profile-expert':
      settingsStore.setLocomotionProfileId('expert')
      return true
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
    case 'jetpack-acceleration-coarse-decrement':
      settingsStore.adjustJetpackAcceleration(-1, 'coarse')
      return true
    case 'jetpack-acceleration-fine-decrement':
      settingsStore.adjustJetpackAcceleration(-1, 'fine')
      return true
    case 'jetpack-acceleration-fine-increment':
      settingsStore.adjustJetpackAcceleration(1, 'fine')
      return true
    case 'jetpack-acceleration-coarse-increment':
      settingsStore.adjustJetpackAcceleration(1, 'coarse')
      return true
    case 'far-field-disable':
      settingsStore.setFarFieldEnabled(false)
      return true
    case 'far-field-enable':
      settingsStore.setFarFieldEnabled(true)
      return true
    case 'far-field-mode-auto':
      settingsStore.setFarFieldMode('auto')
      return true
    case 'far-field-mode-day':
      settingsStore.setFarFieldMode('day')
      return true
    case 'far-field-mode-night':
      settingsStore.setFarFieldMode('night')
      return true
    case 'far-field-intensity-coarse-decrement':
      settingsStore.adjustFarFieldIntensity(-1, 'coarse')
      return true
    case 'far-field-intensity-fine-decrement':
      settingsStore.adjustFarFieldIntensity(-1, 'fine')
      return true
    case 'far-field-intensity-fine-increment':
      settingsStore.adjustFarFieldIntensity(1, 'fine')
      return true
    case 'far-field-intensity-coarse-increment':
      settingsStore.adjustFarFieldIntensity(1, 'coarse')
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
