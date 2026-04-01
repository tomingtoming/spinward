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

type ScalarStepper = {
  getFineStep: () => number
  getCoarseStep: () => number
  adjust: (ticks: number, mode?: StepMode) => void
}

type ScalarStepperConfig = {
  significantDigits: number
  minStep: number
  min: number
  max: number
  onAdjusted?: () => void
}

type GroupedNumericField = {
  read: () => number
  write: (value: number) => void
  scale: number
  roundStep: number
  min: number
  max: number
}

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
  const createScalarStepper = (
    read: () => number,
    write: (value: number) => void,
    config: ScalarStepperConfig
  ): ScalarStepper => {
    const getFineStep = () =>
      getAdaptiveStep(read(), config.significantDigits, config.minStep)
    const getCoarseStep = () => selectStep(getFineStep(), 'coarse')

    return {
      getFineStep,
      getCoarseStep,
      adjust: (ticks: number, mode: StepMode = 'fine') => {
        const step = selectStep(getFineStep(), mode)
        write(clamp(roundToStep(read() + step * ticks, step), config.min, config.max))
        config.onAdjusted?.()
        notify()
      }
    }
  }

  const adjustGroupedFields = (
    fields: GroupedNumericField[],
    baseStep: number
  ) => {
    for (const field of fields) {
      field.write(
        clamp(
          roundToStep(field.read() + baseStep * field.scale, field.roundStep),
          field.min,
          field.max
        )
      )
    }
  }

  const radiusStepper = createScalarStepper(
    () => habitat.radius,
    (value) => {
      habitat.radius = value
    },
    {
      significantDigits: 3,
      minStep: 1,
      min: 10,
      max: 100000,
      onAdjusted: markHabitatCustom
    }
  )
  const rpmStepper = createScalarStepper(
    () => habitat.rpm,
    (value) => {
      habitat.rpm = value
    },
    {
      significantDigits: 3,
      minStep: 0.01,
      min: 0,
      max: 12,
      onAdjusted: markHabitatCustom
    }
  )
  const throwScaleStepper = createScalarStepper(
    () => habitat.ballSpeedScale,
    (value) => {
      habitat.ballSpeedScale = value
    },
    {
      significantDigits: 3,
      minStep: 0.01,
      min: 0.25,
      max: 3
    }
  )
  const jetpackAccelerationStepper = createScalarStepper(
    () => habitat.jetpackAcceleration,
    (value) => {
      habitat.jetpackAcceleration = value
    },
    {
      significantDigits: 3,
      minStep: 0.1,
      min: 1,
      max: 30
    }
  )
  const farFieldIntensityStepper = createScalarStepper(
    () => farField.intensity,
    (value) => {
      farField.intensity = value
    },
    {
      significantDigits: 2,
      minStep: 0.05,
      min: 0,
      max: 2
    }
  )
  const reattachThresholdConfig: ScalarStepperConfig = {
    significantDigits: 2,
    minStep: 0.01,
    min: 0.05,
    max: 1.2
  }
  const reattachThresholdStepper = createScalarStepper(
    () => reattach.radialTolerance,
    (value) => {
      reattach.radialTolerance = value
    },
    reattachThresholdConfig
  )

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
    getRadiusFineStep: radiusStepper.getFineStep,
    getRadiusCoarseStep: radiusStepper.getCoarseStep,
    getRpmFineStep: rpmStepper.getFineStep,
    getRpmCoarseStep: rpmStepper.getCoarseStep,
    getThrowScaleFineStep: throwScaleStepper.getFineStep,
    getThrowScaleCoarseStep: throwScaleStepper.getCoarseStep,
    getJetpackAccelerationFineStep: jetpackAccelerationStepper.getFineStep,
    getJetpackAccelerationCoarseStep: jetpackAccelerationStepper.getCoarseStep,
    getFarFieldIntensityFineStep: farFieldIntensityStepper.getFineStep,
    getFarFieldIntensityCoarseStep: farFieldIntensityStepper.getCoarseStep,
    getReattachThresholdFineStep: reattachThresholdStepper.getFineStep,
    getReattachThresholdCoarseStep: reattachThresholdStepper.getCoarseStep,
    adjustRadius: radiusStepper.adjust,
    adjustRpm: rpmStepper.adjust,
    adjustThrowScale: throwScaleStepper.adjust,
    adjustJetpackAcceleration: jetpackAccelerationStepper.adjust,
    setFarFieldEnabled(enabled: boolean) {
      farField.enabled = enabled
      notify()
    },
    setFarFieldMode(mode: FarFieldMode) {
      farField.mode = mode
      notify()
    },
    adjustFarFieldIntensity: farFieldIntensityStepper.adjust,
    adjustReattachThreshold(ticks: number, mode: StepMode = 'fine') {
      const baseStep = selectStep(reattachThresholdStepper.getFineStep(), mode) * ticks
      adjustGroupedFields(
        [
          {
            read: () => reattach.radialTolerance,
            write: (value) => {
              reattach.radialTolerance = value
            },
            scale: 1,
            roundStep: reattachThresholdConfig.minStep,
            min: reattachThresholdConfig.min,
            max: reattachThresholdConfig.max
          },
          {
            read: () => reattach.maxNormalSpeed,
            write: (value) => {
              reattach.maxNormalSpeed = value
            },
            scale: 2,
            roundStep: 0.05,
            min: 0.1,
            max: 4
          },
          {
            read: () => reattach.maxSurfaceSpeed,
            write: (value) => {
              reattach.maxSurfaceSpeed = value
            },
            scale: 3,
            roundStep: 0.05,
            min: 0.1,
            max: 6
          }
        ],
        baseStep
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
