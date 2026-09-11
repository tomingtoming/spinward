import { isQuestBrowser, isTouchDevice } from '../pc/mobileControls'

export type QualityTier = 'phone' | 'quest' | 'desktop'

// `?tier=` forces a device class for the on-device perf hunt — e.g. desktop
// budgets on a phone to push past the vsync cap, or the quest budgets on a
// phone as an Adreno-family stand-in. Anything unrecognized falls back to
// detection, so the param is impossible to strand a visitor on.
export const resolveQualityTier = (
  urlValue: string | null,
  detected: { touch: boolean; quest: boolean }
): QualityTier => {
  if (urlValue === 'phone' || urlValue === 'quest' || urlValue === 'desktop') {
    return urlValue
  }

  if (detected.quest) {
    return 'quest'
  }

  return detected.touch ? 'phone' : 'desktop'
}

// Render-quality budget per device class. Phone GPUs are tile-based and
// drown in fragment work: cap the backing-store resolution and thin the
// densest content instead of letting the frame rate collapse.
export type QualityProfile = {
  // Device class the rest of the profile was derived from (metrics blob14).
  tier: QualityTier
  pixelRatioCap: number
  maxBuildings: number | undefined
  // Ambient traffic budget around the current surface focus.
  maxTraffic: number
  // Refresh spacing for street access, nearby interiors and traffic routes.
  // Exterior detail and roof budgets belong to ColonyBuildings.
  cityFocusStepMeters: number
  // Optional street-tile overlay range; zero keeps the continuous road surface.
  roadTileDistance: number
  // Bloom (EffectComposer) glow for the night city. Off on phones (fragment
  // budget) and in the Quest browser — EffectComposer does not compose with
  // WebXR's multi-view rendering anyway, so bloom is a desktop/flat-screen treat.
  bloom: boolean
  // Rain streak count (one LineSegments draw call; each drop is 2 vertices).
  rainStreaks: number
  // Meteorological visibility (docs/far-field-lod.md slice ①). 16km on every
  // tier — physically honest for a humid closed atmosphere, and the haze
  // doubles as the mask for the LOD handoffs. Tune on-device via `?fog=<metres>`.
  fogVisibilityMeters: number
  // Emissive canvas width for the far-field city shell bake (slice ②); the
  // albedo layer runs at half. Phones halve it: at 1.75 DPR the far side
  // cannot resolve the difference, and it saves ~24 MB of texture memory.
  cityShellBakeWidth: number
}

export const getQualityProfile = (): QualityProfile => {
  const tier = resolveQualityTier(
    typeof window !== 'undefined'
      ? new URLSearchParams(window.location.search).get('tier')
      : null,
    { touch: isTouchDevice(), quest: isQuestBrowser() }
  )

  // Plan density varies by device; ColonyBuildings owns exterior visibility.
  if (tier === 'phone') {
    return {
      tier,
      pixelRatioCap: 1.75,
      maxBuildings: 16000,
      maxTraffic: 120,
      cityFocusStepMeters: 30,
      roadTileDistance: 0,
      bloom: false,
      rainStreaks: 2600,
      // 16km blessed on-device (toming, 2026-07-22, staging A/B vs 39km/26km/8km).
      fogVisibilityMeters: 16_000,
      cityShellBakeWidth: 2048
    }
  }

  if (tier === 'quest') {
    return {
      tier,
      pixelRatioCap: Number.POSITIVE_INFINITY,
      maxBuildings: 18000,
      maxTraffic: 160,
      cityFocusStepMeters: 24,
      roadTileDistance: 0,
      bloom: false,
      rainStreaks: 4200,
      fogVisibilityMeters: 16_000,
      cityShellBakeWidth: 4096
    }
  }

  return {
    tier,
    pixelRatioCap: Number.POSITIVE_INFINITY,
    // 48k → 64k (2026-09-03, 厚み): the denser core plans ~60k candidates
    // at full keep; the far cull still discards most of them per frame.
    maxBuildings: 64000,
    maxTraffic: 420,
    cityFocusStepMeters: 32,
    roadTileDistance: 0,
    bloom: true,
    rainStreaks: 7000,
    // 16km blessed on the desktop monitor too (toming, 2026-07-22, production
    // `?fog=16000` A/B vs the historical 39km) — every tier now breathes the
    // same humid air.
    fogVisibilityMeters: 16_000,
    cityShellBakeWidth: 4096
  }
}
