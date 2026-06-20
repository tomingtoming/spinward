// Single source of truth for the VR control scheme.
//
// Two things live here so the bindings and the on-controller legend can never
// drift apart:
//   1. XR_BUTTON — the xr-standard gamepad button indices the input code reads.
//   2. VR_CONTROL_LEGEND — the human-facing labels the wrist legend and the HUD
//      controls text render from.
//
// Scheme "C": Left hand flies you, right hand touches the world.
// A is "up" on both hands, B is "menu" on both hands.

// xr-standard gamepad button layout (Meta Quest Touch):
//   0 trigger · 1 grip/squeeze · 2 (unused) · 3 thumbstick press · 4 A/X · 5 B/Y
export const XR_BUTTON = {
  trigger: 0,
  grip: 1,
  stick: 3,
  A: 4,
  B: 5
} as const

export type ControlBinding = {
  input: string
  action: string
}

export type ControlMode = 'grounded' | 'free-fly' | 'driving'

export type ControlSection = {
  mode: ControlMode
  title: string
  bindings: ControlBinding[]
}

// The contract the rest of the code implements. Keep these labels in lockstep
// with the actual reads in vrLocomotion.ts / xrInputMap.ts.
export const VR_CONTROL_LEGEND: readonly ControlSection[] = [
  {
    mode: 'grounded',
    title: 'ON FOOT',
    bindings: [
      { input: 'L Stick', action: 'Walk' },
      { input: 'R Stick', action: 'Snap turn' },
      { input: 'L Grip', action: 'Climb / pull' },
      { input: 'A (either)', action: 'Jump → fly' },
      { input: 'R Trigger', action: 'Grab / throw' },
      { input: 'R B', action: 'Travel / warp' },
      { input: 'L B', action: 'Recenter' }
    ]
  },
  {
    mode: 'free-fly',
    title: 'FLYING',
    bindings: [
      { input: 'L Trigger', action: 'Thrust (point)' },
      { input: 'L Stick', action: 'Strafe / climb' },
      { input: 'A (either)', action: 'Ascend' },
      { input: 'L Grip', action: 'Stop (brake)' },
      { input: 'R Stick', action: 'Snap turn' },
      { input: 'R Trigger', action: 'Grab / throw' },
      { input: 'R B', action: 'Travel / warp' }
    ]
  },
  {
    mode: 'driving',
    title: 'DRIVING',
    bindings: [
      { input: 'L Stick', action: 'Throttle / steer' },
      { input: 'Grip', action: 'Brake' },
      { input: 'R A', action: 'Get out' },
      { input: 'R Stick', action: 'Look' }
    ]
  }
]

// One-liner mental model, shown at the top of the legend and reused in the HUD.
export const VR_CONTROL_SUMMARY =
  'Left hand flies you · right hand touches the world · A = up · B = menu'

export const legendForMode = (mode: ControlMode): ControlSection =>
  VR_CONTROL_LEGEND.find((section) => section.mode === mode) ?? VR_CONTROL_LEGEND[0]

// Compact single-line VR controls string for the desktop HUD's controls drawer,
// generated from the same legend so it cannot drift from the bindings.
export const formatVrControlsText = (): string =>
  VR_CONTROL_LEGEND.map(
    (section) =>
      `${section.title} — ` +
      section.bindings.map((b) => `${b.input}: ${b.action}`).join(' | ')
  ).join('  //  ')
