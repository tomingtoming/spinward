import type { FarFieldSettings } from './farFieldSettings'

export type FarFieldRuntimeInfo = {
  xrActive: boolean
  devicePixelRatio: number
}

export type FarFieldLodProfile = {
  layerCount: 1 | 2 | 3
  textureSize: 256 | 512 | 1024
  radialSegments: number
  heightSegments: number
  refreshInterval_s: number
}

const clampTextureSizeForXr = (
  requested: 256 | 512 | 1024,
  devicePixelRatio: number
): 256 | 512 => {
  if (requested === 256) {
    return 256
  }

  return devicePixelRatio > 1.3 ? 256 : 512
}

export const resolveFarFieldLodProfile = (
  settings: FarFieldSettings,
  runtime: FarFieldRuntimeInfo
): FarFieldLodProfile => {
  if (!runtime.xrActive) {
    return {
      layerCount: settings.parallaxLayers,
      textureSize: settings.textureSize,
      radialSegments: 64,
      heightSegments: 8,
      refreshInterval_s: settings.updateInterval_s
    }
  }

  const layerCount = Math.min(settings.parallaxLayers, 2) as 1 | 2
  const textureSize = clampTextureSizeForXr(
    settings.textureSize,
    runtime.devicePixelRatio
  )

  return {
    layerCount,
    textureSize,
    radialSegments: 40,
    heightSegments: 4,
    refreshInterval_s:
      settings.updateInterval_s > 0 && settings.updateInterval_s < 3
        ? 3
        : settings.updateInterval_s
  }
}
