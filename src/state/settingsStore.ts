import { DEFAULT_REATTACH_TUNING, type ReattachTuning } from '../app/playerTraversal'
import {
  DEFAULT_HABITAT_CONFIG,
  surfaceGravityFromConfig,
  type HabitatConfig
} from '../sim/habitatConfig'

type SettingsListener = () => void

const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value))

const roundToStep = (value: number, step: number) => Math.round(value / step) * step

export type SettingsStore = ReturnType<typeof createSettingsStore>

export const createSettingsStore = (
  habitatOverrides: Partial<HabitatConfig> = {},
  reattachOverrides: Partial<ReattachTuning> = {}
) => {
  const habitat = {
    ...DEFAULT_HABITAT_CONFIG,
    ...habitatOverrides
  }
  const reattach = {
    ...DEFAULT_REATTACH_TUNING,
    ...reattachOverrides
  }
  const listeners = new Set<SettingsListener>()

  const notify = () => {
    for (const listener of listeners) {
      listener()
    }
  }

  return {
    habitat,
    reattach,
    subscribe(listener: SettingsListener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    notify,
    getSurfaceGravity() {
      return surfaceGravityFromConfig(habitat)
    },
    adjustRadius(delta: number) {
      habitat.radius = clamp(roundToStep(habitat.radius + delta, 10), 10, 2000)
      notify()
    },
    adjustRpm(delta: number) {
      habitat.rpm = clamp(roundToStep(habitat.rpm + delta, 0.1), 0, 12)
      notify()
    },
    adjustThrowScale(delta: number) {
      habitat.ballSpeedScale = clamp(
        roundToStep(habitat.ballSpeedScale + delta, 0.05),
        0.25,
        3
      )
      notify()
    },
    adjustLandingAssist(delta: number) {
      reattach.assistNormalDamping = clamp(
        roundToStep(reattach.assistNormalDamping + delta * 0.6, 0.1),
        0,
        12
      )
      reattach.assistSurfaceDamping = clamp(
        roundToStep(reattach.assistSurfaceDamping + delta * 0.35, 0.05),
        0,
        8
      )
      reattach.assistRadialPull = clamp(
        roundToStep(reattach.assistRadialPull + delta * 0.25, 0.05),
        0,
        6
      )
      notify()
    },
    adjustReattachThreshold(delta: number) {
      reattach.radialTolerance = clamp(
        roundToStep(reattach.radialTolerance + delta * 0.05, 0.01),
        0.05,
        1.2
      )
      reattach.maxNormalSpeed = clamp(
        roundToStep(reattach.maxNormalSpeed + delta * 0.1, 0.05),
        0.1,
        4
      )
      reattach.maxSurfaceSpeed = clamp(
        roundToStep(reattach.maxSurfaceSpeed + delta * 0.15, 0.05),
        0.1,
        6
      )
      notify()
    }
  }
}
