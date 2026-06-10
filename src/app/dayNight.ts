import * as THREE from 'three'

// Phase 0 = midnight, 0.5 = noon. The demo starts mid-morning so the first
// minutes are bright, and a sunset arrives within a short session.
export const DEFAULT_DAY_NIGHT_CYCLE_SECONDS = 180
export const INITIAL_DAY_NIGHT_PHASE = 0.3

// A cycle length of zero (or less) pauses the clock.
export const stepDayNightPhase = (
  phase: number,
  deltaSeconds: number,
  cycleSeconds: number
) => {
  if (cycleSeconds <= 0) {
    return phase
  }

  return THREE.MathUtils.euclideanModulo(
    phase + Math.max(0, deltaSeconds) / cycleSeconds,
    1
  )
}

// Smooth daylight factor: 0 at midnight, 1 at noon.
export const getDaylight = (phase: number) =>
  0.5 - 0.5 * Math.cos(phase * Math.PI * 2)
