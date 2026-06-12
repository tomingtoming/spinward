import { isTouchDevice } from '../pc/mobileControls'

// Render-quality budget per device class. Phone GPUs are tile-based and
// drown in fragment work: cap the backing-store resolution and thin the
// densest content instead of letting the frame rate collapse.
export type QualityProfile = {
  pixelRatioCap: number
  maxBuildings: number | undefined
  cloudDensity: number
}

export const getQualityProfile = (): QualityProfile =>
  isTouchDevice()
    ? { pixelRatioCap: 1.75, maxBuildings: 4000, cloudDensity: 0.5 }
    : { pixelRatioCap: Number.POSITIVE_INFINITY, maxBuildings: undefined, cloudDensity: 1 }
