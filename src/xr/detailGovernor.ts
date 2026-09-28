// Frame cadence is a pressure signal, not GPU utilization. Never resize the
// XR framebuffer here. Recovery is a slow trial, since vsync hides headroom.
export function createXRDetailGovernor() {
  let level = 0, active = false, previous = NaN, grace = 0, windowStart = 0
  let samples = 0, missed = 0, slowWindows = 0, stableWindows = 0, rate = 0
  let changes = 0, reason = 'inactive', missedRatio = 0
  const clearWindow = (now: number) => { windowStart = now; samples = 0; missed = 0 }
  const resetEvidence = (now: number) => {
    previous = NaN; grace = now + 3000; slowWindows = 0; stableWindows = 0; clearWindow(now)
  }
  return {
    frame(now: number, enabled: boolean, ready: boolean, frameRate: number) {
      if (!enabled) {
        active = false; level = 0; reason = 'inactive'; previous = NaN
        return level
      }
      const target = Number.isFinite(frameRate) && frameRate >= 30 && frameRate <= 144 ? frameRate : 72
      if (!active || target !== rate) {
        active = true; rate = target; resetEvidence(now); reason = 'warming'
      }
      if (!ready) { resetEvidence(now); reason = 'waiting'; return level }
      const dt = now - previous; previous = now
      if (!Number.isFinite(dt) || dt <= 0 || dt > 250) {
        clearWindow(now); slowWindows = 0; stableWindows = 0; return level
      }
      if (now < grace) { clearWindow(now); return level }
      samples++; if (dt > 1000 / rate * 1.35) missed++
      if (now - windowStart < 2000) return level
      missedRatio = samples ? missed / samples : 0
      slowWindows = missedRatio > .12 ? slowWindows + 1 : 0
      stableWindows = missedRatio < .02 ? stableWindows + 1 : 0
      if (slowWindows >= 2 && level < 2) {
        level++; changes++; reason = 'sustained-misses'; resetEvidence(now)
      } else if (stableWindows >= 8 && level > 0) {
        level--; changes++; reason = 'recovery-trial'; resetEvidence(now)
      } else if (level === 2 && slowWindows >= 2) reason = 'detail-floor'
      clearWindow(now)
      return level
    },
    diagnostics: () => ({active, level, frameRate: rate, missedRatio, changes, reason})
  }
}
