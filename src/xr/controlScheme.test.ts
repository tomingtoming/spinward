import { expect, test } from 'bun:test'

import {
  VR_CONTROL_LEGEND,
  XR_BUTTON,
  formatModeControlsLine,
  formatVrControlsText,
  legendForMode
} from './controlScheme'

test('XR_BUTTON matches the xr-standard Quest layout', () => {
  expect(XR_BUTTON.trigger).toBe(0)
  expect(XR_BUTTON.grip).toBe(1)
  expect(XR_BUTTON.A).toBe(4)
  expect(XR_BUTTON.B).toBe(5)
})

test('legend covers grounded, free-fly and driving with non-empty bindings', () => {
  const modes = VR_CONTROL_LEGEND.map((section) => section.mode)
  expect(modes).toEqual(['grounded', 'free-fly', 'driving'])
  for (const section of VR_CONTROL_LEGEND) {
    expect(section.bindings.length).toBeGreaterThan(0)
  }
})

test('legendForMode resolves each mode and falls back to grounded', () => {
  expect(legendForMode('free-fly').mode).toBe('free-fly')
  expect(legendForMode('driving').mode).toBe('driving')
  // Unknown modes fall back to the first (grounded) section.
  expect(legendForMode('nonsense' as 'grounded').mode).toBe('grounded')
})

const actionFor = (mode: 'grounded' | 'free-fly' | 'driving', input: string) =>
  legendForMode(mode).bindings.find((b) => b.input === input)?.action

test('scheme C contract: A = up on both hands, B = menu on both hands', () => {
  // A is "up": jump on the ground, ascend in flight — on either hand.
  expect(actionFor('grounded', 'A (either)')).toMatch(/jump/i)
  expect(actionFor('free-fly', 'A (either)')).toMatch(/ascend/i)
  // B is "menu": recenter on the left, travel/warp on the right.
  expect(actionFor('grounded', 'L B')).toMatch(/recenter/i)
  expect(actionFor('grounded', 'R B')).toMatch(/travel/i)
})

test('scheme C contract: left grip stops in flight, climbs on the ground', () => {
  expect(actionFor('grounded', 'L Grip')).toMatch(/climb/i)
  expect(actionFor('free-fly', 'L Grip')).toMatch(/stop|brake/i)
  // Forward thrust is the left trigger in flight.
  expect(actionFor('free-fly', 'L Trigger')).toMatch(/thrust/i)
})

test('formatModeControlsLine renders that platform\'s bindings for one mode', () => {
  expect(formatModeControlsLine('pc', 'driving')).toBe(
    'W / S: Drive · A / D: Steer · Space: Brake · E: Exit'
  )
  expect(formatModeControlsLine('sp', 'driving')).toBe(
    'Stick: Drive / steer · Button: Brake / exit'
  )
})

test('formatVrControlsText renders every mode and binding for the HUD', () => {
  const text = formatVrControlsText()
  expect(text).toContain('ON FOOT')
  expect(text).toContain('FLYING')
  expect(text).toContain('DRIVING')
  expect(text).toContain('Stop (brake)')
  expect(text).toContain('Recenter')
})
