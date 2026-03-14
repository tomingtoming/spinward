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
const getAdaptiveStep = (
  value: number,
  significantDigits: number,
  minStep: number
) => {
  const magnitude = Math.max(Math.abs(value), minStep)
  const exponent = Math.floor(Math.log10(magnitude)) - significantDigits + 1
  return Math.max(minStep, 10 ** exponent)
}

type StepMode = 'fine' | 'coarse'

const selectStep = (fineStep: number, mode: StepMode) =>
  mode === 'coarse' ? fineStep * 10 : fineStep

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
  const getRadiusFineStep = () => getAdaptiveStep(habitat.radius, 2, 1)
  const getRadiusCoarseStep = () => selectStep(getRadiusFineStep(), 'coarse')
  const getRpmFineStep = () => getAdaptiveStep(habitat.rpm, 3, 0.01)
  const getRpmCoarseStep = () => selectStep(getRpmFineStep(), 'coarse')
  const getThrowScaleFineStep = () => getAdaptiveStep(habitat.ballSpeedScale, 3, 0.01)
  const getThrowScaleCoarseStep = () => selectStep(getThrowScaleFineStep(), 'coarse')
  const getLandingAssistFineStep = () => getAdaptiveStep(reattach.assistNormalDamping, 2, 0.1)
  const getLandingAssistCoarseStep = () => selectStep(getLandingAssistFineStep(), 'coarse')
  const getReattachThresholdFineStep = () => getAdaptiveStep(reattach.radialTolerance, 2, 0.01)
  const getReattachThresholdCoarseStep = () =>
    selectStep(getReattachThresholdFineStep(), 'coarse')

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
    getRadiusFineStep,
    getRadiusCoarseStep,
    getRpmFineStep,
    getRpmCoarseStep,
    getThrowScaleFineStep,
    getThrowScaleCoarseStep,
    getLandingAssistFineStep,
    getLandingAssistCoarseStep,
    getReattachThresholdFineStep,
    getReattachThresholdCoarseStep,
    adjustRadius(ticks: number, mode: StepMode = 'fine') {
      const step = selectStep(getRadiusFineStep(), mode)
      habitat.radius = clamp(roundToStep(habitat.radius + step * ticks, step), 10, 2000)
      notify()
    },
    adjustRpm(ticks: number, mode: StepMode = 'fine') {
      const step = selectStep(getRpmFineStep(), mode)
      habitat.rpm = clamp(roundToStep(habitat.rpm + step * ticks, step), 0, 12)
      notify()
    },
    adjustThrowScale(ticks: number, mode: StepMode = 'fine') {
      const step = selectStep(getThrowScaleFineStep(), mode)
      habitat.ballSpeedScale = clamp(
        roundToStep(habitat.ballSpeedScale + step * ticks, step),
        0.25,
        3
      )
      notify()
    },
    adjustLandingAssist(ticks: number, mode: StepMode = 'fine') {
      const baseStep = selectStep(getLandingAssistFineStep(), mode) * ticks
      reattach.assistNormalDamping = clamp(
        roundToStep(reattach.assistNormalDamping + baseStep, 0.1),
        0,
        12
      )
      reattach.assistSurfaceDamping = clamp(
        roundToStep(reattach.assistSurfaceDamping + baseStep * 0.58, 0.05),
        0,
        8
      )
      reattach.assistRadialPull = clamp(
        roundToStep(reattach.assistRadialPull + baseStep * 0.42, 0.05),
        0,
        6
      )
      notify()
    },
    adjustReattachThreshold(ticks: number, mode: StepMode = 'fine') {
      const baseStep = selectStep(getReattachThresholdFineStep(), mode) * ticks
      reattach.radialTolerance = clamp(
        roundToStep(reattach.radialTolerance + baseStep, 0.01),
        0.05,
        1.2
      )
      reattach.maxNormalSpeed = clamp(
        roundToStep(reattach.maxNormalSpeed + baseStep * 2, 0.05),
        0.1,
        4
      )
      reattach.maxSurfaceSpeed = clamp(
        roundToStep(reattach.maxSurfaceSpeed + baseStep * 3, 0.05),
        0.1,
        6
      )
      notify()
    }
  }
}
