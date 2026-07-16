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
  // Blender-authored building shells are restricted to a surface-space disk
  // around the active player/car. LOD0 carries fins/balconies; LOD1 keeps only
  // the stepped silhouette. Hard caps bound triangles even in dense blocks.
  detailedLod0Distance: number
  detailedLod1Distance: number
  maxDetailedLod0: number
  maxDetailedLod1: number
  // Bloom (EffectComposer) glow for the night city. Off on phones (fragment
  // budget) and in the Quest browser — EffectComposer does not compose with
  // WebXR's multi-view rendering anyway, so bloom is a desktop/flat-screen treat.
  bloom: boolean
  // Rain streak count (one LineSegments draw call; each drop is 2 vertices).
  rainStreaks: number
}

export const getQualityProfile = (): QualityProfile => {
  // Budgets assume surface-space LOD: only the disk around the active player
  // or car carries authored detail, while the rest are procedural silhouettes.
  if (isTouchDevice() && !isQuestBrowser()) {
    // Phones spend their building budget on the near surface, not spread thin: a
    // uniform maxBuildings cut dilutes the arc you stand in — the only place
    // a small screen reads archetype variety — while most of what it saves
    // is far-side boxes that are sub-pixel at 1.75 DPR anyway. So the plan is
    // denser than the original mobile plan and the far cull threshold stays
    // aggressive. The hard near-LOD caps, rather than an empty spawn radius,
    // now carry the phone GPU budget.
    return {
      pixelRatioCap: 1.75,
      maxBuildings: 12000,
      farMinAngularSize: 0.01,
      maxTraffic: 160,
      // The Izma spawn is an arterial crossroads: even after core infill, the
      // first facade centres sit tens of metres beyond the road and sidewalk.
      // Keep the hard 96-instance cap, but let those frontages enter LOD0.
      detailedLod0Distance: 120,
      detailedLod1Distance: 260,
      maxDetailedLod0: 96,
      maxDetailedLod1: 320,
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
      detailedLod0Distance: 100,
      detailedLod1Distance: 350,
      maxDetailedLod0: 180,
      maxDetailedLod1: 700,
      bloom: false,
      rainStreaks: 4200
    }
  }

  return {
    pixelRatioCap: Number.POSITIVE_INFINITY,
    maxBuildings: 48000,
    farMinAngularSize: 0.004,
    maxTraffic: 420,
    detailedLod0Distance: 180,
    detailedLod1Distance: 600,
    maxDetailedLod0: 420,
    maxDetailedLod1: 1600,
    bloom: true,
    rainStreaks: 7000
  }
}
