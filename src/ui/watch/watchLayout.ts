import * as THREE from 'three'

export type WatchActionId =
  | 'rpm-coarse-decrement'
  | 'rpm-fine-decrement'
  | 'rpm-fine-increment'
  | 'rpm-coarse-increment'
  | 'radius-coarse-decrement'
  | 'radius-fine-decrement'
  | 'radius-fine-increment'
  | 'radius-coarse-increment'
  | 'throw-scale-coarse-decrement'
  | 'throw-scale-fine-decrement'
  | 'throw-scale-fine-increment'
  | 'throw-scale-coarse-increment'
  | 'landing-assist-coarse-decrement'
  | 'landing-assist-fine-decrement'
  | 'landing-assist-fine-increment'
  | 'landing-assist-coarse-increment'
  | 'reattach-threshold-coarse-decrement'
  | 'reattach-threshold-fine-decrement'
  | 'reattach-threshold-fine-increment'
  | 'reattach-threshold-coarse-increment'
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
  key: string
  label: string
  valueX: number
  valueY: number
  buttons: [WatchButton, WatchButton, WatchButton, WatchButton]
}

export type WatchExpandedLayout = {
  width: number
  height: number
  rows: WatchRow[]
  presetButtons: [WatchButton, WatchButton, WatchButton]
  respawnButtons: [WatchButton, WatchButton]
  buttons: WatchButton[]
}

export const WATCH_STATUS_SIZE = {
  width: 360,
  height: 180
} as const

export const WATCH_EXPANDED_SIZE = {
  width: 720,
  height: 1160
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
  key: string,
  label: string,
  actionPrefix: string,
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
    makeRow('rpm', 'RPM', 'rpm', 154, width),
    makeRow('radius', 'Radius', 'radius', 246, width),
    makeRow('throwScale', 'Throw', 'throw-scale', 338, width),
    makeRow('landingAssist', 'Assist', 'landing-assist', 430, width),
    makeRow('reattachThreshold', 'Reattach', 'reattach-threshold', 522, width)
  ]
  const wideButtonWidth = 198
  const wideButtonHeight = 64
  const sectionLeft = 42
  const sectionGap = 18
  const presetTop = 714
  const respawnTop = 914
  const presetButtons: [WatchButton, WatchButton, WatchButton] = [
    makeActionButton(
      'preset-apply-izma',
      'Izma',
      sectionLeft,
      presetTop,
      wideButtonWidth,
      wideButtonHeight
    ),
    makeActionButton(
      'preset-apply-cooper',
      'Cooper',
      sectionLeft + wideButtonWidth + sectionGap,
      presetTop,
      wideButtonWidth,
      wideButtonHeight
    ),
    makeActionButton(
      'preset-apply-elysium',
      'Elysium',
      sectionLeft + (wideButtonWidth + sectionGap) * 2,
      presetTop,
      wideButtonWidth,
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
    presetButtons,
    respawnButtons,
    buttons: [...rows.flatMap((row) => row.buttons), ...presetButtons, ...respawnButtons]
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
