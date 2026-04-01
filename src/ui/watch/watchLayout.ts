import * as THREE from 'three'
import {
  WATCH_FAR_FIELD_INTENSITY_SPEC,
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
  | 'far-field-enable'
  | 'far-field-disable'
  | 'far-field-mode-auto'
  | 'far-field-mode-day'
  | 'far-field-mode-night'
  | 'preset-apply-playground'
  | 'preset-apply-izma'
  | 'preset-apply-cooper'
  | 'preset-apply-elysium'
  | 'respawn-inner-wall'
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

export type WatchExpandedLayout = {
  width: number
  height: number
  rows: WatchRow[]
  profileButtons: [WatchButton, WatchButton, WatchButton]
  farFieldModeButtons: [WatchButton, WatchButton, WatchButton]
  farFieldEnabledButtons: [WatchButton, WatchButton]
  farFieldIntensityRow: WatchRow
  presetButtons: [WatchButton, WatchButton, WatchButton, WatchButton]
  respawnButtons: [WatchButton, WatchButton]
  buttons: WatchButton[]
}

export const WATCH_EXPANDED_SIZE = {
  width: 720,
  height: 1780
} as const

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
  const rightMargin = 36
  const coarseIncrementX = panelWidth - rightMargin - buttonWidth
  const fineIncrementX = coarseIncrementX - 84
  const fineDecrementX = fineIncrementX - 84
  const coarseDecrementX = fineDecrementX - 84

  return {
    key,
    label,
    valueX: 42,
    valueY: top + 54,
    buttons: [
      {
        id: `${actionPrefix}-coarse-decrement` as WatchActionId,
        label: '--',
        x: coarseDecrementX,
        y: top + 18,
        width: buttonWidth,
        height: buttonHeight
      },
      {
        id: `${actionPrefix}-fine-decrement` as WatchActionId,
        label: '-',
        x: fineDecrementX,
        y: top + 18,
        width: buttonWidth,
        height: buttonHeight
      },
      {
        id: `${actionPrefix}-fine-increment` as WatchActionId,
        label: '+',
        x: fineIncrementX,
        y: top + 18,
        width: buttonWidth,
        height: buttonHeight
      },
      {
        id: `${actionPrefix}-coarse-increment` as WatchActionId,
        label: '++',
        x: coarseIncrementX,
        y: top + 18,
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
  const rows = [
    ...WATCH_PRIMARY_PARAMETER_SPECS.map((spec, index) =>
      makeRow(
        spec.key,
        spec.label,
        spec.actionPrefix,
        154 + index * 92,
        width
      )
    )
  ]
  const farFieldIntensitySpec = WATCH_FAR_FIELD_INTENSITY_SPEC!
  const wideButtonHeight = 64
  const sectionLeft = 42
  const profileButtons: [WatchButton, WatchButton, WatchButton] = [
    makeActionButton('profile-beginner', 'Beginner', sectionLeft, 738, 190, wideButtonHeight),
    makeActionButton('profile-sim', 'Sim', sectionLeft + 208, 738, 190, wideButtonHeight),
    makeActionButton('profile-expert', 'Expert', sectionLeft + 416, 738, 190, wideButtonHeight)
  ]
  const farFieldEnabledButtons: [WatchButton, WatchButton] = [
    makeActionButton('far-field-disable', 'Night Off', sectionLeft, 918, 140, wideButtonHeight),
    makeActionButton('far-field-enable', 'Night On', sectionLeft + 158, 918, 140, wideButtonHeight)
  ]
  const farFieldModeButtons: [WatchButton, WatchButton, WatchButton] = [
    makeActionButton('far-field-mode-auto', 'Auto', sectionLeft, 1002, 140, wideButtonHeight),
    makeActionButton('far-field-mode-day', 'Day', sectionLeft + 158, 1002, 140, wideButtonHeight),
    makeActionButton('far-field-mode-night', 'Night', sectionLeft + 316, 1002, 140, wideButtonHeight)
  ]
  const farFieldIntensityRow = makeRow(
    farFieldIntensitySpec.key,
    farFieldIntensitySpec.label,
    farFieldIntensitySpec.actionPrefix,
    1072,
    width
  )
  const presetTop = 1292
  const presetBottom = 1374
  const respawnTop = 1584
  const presetButtonWidth = 300
  const presetButtons: [WatchButton, WatchButton, WatchButton, WatchButton] = [
    makeActionButton(
      'preset-apply-playground',
      'Playground',
      sectionLeft,
      presetTop,
      presetButtonWidth,
      wideButtonHeight
    ),
    makeActionButton(
      'preset-apply-izma',
      'Izma',
      sectionLeft + 318,
      presetTop,
      presetButtonWidth,
      wideButtonHeight
    ),
    makeActionButton(
      'preset-apply-cooper',
      'Cooper',
      sectionLeft,
      presetBottom,
      presetButtonWidth,
      wideButtonHeight
    ),
    makeActionButton(
      'preset-apply-elysium',
      'Elysium',
      sectionLeft + 318,
      presetBottom,
      presetButtonWidth,
      wideButtonHeight
    )
  ]
  const respawnButtons: [WatchButton, WatchButton] = [
    makeActionButton(
      'respawn-inner-wall',
      'Inner Wall',
      sectionLeft,
      respawnTop,
      300,
      wideButtonHeight
    ),
    makeActionButton(
      'respawn-axis-end',
      'Axis End',
      sectionLeft + 318,
      respawnTop,
      300,
      wideButtonHeight
    )
  ]

  return {
    width,
    height,
    rows,
    profileButtons,
    farFieldModeButtons,
    farFieldEnabledButtons,
    farFieldIntensityRow,
    presetButtons,
    respawnButtons,
    buttons: [
      ...rows.flatMap((row) => row.buttons),
      ...profileButtons,
      ...farFieldEnabledButtons,
      ...farFieldModeButtons,
      ...farFieldIntensityRow.buttons,
      ...presetButtons,
      ...respawnButtons
    ]
  }
}

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
