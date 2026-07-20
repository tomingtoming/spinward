// Depth-buffer strategy A/B for the on-device perf hunt. Log depth writes
// gl_FragDepth, which disables early-Z — on tile GPUs (Quest, phones) every
// occluded fragment of the night city still shades. Plain depth restores
// early-Z but z-fights at colony scale. This toggle exists to price that tax
// with real numbers and real eyes. (Reversed-Z would give both, but three's
// WebXR path takes projection matrices straight from the XR runtime, so the
// reversedDepthBuffer flag cannot apply in-headset.)
export type DepthMode = 'log' | 'plain'

const STORAGE_KEY = 'spinward.depthMode'

// URL param (?depth=plain) wins over the persisted choice; anything
// unrecognized falls through to the default.
export const resolveDepthMode = (
  urlValue: string | null,
  storedValue: string | null
): DepthMode => {
  if (urlValue === 'log' || urlValue === 'plain') {
    return urlValue
  }

  if (storedValue === 'log' || storedValue === 'plain') {
    return storedValue
  }

  return 'log'
}

export const loadDepthMode = (): DepthMode => {
  let stored: string | null = null

  try {
    stored = window.localStorage.getItem(STORAGE_KEY)
  } catch {
    // Storage can be unavailable (private mode); the URL param still works.
  }

  return resolveDepthMode(
    new URLSearchParams(window.location.search).get('depth'),
    stored
  )
}

// A renderer cannot change its depth strategy after creation, so the switch
// persists the flip and reloads. The ?depth= param is stripped from the URL
// or it would override the persisted choice and the button would look stuck.
export const toggleDepthModeAndReload = (current: DepthMode) => {
  const next: DepthMode = current === 'log' ? 'plain' : 'log'

  try {
    window.localStorage.setItem(STORAGE_KEY, next)
  } catch {
    // Without storage the reload below still applies the flip via the URL.
    const fallback = new URL(window.location.href)
    fallback.searchParams.set('depth', next)
    window.location.replace(fallback.toString())
    return
  }

  const url = new URL(window.location.href)
  url.searchParams.delete('depth')
  window.location.replace(url.toString())
}
