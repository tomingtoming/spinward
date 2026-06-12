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
  if (isTouchDevice() && !isQuestBrowser()) {
    return { pixelRatioCap: 1.75, maxBuildings: 4000, cloudDensity: 0.5 }
  }

  if (isQuestBrowser()) {
    return { pixelRatioCap: Number.POSITIVE_INFINITY, maxBuildings: 12000, cloudDensity: 0.7 }
  }

  return { pixelRatioCap: Number.POSITIVE_INFINITY, maxBuildings: 24000, cloudDensity: 1 }
}
