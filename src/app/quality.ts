import { isTouchDevice } from '../pc/mobileControls'

// Render-quality budget per device class. Phone GPUs are tile-based and
// drown in fragment work: cap the backing-store resolution and thin the
// densest content instead of letting the frame rate collapse.
export type QualityProfile = {
  pixelRatioCap: number
  maxBuildings: number | undefined
  cloudDensity: number
}

const isQuestBrowser = () =>
  typeof navigator !== 'undefined' && /OculusBrowser|Quest/i.test(navigator.userAgent)

export const getQualityProfile = (): QualityProfile => {
  // Budgets assume the azimuth-bucket LOD: only the near arc carries
  // full-detail shapes, the rest are plain instanced boxes.
  if (isTouchDevice() && !isQuestBrowser()) {
    return { pixelRatioCap: 1.75, maxBuildings: 6000, cloudDensity: 0.5 }
  }

  if (isQuestBrowser()) {
    return { pixelRatioCap: Number.POSITIVE_INFINITY, maxBuildings: 18000, cloudDensity: 0.7 }
  }

  return { pixelRatioCap: Number.POSITIVE_INFINITY, maxBuildings: 40000, cloudDensity: 1 }
}
