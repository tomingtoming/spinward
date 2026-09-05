// Steps the backing-store resolution down — never up — when the first seconds
// after boot run slow. Quality tiers are chosen by device class (quality.ts),
// and 'desktop' covers everything from a gaming PC to a work laptop on an
// integrated GPU at 2x DPR; the tier cannot tell them apart, but the frame
// rate can. Fewer fragments is the one knob that helps every slow GPU, and a
// soft picture beats a slideshow for a visitor who gives the page ten seconds.
//
// Rules that keep it from misfiring: a grace period after boot (shader
// warm-up, the intro reveal); two consecutive slow windows before a step
// (a single hitch is not a slow machine); a window that spans a stall or a
// hidden tab is thrown away; it never steps up (no oscillation); `?dpr=<n>`
// pins the ratio and switches it off.
export type ResolutionGovernorConfig = {
  initialRatio: number
  // Candidate ratios, descending. Only entries strictly below the current
  // ratio are used, so a 1x display goes straight to the sub-1x steps.
  steps: readonly number[]
  thresholdFps: number
  graceSeconds: number
  windowSeconds: number
}

export const DESKTOP_GOVERNOR: Omit<ResolutionGovernorConfig, 'initialRatio'> = {
  steps: [1.5, 1, 0.75],
  thresholdFps: 30,
  graceSeconds: 3,
  windowSeconds: 1.5
}

// A window this many times longer than nominal spans a freeze (debugger,
// system sleep), not slow rendering: thrown away. Generous on purpose — a
// software renderer can take seconds per frame and still deserves the step
// down. Hidden tabs are handled by resume(), not by this guard.
const STALL_FACTOR = 10
const SLOW_WINDOWS_TO_STEP = 2

export const createResolutionGovernor = (config: ResolutionGovernorConfig) => {
  let ratio = config.initialRatio
  let startedAtMs: number | null = null
  let windowStartMs: number | null = null
  let frames = 0
  let slowWindows = 0
  let stepIndex = 0

  return {
    ratio: () => ratio,
    start(nowMs: number) {
      startedAtMs = nowMs
      windowStartMs = null
      frames = 0
      slowWindows = 0
    },
    // The tab came back from hidden: requestAnimationFrame was paused, so the
    // open window measured nothing. Drop it and the slow-window streak.
    resume() {
      windowStartMs = null
      frames = 0
      slowWindows = 0
    },
    // Call once per rendered frame. Returns the new ratio when a step-down is
    // due on this frame, otherwise null.
    frame(nowMs: number): number | null {
      if (startedAtMs === null || nowMs - startedAtMs < config.graceSeconds * 1000) {
        return null
      }
      if (stepIndex >= config.steps.length) {
        return null
      }
      if (windowStartMs === null) {
        windowStartMs = nowMs
        frames = 0
        return null
      }

      frames += 1
      const elapsedSeconds = (nowMs - windowStartMs) / 1000
      if (elapsedSeconds < config.windowSeconds) {
        return null
      }

      windowStartMs = nowMs
      const counted = frames
      frames = 0

      if (elapsedSeconds > config.windowSeconds * STALL_FACTOR) {
        return null
      }

      if (counted / elapsedSeconds >= config.thresholdFps) {
        slowWindows = 0
        return null
      }

      slowWindows += 1
      if (slowWindows < SLOW_WINDOWS_TO_STEP) {
        return null
      }
      slowWindows = 0

      while (stepIndex < config.steps.length && config.steps[stepIndex] >= ratio) {
        stepIndex += 1
      }
      if (stepIndex >= config.steps.length) {
        return null
      }
      ratio = config.steps[stepIndex]
      stepIndex += 1
      return ratio
    }
  }
}

// `?dpr=<n>` pins the backing-store ratio for on-device A/B and switches the
// governor off. Anything unparseable falls back to the device ratio under the
// tier cap, so the param cannot strand a visitor.
export const resolvePixelRatio = (
  urlValue: string | null,
  devicePixelRatio: number,
  cap: number
): { ratio: number; pinned: boolean } => {
  const pinned = urlValue === null ? Number.NaN : Number(urlValue)
  if (Number.isFinite(pinned) && pinned > 0 && pinned <= 4) {
    return { ratio: pinned, pinned: true }
  }
  return { ratio: Math.min(devicePixelRatio, cap), pinned: false }
}
