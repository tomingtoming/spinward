// A one-shot "look up" camera reveal for the first grounded boot. The view
// tilts up to show the far side of the colony hanging overhead, holds for a
// beat, then eases back to the horizon so the player starts level and ready.
//
// Why: the strangest, most legible payload of a rotating habitat — the far
// side of town in the sky — is fully built but a cold visitor spawns staring
// down the plaza, instinctively throws a ball, and may never look up. Forcing
// the reveal in the first few seconds turns "huh, a plaza" into "whoa".

export type IntroRevealConfig = {
  riseSeconds: number
  holdSeconds: number
  fallSeconds: number
  peakPitch: number
}

export const DEFAULT_INTRO_REVEAL: IntroRevealConfig = {
  riseSeconds: 1.6,
  holdSeconds: 2.2,
  fallSeconds: 1.9,
  peakPitch: 0.75
}

export const introRevealDurationSeconds = (
  config: IntroRevealConfig = DEFAULT_INTRO_REVEAL
): number => config.riseSeconds + config.holdSeconds + config.fallSeconds

// Smoothstep so the rise and fall have no velocity discontinuity at the ends.
const smoothstep = (t: number): number => {
  const clamped = Math.min(1, Math.max(0, t))
  return clamped * clamped * (3 - 2 * clamped)
}

// Pitch (radians, + is up) for a given time into the reveal. Returns 0 both
// before it starts and after it ends, so applying it unconditionally is a
// no-op once the reveal is complete.
export const introRevealPitch = (
  elapsedSeconds: number,
  config: IntroRevealConfig = DEFAULT_INTRO_REVEAL
): number => {
  const { riseSeconds, holdSeconds, fallSeconds, peakPitch } = config

  if (elapsedSeconds <= 0) {
    return 0
  }

  if (elapsedSeconds < riseSeconds) {
    return peakPitch * smoothstep(elapsedSeconds / riseSeconds)
  }

  const afterRise = elapsedSeconds - riseSeconds
  if (afterRise < holdSeconds) {
    return peakPitch
  }

  const afterHold = afterRise - holdSeconds
  if (afterHold < fallSeconds) {
    return peakPitch * smoothstep(1 - afterHold / fallSeconds)
  }

  return 0
}
