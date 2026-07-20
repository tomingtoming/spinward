import type { DepthMode } from '../../app/depthMode'
import type { ObserverMode, TrailMode } from '../../app/observerMode'
import type { PerfStats } from '../../app/perfMeter'
import type { PlayerTraversalMode } from '../../app/playerTraversal'
import { canRespawnOnAxisEnd, getPresetName } from '../../presets/presetManager'
import { getHabitatSpan } from '../../sim/habitatConfig'
import type { SettingsStore } from '../../state/settingsStore'
import { rpmToOmega } from '../../units/units'
import type { ControlPlatform } from '../../xr/controlScheme'
import type { WatchActionId } from './watchLayout'
import { parseWatchParameterAction } from './watchSchema'

export type WatchRenderSnapshot = {
  playerMode: PlayerTraversalMode
  // Which control scheme the legend should show (PC / SP / VR).
  platform: ControlPlatform
  region: 'inside' | 'outside'
  observerMode: ObserverMode
  trailMode: TrailMode
  absoluteVelocityX: number
  absoluteVelocityY: number
  absoluteVelocityZ: number
  absoluteSpeed: number
  habitatType: 'cylinder' | 'ring'
  currentPresetId: string
  currentPresetName: string
  radius: number
  span: number
  length: number
  dayCycleSeconds: number
  rpm: number
  omega: number
  wallSpeed: number
  surfaceGravity: number
  // Measured felt g-force (proper acceleration, m/s²) and the car's speed
  // (m/s, < 0 while on foot) — live readouts, not derived from the store.
  feltGravity: number
  feltSpeed: number
  simScale: number
  ballCount: number
  throwScale: number
  jetpackAcceleration: number
  reattachThreshold: number
  axisEndRespawnEnabled: boolean
  // Latched weather state, so the Rain toggle can render its on-state.
  raining: boolean
  // Live perf readouts (windowed fps, last-frame renderer counters) and the
  // active depth-buffer mode, for the wrist perf line and the RENDER card.
  fps: number
  drawCalls: number
  triangles: number
  depthMode: DepthMode
  radiusFineStep: number
  radiusCoarseStep: number
  lengthFineStep: number
  lengthCoarseStep: number
  dayCycleFineStep: number
  dayCycleCoarseStep: number
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
    platform: ControlPlatform
    region: 'inside' | 'outside'
    observerMode: ObserverMode
    trailMode: TrailMode
    ballCount: number
    feltGravity: number
    feltSpeed: number
    raining: boolean
    perf: PerfStats
    depthMode: DepthMode
    absoluteVelocity: {
      x: number
      y: number
      z: number
      speed: number
    }
  }
): WatchRenderSnapshot => ({
  playerMode: runtime.playerMode,
  platform: runtime.platform,
  region: runtime.region,
  observerMode: runtime.observerMode,
  trailMode: runtime.trailMode,
  absoluteVelocityX: runtime.absoluteVelocity.x,
  absoluteVelocityY: runtime.absoluteVelocity.y,
  absoluteVelocityZ: runtime.absoluteVelocity.z,
  absoluteSpeed: runtime.absoluteVelocity.speed,
  habitatType: settingsStore.habitat.type,
  currentPresetId: settingsStore.habitat.currentPresetId,
  currentPresetName: getPresetName(settingsStore.habitat.currentPresetId),
  radius: settingsStore.habitat.radius,
  span: getHabitatSpan(settingsStore.habitat),
  length: settingsStore.habitat.length,
  dayCycleSeconds: settingsStore.environment.dayCycleSeconds,
  rpm: settingsStore.habitat.rpm,
  omega: rpmToOmega(settingsStore.habitat.rpm),
  wallSpeed: rpmToOmega(settingsStore.habitat.rpm) * settingsStore.habitat.radius,
  surfaceGravity: settingsStore.getSurfaceGravity(),
  feltGravity: runtime.feltGravity,
  feltSpeed: runtime.feltSpeed,
  raining: runtime.raining,
  fps: runtime.perf.fps,
  drawCalls: runtime.perf.drawCalls,
  triangles: runtime.perf.triangles,
  depthMode: runtime.depthMode,
  simScale: settingsStore.habitat.simScale,
  ballCount: runtime.ballCount,
  throwScale: settingsStore.habitat.ballSpeedScale,
  jetpackAcceleration: settingsStore.habitat.jetpackAcceleration,
  reattachThreshold: settingsStore.reattach.radialTolerance,
  axisEndRespawnEnabled: canRespawnOnAxisEnd(settingsStore.habitat.type),
  radiusFineStep: settingsStore.getRadiusFineStep(),
  radiusCoarseStep: settingsStore.getRadiusCoarseStep(),
  lengthFineStep: settingsStore.getLengthFineStep(),
  lengthCoarseStep: settingsStore.getLengthCoarseStep(),
  dayCycleFineStep: settingsStore.getDayCycleFineStep(),
  dayCycleCoarseStep: settingsStore.getDayCycleCoarseStep(),
  rpmFineStep: settingsStore.getRpmFineStep(),
  rpmCoarseStep: settingsStore.getRpmCoarseStep(),
  throwScaleFineStep: settingsStore.getThrowScaleFineStep(),
  throwScaleCoarseStep: settingsStore.getThrowScaleCoarseStep(),
  jetpackAccelerationFineStep: settingsStore.getJetpackAccelerationFineStep(),
  jetpackAccelerationCoarseStep: settingsStore.getJetpackAccelerationCoarseStep(),
  reattachThresholdFineStep: settingsStore.getReattachThresholdFineStep(),
  reattachThresholdCoarseStep: settingsStore.getReattachThresholdCoarseStep()
})

export const isWatchActionDisabled = (
  snapshot: WatchRenderSnapshot,
  action: WatchActionId
) => {
  if (action === 'respawn-axis-end') {
    return !snapshot.axisEndRespawnEnabled
  }

  return false
}

export const applyWatchAction = (
  settingsStore: SettingsStore,
  action: WatchActionId
) => {
  const parameterAction = parseWatchParameterAction(action)

  if (parameterAction !== null) {
    switch (parameterAction.prefix) {
      case 'rpm':
        settingsStore.adjustRpm(parameterAction.ticks, parameterAction.mode)
        return true
      case 'radius':
        settingsStore.adjustRadius(parameterAction.ticks, parameterAction.mode)
        return true
      case 'length':
        settingsStore.adjustLength(parameterAction.ticks, parameterAction.mode)
        return true
      case 'day-cycle':
        settingsStore.adjustDayCycle(parameterAction.ticks, parameterAction.mode)
        return true
      case 'throw-scale':
        settingsStore.adjustThrowScale(parameterAction.ticks, parameterAction.mode)
        return true
      case 'jetpack-acceleration':
        settingsStore.adjustJetpackAcceleration(parameterAction.ticks, parameterAction.mode)
        return true
      case 'reattach-threshold':
        settingsStore.adjustReattachThreshold(parameterAction.ticks, parameterAction.mode)
        return true
      default: {
        const _: never = parameterAction.prefix
        return _
      }
    }
  }

  return false
}
