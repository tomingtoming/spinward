import { isQuestBrowser, isTouchDevice } from '../pc/mobileControls'

// Render-quality budget per device class. Phone GPUs are tile-based and
// drown in fragment work: cap the backing-store resolution and thin the
// densest content instead of letting the frame rate collapse.
export type QualityProfile = {
  pixelRatioCap: number
  maxBuildings: number | undefined
  cloudDensity: number
  // Bloom (EffectComposer) glow for the night city. Off on phones (fragment
  // budget) and in the Quest browser — EffectComposer does not compose with
  // WebXR's multi-view rendering anyway, so bloom is a desktop/flat-screen treat.
  bloom: boolean
}

export const getQualityProfile = (): QualityProfile => {
  // Budgets assume the azimuth-bucket LOD: only the near arc carries
  // full-detail shapes, the rest are plain instanced boxes.
  if (isTouchDevice() && !isQuestBrowser()) {
    return { pixelRatioCap: 1.75, maxBuildings: 6000, cloudDensity: 0.5, bloom: false }
  }

  if (isQuestBrowser()) {
    return {
      pixelRatioCap: Number.POSITIVE_INFINITY,
      maxBuildings: 18000,
      cloudDensity: 0.7,
      bloom: false
    }
  }

  return {
    pixelRatioCap: Number.POSITIVE_INFINITY,
    maxBuildings: 48000,
    cloudDensity: 1,
    bloom: true
  }
}
