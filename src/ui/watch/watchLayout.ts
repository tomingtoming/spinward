import * as THREE from 'three'
import {
  WATCH_PRIMARY_PARAMETER_SPECS,
  type WatchParameterActionId,
  type WatchParameterActionPrefix,
  type WatchParameterRowKey
} from './watchSchema'

export type WatchActionId =
  | 'profile-beginner'
  | 'profile-sim'
  | 'profile-expert'
  | WatchParameterActionId
  | 'preset-apply-playground'
  | 'preset-apply-izma'
  | 'preset-apply-cooper'
  | 'preset-apply-elysium'
  | 'respawn-inner-wall'
  | 'respawn-overlook'
  | 'respawn-axis-end'

export type WatchButton = {
  id: WatchActionId
  label: string
  x: number
  y: number
  width: number
  height: number
}

export type WatchRow = {
  key: WatchParameterRowKey
  label: string
  valueX: number
  valueY: number
  buttons: [WatchButton, WatchButton, WatchButton, WatchButton]
}

export type WatchSection = {
  top: number
  height: number
  title: string
}

export type WatchExpandedLayout = {
  width: number
  height: number
  // Demo-first order: travel up top, then spin (rpm + gravity gauge), then
  // the tinkering parameters.
  travelSection: WatchSection
  spinSection: WatchSection
  parameterSection: WatchSection
  locomotionSection: WatchSection
  presetSection: WatchSection
  spinRow: WatchRow
  gravityGaugeY: number
  rows: WatchRow[]
  profileButtons: [WatchButton, WatchButton, WatchButton]
  presetButtons: [WatchButton, WatchButton, WatchButton, WatchButton]
  respawnButtons: [WatchButton, WatchButton, WatchButton]
  buttons: WatchButton[]
}

export const WATCH_EXPANDED_SIZE = {
  width: 720,
  height: 1340
} as const

const SECTION_LEFT = 30
const SECTION_RIGHT = 30
const CONTENT_LEFT = 50

const makeActionButton = (
  id: WatchActionId,
  label: string,
  x: number,
  y: number,
  width: number,
  height: number
): WatchButton => ({
  id,
  label,
  x,
  y,
  width,
  height
})

const makeRow = (
  key: WatchParameterRowKey,
  label: string,
  actionPrefix: WatchParameterActionPrefix,
  top: number,
  panelWidth: number
): WatchRow => {
  const buttonWidth = 72
  const buttonHeight = 64
  const rightMargin = SECTION_RIGHT + 18
  const coarseIncrementX = panelWidth - rightMargin - buttonWidth
  const fineIncrementX = coarseIncrementX - 84
  const fineDecrementX = fineIncrementX - 84
  const coarseDecrementX = fineDecrementX - 84

  return {
    key,
    label,
    valueX: CONTENT_LEFT,
    valueY: top + 54,
    buttons: [
      {
        id: `${actionPrefix}-coarse-decrement` as WatchActionId,
        label: '--',
        x: coarseDecrementX,
        y: top + 14,
        width: buttonWidth,
        height: buttonHeight
      },
      {
        id: `${actionPrefix}-fine-decrement` as WatchActionId,
        label: '-',
        x: fineDecrementX,
        y: top + 14,
        width: buttonWidth,
        height: buttonHeight
      },
      {
        id: `${actionPrefix}-fine-increment` as WatchActionId,
        label: '+',
        x: fineIncrementX,
        y: top + 14,
        width: buttonWidth,
        height: buttonHeight
      },
      {
        id: `${actionPrefix}-coarse-increment` as WatchActionId,
        label: '++',
        x: coarseIncrementX,
        y: top + 14,
        width: buttonWidth,
        height: buttonHeight
      }
    ]
  }
}

export const createWatchExpandedLayout = (
  width = WATCH_EXPANDED_SIZE.width,
  height = WATCH_EXPANDED_SIZE.height
): WatchExpandedLayout => {
  const spinSpec = WATCH_PRIMARY_PARAMETER_SPECS.find((spec) => spec.key === 'rpm')

  if (spinSpec === undefined) {
    throw new Error('rpm watch parameter spec is required')
  }

  const parameterSpecs = WATCH_PRIMARY_PARAMETER_SPECS.filter(
    (spec) => spec.key !== 'rpm'
  )

  // ── Travel ──
  const travelSection: WatchSection = { top: 168, height: 178, title: 'TRAVEL' }
  const travelButtonY = travelSection.top + 88
  const travelButtonWidth = 200
  const respawnButtons: [WatchButton, WatchButton, WatchButton] = [
    makeActionButton('respawn-inner-wall', 'Surface', CONTENT_LEFT, travelButtonY, travelButtonWidth, 68),
    makeActionButton(
      'respawn-overlook',
      'Overlook',
      CONTENT_LEFT + travelButtonWidth + 10,
      travelButtonY,
      travelButtonWidth,
      68
    ),
    makeActionButton(
      'respawn-axis-end',
      'Axis',
      CONTENT_LEFT + (travelButtonWidth + 10) * 2,
      travelButtonY,
      travelButtonWidth,
      68
    )
  ]

  // ── Spin & gravity ──
  const spinSection: WatchSection = { top: 366, height: 240, title: 'SPIN & GRAVITY' }
  const spinRow = makeRow(spinSpec.key, spinSpec.label, spinSpec.actionPrefix, spinSection.top + 44, width)
  const gravityGaugeY = spinSection.top + 184

  // ── Parameters ──
  const parameterSection: WatchSection = {
    top: 610,
    height: 64 + parameterSpecs.length * 86,
    title: 'PARAMETERS'
  }
  const rows = parameterSpecs.map((spec, index) =>
    makeRow(spec.key, spec.label, spec.actionPrefix, parameterSection.top + 48 + index * 86, width)
  )

  // ── Locomotion ──
  const locomotionSection: WatchSection = { top: 1028, height: 128, title: 'LOCOMOTION' }
  const profileButtonY = locomotionSection.top + 48
  const profileButtons: [WatchButton, WatchButton, WatchButton] = [
    makeActionButton('profile-beginner', 'Beginner', CONTENT_LEFT, profileButtonY, 196, 60),
    makeActionButton('profile-sim', 'Sim', CONTENT_LEFT + 210, profileButtonY, 196, 60),
    makeActionButton('profile-expert', 'Expert', CONTENT_LEFT + 420, profileButtonY, 196, 60)
  ]

  // ── Presets ──
  const presetSection: WatchSection = { top: 1176, height: 144, title: 'HABITAT PRESETS' }
  const presetButtonWidth = 148
  const presetButtonY = presetSection.top + 56
  const presetButtons: [WatchButton, WatchButton, WatchButton, WatchButton] = [
    makeActionButton('preset-apply-playground', 'Playground', CONTENT_LEFT, presetButtonY, presetButtonWidth, 60),
    makeActionButton(
      'preset-apply-izma',
      'Izma',
      CONTENT_LEFT + (presetButtonWidth + 10),
      presetButtonY,
      presetButtonWidth,
      60
    ),
    makeActionButton(
      'preset-apply-cooper',
      'Cooper',
      CONTENT_LEFT + (presetButtonWidth + 10) * 2,
      presetButtonY,
      presetButtonWidth,
      60
    ),
    makeActionButton(
      'preset-apply-elysium',
      'Elysium',
      CONTENT_LEFT + (presetButtonWidth + 10) * 3,
      presetButtonY,
      presetButtonWidth,
      60
    )
  ]

  return {
    width,
    height,
    travelSection,
    spinSection,
    parameterSection,
    locomotionSection,
    presetSection,
    spinRow,
    gravityGaugeY,
    rows,
    profileButtons,
    presetButtons,
    respawnButtons,
    buttons: [
      ...respawnButtons,
      ...spinRow.buttons,
      ...rows.flatMap((row) => row.buttons),
      ...profileButtons,
      ...presetButtons
    ]
  }
}

export const SECTION_PADDING = { left: SECTION_LEFT, right: SECTION_RIGHT }

export const getWatchButtonAtUv = (
  layout: WatchExpandedLayout,
  uv: THREE.Vector2
): WatchButton | null => {
  const canvasX = uv.x * layout.width
  const canvasY = (1 - uv.y) * layout.height

  for (const button of layout.buttons) {
    if (
      canvasX >= button.x &&
      canvasX <= button.x + button.width &&
      canvasY >= button.y &&
      canvasY <= button.y + button.height
    ) {
      return button
    }
  }

  return null
}
