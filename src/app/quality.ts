import { isQuestBrowser, isTouchDevice } from '../pc/mobileControls'

// Render-quality budget per device class. Phone GPUs are tile-based and
// drown in fragment work: cap the backing-store resolution and thin the
// densest content instead of letting the frame rate collapse.
export type QualityProfile = {
  pixelRatioCap: number
  maxBuildings: number | undefined
  // Angular size (radians) below which far-batch buildings are culled. This
  // knob trades far-side instance count against near-arc plan density:
  // raising it pays for a denser plan without touching the arc you stand in.
  farMinAngularSize: number
  // Ambient traffic budget (cars simulated+drawn around the focus arc).
  maxTraffic: number
  // Bloom (EffectComposer) glow for the night city. Off on phones (fragment
  // budget) and in the Quest browser — EffectComposer does not compose with
  // WebXR's multi-view rendering anyway, so bloom is a desktop/flat-screen treat.
  bloom: boolean
  // Rain streak count (one LineSegments draw call; each drop is 2 vertices).
  rainStreaks: number
}

export const getQualityProfile = (): QualityProfile => {
  // Budgets assume the azimuth-bucket LOD: only the near arc carries
  // full-detail shapes, the rest are plain instanced boxes.
  if (isTouchDevice() && !isQuestBrowser()) {
    // Phones spend their building budget on the near arc, not spread thin: a
    // uniform maxBuildings cut dilutes the arc you stand in — the only place
    // a small screen reads archetype variety — while most of what it saves
    // is far-side boxes that are sub-pixel at 1.75 DPR anyway. So the plan is
    // 2x denser than before and the far cull threshold 2.5x higher; measured
    // on Izma this doubles the near arc while total drawn instances rise
    // only ~16% (3,140 → 3,644).
    return {
      pixelRatioCap: 1.75,
      maxBuildings: 12000,
      farMinAngularSize: 0.01,
      maxTraffic: 160,
      bloom: false,
      rainStreaks: 2600
    }
  }

  if (isQuestBrowser()) {
    return {
      pixelRatioCap: Number.POSITIVE_INFINITY,
      maxBuildings: 18000,
      farMinAngularSize: 0.004,
      maxTraffic: 280,
      bloom: false,
      rainStreaks: 4200
    }
  }

  return {
    pixelRatioCap: Number.POSITIVE_INFINITY,
    maxBuildings: 48000,
    farMinAngularSize: 0.004,
    maxTraffic: 420,
    bloom: true,
    rainStreaks: 7000
  }
}
