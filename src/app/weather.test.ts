import { describe, expect, test } from 'bun:test'

import {
  RAIN_RAMP_DOWN_SECONDS,
  RAIN_RAMP_UP_SECONDS,
  createWeatherState,
  stepWeather
} from './weather'

describe('weather rain level', () => {
  test('boots dry by default and mid-shower from a deep link', () => {
    expect(createWeatherState().rainLevel).toBe(0)
    expect(createWeatherState(true).rainLevel).toBe(1)
  })

  test('ramps up over the fade-in time and clamps at 1', () => {
    const state = createWeatherState()
    state.raining = true
    stepWeather(state, RAIN_RAMP_UP_SECONDS / 2)
    expect(state.rainLevel).toBeCloseTo(0.5, 5)
    stepWeather(state, RAIN_RAMP_UP_SECONDS)
    expect(state.rainLevel).toBe(1)
  })

  test('ramps back down and clamps at 0', () => {
    const state = createWeatherState(true)
    state.raining = false
    stepWeather(state, RAIN_RAMP_DOWN_SECONDS / 3)
    expect(state.rainLevel).toBeCloseTo(2 / 3, 5)
    stepWeather(state, RAIN_RAMP_DOWN_SECONDS * 2)
    expect(state.rainLevel).toBe(0)
  })

  test('a zero or negative delta leaves the level alone', () => {
    const state = createWeatherState()
    state.raining = true
    stepWeather(state, 0)
    expect(state.rainLevel).toBe(0)
    stepWeather(state, -1)
    expect(state.rainLevel).toBe(0)
  })
})
