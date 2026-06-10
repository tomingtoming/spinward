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

export type WatchExpandedLayout = {
  width: number
  height: number
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
  const wideButtonHeight = 64
  const sectionLeft = 42
  const profileButtons: [WatchButton, WatchButton, WatchButton] = [
    makeActionButton('profile-beginner', 'Beginner', sectionLeft, 738, 190, wideButtonHeight),
    makeActionButton('profile-sim', 'Sim', sectionLeft + 208, 738, 190, wideButtonHeight),
    makeActionButton('profile-expert', 'Expert', sectionLeft + 416, 738, 190, wideButtonHeight)
  ]
  const presetTop = 904
  const presetBottom = 986
  const respawnTop = 1196
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
  const respawnButtons: [WatchButton, WatchButton, WatchButton] = [
    makeActionButton(
      'respawn-inner-wall',
      'Surface',
      sectionLeft,
      respawnTop,
      190,
      wideButtonHeight
    ),
    makeActionButton(
      'respawn-overlook',
      'Overlook',
      sectionLeft + 208,
      respawnTop,
      190,
      wideButtonHeight
    ),
    makeActionButton(
      'respawn-axis-end',
      'Axis',
      sectionLeft + 416,
      respawnTop,
      190,
      wideButtonHeight
    )
  ]

  return {
    width,
    height,
    rows,
    profileButtons,
    presetButtons,
    respawnButtons,
    buttons: [
      ...rows.flatMap((row) => row.buttons),
      ...profileButtons,
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
