export type FarFieldMode = 'night' | 'day' | 'auto'

export type FarFieldSettings = {
  enabled: boolean
  mode: FarFieldMode
  intensity: number
  density: number
  bandHeight_m: number
  bandArc_deg: number
  parallaxLayers: 1 | 2 | 3
  parallaxOffset_m: number
  textureSize: 256 | 512 | 1024
  updateInterval_s: number
}

export const DEFAULT_FAR_FIELD_SETTINGS: FarFieldSettings = {
  enabled: true,
  mode: 'night',
  intensity: 1,
  density: 0.5,
  bandHeight_m: 700,
  bandArc_deg: 110,
  parallaxLayers: 2,
  parallaxOffset_m: 90,
  textureSize: 512,
  updateInterval_s: 0
}

export const resolveFarFieldMode = (
  mode: FarFieldMode,
  presetId: string
): Exclude<FarFieldMode, 'auto'> => {
  if (mode !== 'auto') {
    return mode
  }

  return presetId === 'elysium' ? 'day' : 'night'
}
