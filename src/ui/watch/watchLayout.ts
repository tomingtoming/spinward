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
  buttons: WatchButton[]
}

export const WATCH_STATUS_SIZE = {
  width: 360,
  height: 180
} as const

export const WATCH_EXPANDED_SIZE = {
  width: 720,
  height: 860
} as const

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

  return {
    width,
    height,
    rows,
    buttons: rows.flatMap((row) => row.buttons)
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
