import type { SettingsStore } from '../state/settingsStore'
import { omegaToRpm, periodToOmega } from '../units/units'
import { HABITAT_PRESETS, type Preset } from './presets'

const presetsById = new Map(HABITAT_PRESETS.map((preset) => [preset.id, preset]))

const getPresetRpm = (preset: Preset) =>
  preset.real.rpm ??
  (preset.real.period_s !== undefined
    ? omegaToRpm(periodToOmega(preset.real.period_s))
    : preset.real.omega_rad_s !== undefined
      ? omegaToRpm(preset.real.omega_rad_s)
      : 0)

export const getPresetById = (presetId: string) => presetsById.get(presetId) ?? null

export const getPresetName = (presetId: string) => getPresetById(presetId)?.name ?? 'Custom'

export const getPresetSpanMeters = (preset: Preset) =>
  preset.type === 'ring'
    ? (preset.real.thickness_m ?? 2000)
    : (preset.real.length_m ?? 32000)

export const canRespawnOnAxisEnd = (_type: Preset['type']) => true

export const applyPresetToSettingsStore = (
  settingsStore: SettingsStore,
  presetId: string
) => {
  const preset = getPresetById(presetId)

  if (preset === null) {
    throw new Error(`Unknown preset: ${presetId}`)
  }

  settingsStore.setHabitatConfig({
    type: preset.type,
    radius: preset.real.radius_m,
    length: getPresetSpanMeters(preset),
    thickness: preset.real.thickness_m ?? 0,
    rpm: getPresetRpm(preset),
    simScale: preset.sim.scale,
    currentPresetId: preset.id
  })
  settingsStore.setFarFieldConfig(preset.farField ?? {})

  return preset
}
