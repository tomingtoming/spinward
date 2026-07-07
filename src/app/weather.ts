// Weather is one scalar for now: how much rain. The toggle sets the target
// and the level glides toward it, so a tap fades the shower in/out instead of
// snapping a wall of streaks on screen.

export const RAIN_RAMP_UP_SECONDS = 3
export const RAIN_RAMP_DOWN_SECONDS = 1.5

export type WeatherState = {
  raining: boolean
  rainLevel: number
}

export const createWeatherState = (raining = false): WeatherState => ({
  raining,
  // Deep links (?rain) boot mid-shower; no reason to replay the fade-in.
  rainLevel: raining ? 1 : 0
})

export const stepWeather = (state: WeatherState, deltaSeconds: number) => {
  const target = state.raining ? 1 : 0
  const seconds = state.raining ? RAIN_RAMP_UP_SECONDS : RAIN_RAMP_DOWN_SECONDS
  const maxStep = Math.max(0, deltaSeconds) / seconds

  if (state.rainLevel < target) {
    state.rainLevel = Math.min(target, state.rainLevel + maxStep)
  } else if (state.rainLevel > target) {
    state.rainLevel = Math.max(target, state.rainLevel - maxStep)
  }

  return state.rainLevel
}
