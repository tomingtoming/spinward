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

// PC (keyboard + mouse) scheme, same shape as the VR legend so the wrist /
// quick-panel legend and the HUD drawer can render whichever the platform is.
export const PC_CONTROL_LEGEND: readonly ControlSection[] = [
  {
    mode: 'grounded',
    title: 'ON FOOT',
    bindings: [
      { input: 'WASD', action: 'Walk' },
      { input: 'Mouse / arrows', action: 'Look' },
      { input: 'Space', action: 'Jump → fly' },
      { input: 'Click', action: 'Throw (hold = charge)' },
      { input: 'X', action: 'Cycle projectile' },
      { input: '1–4', action: 'Travel / warp' },
      { input: 'E', action: 'Drive (near car)' }
    ]
  },
  {
    mode: 'free-fly',
    title: 'FLYING',
    bindings: [
      { input: 'WASD', action: 'Thrust' },
      { input: 'Space', action: 'Ascend' },
      { input: 'Shift', action: 'Descend' },
      { input: 'Q / E', action: 'Roll' },
      { input: 'B', action: 'Roll brake' },
      { input: 'Click', action: 'Fire / throw' },
      { input: 'F', action: 'Launch' },
      { input: '1–4', action: 'Travel / warp' }
    ]
  },
  {
    mode: 'driving',
    title: 'DRIVING',
    bindings: [
      { input: 'W / S', action: 'Drive' },
      { input: 'A / D', action: 'Steer' },
      { input: 'Space', action: 'Brake' },
      { input: 'E', action: 'Exit' }
    ]
  }
]

// SP (touchscreen) scheme.
export const SP_CONTROL_LEGEND: readonly ControlSection[] = [
  {
    mode: 'grounded',
    title: 'ON FOOT',
    bindings: [
      { input: 'L stick', action: 'Walk' },
      { input: 'Drag', action: 'Look' },
      { input: 'Tap', action: 'Throw' },
      { input: 'Buttons', action: 'Jump / travel' },
      { input: 'Gyro btn', action: 'Tilt-look' }
    ]
  },
  {
    mode: 'free-fly',
    title: 'FLYING',
    bindings: [
      { input: 'L stick', action: 'Move' },
      { input: 'Drag', action: 'Look' },
      { input: 'Tap', action: 'Fire / throw' },
      { input: 'Buttons', action: 'Travel / warp' }
    ]
  },
  {
    mode: 'driving',
    title: 'DRIVING',
    bindings: [
      { input: 'Stick', action: 'Drive / steer' },
      { input: 'Button', action: 'Brake / exit' }
    ]
  }
]

export const PC_CONTROL_SUMMARY =
  'WASD + mouse · click throws (hold to charge) · X cycles ammo · 1–4 travel'
export const SP_CONTROL_SUMMARY =
  'Left stick walks · drag to look · tap throws · buttons jump / travel'

export type ControlPlatform = 'pc' | 'sp' | 'vr'

// The legend + one-line summary for a platform — the single switch the legend
// renderer and the HUD drawer both read.
export const getControlScheme = (
  platform: ControlPlatform
): { summary: string; sections: readonly ControlSection[]; prefix: string } => {
  if (platform === 'pc') {
    return { summary: PC_CONTROL_SUMMARY, sections: PC_CONTROL_LEGEND, prefix: 'PC' }
  }
  if (platform === 'sp') {
    return { summary: SP_CONTROL_SUMMARY, sections: SP_CONTROL_LEGEND, prefix: 'Mobile' }
  }
  return { summary: VR_CONTROL_SUMMARY, sections: VR_CONTROL_LEGEND, prefix: 'VR' }
}

// One mode's bindings as a single line, e.g. for the tour card that
// introduces driving — reuses the same per-platform sections as the HUD
// drawer and the watch legend so the three can never drift apart.
export const formatModeControlsLine = (
  platform: ControlPlatform,
  mode: ControlMode
): string => {
  const { sections } = getControlScheme(platform)
  const section = sections.find((s) => s.mode === mode) ?? sections[0]
  return section.bindings.map((b) => `${b.input}: ${b.action}`).join(' · ')
}

// Compact single-line controls string for the HUD drawer, for any platform.
export const formatControlsText = (platform: ControlPlatform): string => {
  const { sections, prefix } = getControlScheme(platform)
  return (
    `${prefix} — ` +
    sections
      .map(
        (section) =>
          `${section.title}: ` +
          section.bindings.map((b) => `${b.input}: ${b.action}`).join(' | ')
      )
      .join('  //  ')
  )
}
