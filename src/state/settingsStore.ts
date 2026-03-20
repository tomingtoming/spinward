import { DEFAULT_REATTACH_TUNING, type ReattachTuning } from '../app/playerTraversal'
import {
  DEFAULT_FAR_FIELD_SETTINGS,
  type FarFieldMode,
  type FarFieldSettings
} from '../render/farField/farFieldSettings'
import {
  DEFAULT_HABITAT_CONFIG,
  type HabitatConfig
} from '../sim/habitatConfig'
import { rpmToOmega, surfaceG } from '../units/units'
import {
  DEFAULT_LOCOMOTION_PROFILE_ID,
  getLocomotionProfile,
  type LocomotionProfileId
} from '../xr/locomotionProfile'

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
  reattachOverrides: Partial<ReattachTuning> = {},
  farFieldOverrides: Partial<FarFieldSettings> = {}
) => {
  const habitat = {
    ...DEFAULT_HABITAT_CONFIG,
    ...habitatOverrides
  }
  const reattach = {
    ...DEFAULT_REATTACH_TUNING,
    ...reattachOverrides
  }
  const farField = {
    ...DEFAULT_FAR_FIELD_SETTINGS,
    ...farFieldOverrides
  }
  let locomotionProfileId: LocomotionProfileId = DEFAULT_LOCOMOTION_PROFILE_ID
  const listeners = new Set<SettingsListener>()
  const markHabitatCustom = () => {
    habitat.currentPresetId = 'custom'
  }

  const notify = () => {
    for (const listener of listeners) {
      listener()
    }
  }
  const getRadiusFineStep = () => getAdaptiveStep(habitat.radius, 3, 1)
  const getRadiusCoarseStep = () => selectStep(getRadiusFineStep(), 'coarse')
  const getRpmFineStep = () => getAdaptiveStep(habitat.rpm, 3, 0.01)
  const getRpmCoarseStep = () => selectStep(getRpmFineStep(), 'coarse')
  const getThrowScaleFineStep = () => getAdaptiveStep(habitat.ballSpeedScale, 3, 0.01)
  const getThrowScaleCoarseStep = () => selectStep(getThrowScaleFineStep(), 'coarse')
  const getJetpackAccelerationFineStep = () =>
    getAdaptiveStep(habitat.jetpackAcceleration, 3, 0.1)
  const getJetpackAccelerationCoarseStep = () =>
    selectStep(getJetpackAccelerationFineStep(), 'coarse')
  const getFarFieldIntensityFineStep = () => getAdaptiveStep(farField.intensity, 2, 0.05)
  const getFarFieldIntensityCoarseStep = () =>
    selectStep(getFarFieldIntensityFineStep(), 'coarse')
  const getLandingAssistFineStep = () => getAdaptiveStep(reattach.assistNormalDamping, 2, 0.1)
  const getLandingAssistCoarseStep = () => selectStep(getLandingAssistFineStep(), 'coarse')
  const getReattachThresholdFineStep = () => getAdaptiveStep(reattach.radialTolerance, 2, 0.01)
  const getReattachThresholdCoarseStep = () =>
    selectStep(getReattachThresholdFineStep(), 'coarse')

  return {
    habitat,
    reattach,
    farField,
    subscribe(listener: SettingsListener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    notify,
    getSurfaceGravity() {
      return surfaceG(rpmToOmega(habitat.rpm), habitat.radius)
    },
    setHabitatConfig(nextValues: Partial<Pick<
      HabitatConfig,
      'type' | 'radius' | 'length' | 'thickness' | 'rpm' | 'simScale' | 'currentPresetId'
    >>) {
      if (nextValues.type !== undefined) {
        habitat.type = nextValues.type
      }
      if (nextValues.radius !== undefined) {
        habitat.radius = nextValues.radius
      }
      if (nextValues.length !== undefined) {
        habitat.length = nextValues.length
      }
      if (nextValues.thickness !== undefined) {
        habitat.thickness = nextValues.thickness
      }
      if (nextValues.rpm !== undefined) {
        habitat.rpm = nextValues.rpm
      }
      if (nextValues.simScale !== undefined) {
        habitat.simScale = nextValues.simScale
      }
      if (nextValues.currentPresetId !== undefined) {
        habitat.currentPresetId = nextValues.currentPresetId
      }
      notify()
    },
    setFarFieldConfig(nextValues: Partial<FarFieldSettings>) {
      if (nextValues.enabled !== undefined) {
        farField.enabled = nextValues.enabled
      }
      if (nextValues.mode !== undefined) {
        farField.mode = nextValues.mode
      }
      if (nextValues.intensity !== undefined) {
        farField.intensity = clamp(nextValues.intensity, 0, 2)
      }
      if (nextValues.density !== undefined) {
        farField.density = clamp(nextValues.density, 0, 1)
      }
      if (nextValues.bandHeight_m !== undefined) {
        farField.bandHeight_m = clamp(nextValues.bandHeight_m, 300, 1500)
      }
      if (nextValues.bandArc_deg !== undefined) {
        farField.bandArc_deg = clamp(nextValues.bandArc_deg, 60, 140)
      }
      if (nextValues.parallaxLayers !== undefined) {
        farField.parallaxLayers = nextValues.parallaxLayers
      }
      if (nextValues.parallaxOffset_m !== undefined) {
        farField.parallaxOffset_m = clamp(nextValues.parallaxOffset_m, 50, 200)
      }
      if (nextValues.textureSize !== undefined) {
        farField.textureSize = nextValues.textureSize
      }
      if (nextValues.updateInterval_s !== undefined) {
        farField.updateInterval_s = clamp(nextValues.updateInterval_s, 0, 30)
      }
      notify()
    },
    getRadiusFineStep,
    getRadiusCoarseStep,
    getRpmFineStep,
    getRpmCoarseStep,
    getThrowScaleFineStep,
    getThrowScaleCoarseStep,
    getJetpackAccelerationFineStep,
    getJetpackAccelerationCoarseStep,
    getFarFieldIntensityFineStep,
    getFarFieldIntensityCoarseStep,
    getLandingAssistFineStep,
    getLandingAssistCoarseStep,
    getReattachThresholdFineStep,
    getReattachThresholdCoarseStep,
    adjustRadius(ticks: number, mode: StepMode = 'fine') {
      const step = selectStep(getRadiusFineStep(), mode)
      habitat.radius = clamp(roundToStep(habitat.radius + step * ticks, step), 10, 100000)
      markHabitatCustom()
      notify()
    },
    adjustRpm(ticks: number, mode: StepMode = 'fine') {
      const step = selectStep(getRpmFineStep(), mode)
      habitat.rpm = clamp(roundToStep(habitat.rpm + step * ticks, step), 0, 12)
      markHabitatCustom()
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
    adjustJetpackAcceleration(ticks: number, mode: StepMode = 'fine') {
      const step = selectStep(getJetpackAccelerationFineStep(), mode)
      habitat.jetpackAcceleration = clamp(
        roundToStep(habitat.jetpackAcceleration + step * ticks, step),
        1,
        30
      )
      notify()
    },
    setFarFieldEnabled(enabled: boolean) {
      farField.enabled = enabled
      notify()
    },
    setFarFieldMode(mode: FarFieldMode) {
      farField.mode = mode
      notify()
    },
    adjustFarFieldIntensity(ticks: number, mode: StepMode = 'fine') {
      const step = selectStep(getFarFieldIntensityFineStep(), mode)
      farField.intensity = clamp(roundToStep(farField.intensity + step * ticks, step), 0, 2)
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
    },
    getLocomotionProfileId() {
      return locomotionProfileId
    },
    getLocomotionProfile() {
      return getLocomotionProfile(locomotionProfileId)
    },
    setLocomotionProfileId(id: LocomotionProfileId) {
      locomotionProfileId = id
      notify()
    }
  }
}
