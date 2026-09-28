import type { QualityTier } from '../app/quality'

// Flat-screen DPR does not constrain the XR framebuffer. Standalone headsets
// allocate stereo color/depth targets at entry, in addition to resident city
// assets. In three r180, antialias also creates a 4x MSAA projection target.
export const xrRenderProfile = (tier: QualityTier, questBrowser: boolean, requestedScale: string | null = null) => {
  const standalone = questBrowser || tier === 'quest'
  // Preserve the runtime's reference resolution; distant city detail adapts
  // separately. Keep the standalone context free of MSAA. A URL override permits physical-headset A/B tests
  // after reload; native XR targets cannot be resized during a session.
  const scale = Number(requestedScale)
  const standaloneScale = Number.isFinite(scale) && scale >= 0.7 && scale <= 1 ? scale : 1
  return {
    name: standalone ? 'standalone' : 'default',
    antialias: !standalone,
    framebufferScale: standalone ? standaloneScale : 1,
    foveation: 1
  } as const
}
