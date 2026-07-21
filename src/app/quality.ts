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
  // Whether sets WITHOUT an authored low-detail model (suburban, skyscraper,
  // industrial) may keep their full kit geometry in the LOD1 band. Off on
  // mobile GPUs: full geometry at LOD1 range is what melted Quest to 20 fps —
  // there the harmonized boxes take over directly beyond LOD0.
  lod1FullKitGeometry: boolean
  // Kenney road-tile overlay (curbs/sidewalks/junction pieces) range around
  // the player. A few hundred instances in ≤5 draw calls; the painted roads
  // remain the far LOD.
  roadTileDistance: number
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
      maxBuildings: 16000,
      farMinAngularSize: 0.01,
      maxTraffic: 120,
      // The Izma spawn is an arterial crossroads: even after core infill, the
      // first facade centres sit tens of metres beyond the road and sidewalk.
      // The current phone path still has headroom: spend it on visible street
      // walls, while the aggressive far cull and 1.75 DPR cap stay unchanged.
      detailedLod0Distance: 150,
      detailedLod1Distance: 340,
      maxDetailedLod0: 180,
      maxDetailedLod1: 700,
      lod1FullKitGeometry: false,
      roadTileDistance: 130,
      bloom: false,
      rainStreaks: 2600
    }
  }

  if (isQuestBrowser()) {
    return {
      pixelRatioCap: Number.POSITIVE_INFINITY,
      maxBuildings: 18000,
      farMinAngularSize: 0.004,
      maxTraffic: 160,
      detailedLod0Distance: 120,
      detailedLod1Distance: 420,
      maxDetailedLod0: 220,
      maxDetailedLod1: 900,
      lod1FullKitGeometry: false,
      roadTileDistance: 150,
      bloom: false,
      rainStreaks: 4200
    }
  }

  return {
    pixelRatioCap: Number.POSITIVE_INFINITY,
    maxBuildings: 48000,
    farMinAngularSize: 0.004,
    maxTraffic: 420,
    detailedLod0Distance: 280,
    detailedLod1Distance: 900,
    maxDetailedLod0: 800,
    maxDetailedLod1: 2800,
    lod1FullKitGeometry: true,
    roadTileDistance: 240,
    bloom: true,
    rainStreaks: 7000
  }
}
