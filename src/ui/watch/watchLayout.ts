import * as THREE from 'three'

export type WatchActionId =
  | 'rpm-decrement'
  | 'rpm-increment'
  | 'radius-decrement'
  | 'radius-increment'
  | 'throw-scale-decrement'
  | 'throw-scale-increment'
  | 'landing-assist-decrement'
  | 'landing-assist-increment'
  | 'reattach-threshold-decrement'
  | 'reattach-threshold-increment'

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
  decrement: WatchButton
  increment: WatchButton
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
  const buttonWidth = 84
  const buttonHeight = 64
  const rightMargin = 36
  const incrementX = panelWidth - rightMargin - buttonWidth
  const decrementX = incrementX - 104

  return {
    key,
    label,
    valueX: 42,
    valueY: top + 54,
    decrement: {
      id: `${actionPrefix}-decrement` as WatchActionId,
      label: '-',
      x: decrementX,
      y: top + 18,
      width: buttonWidth,
      height: buttonHeight
    },
    increment: {
      id: `${actionPrefix}-increment` as WatchActionId,
      label: '+',
      x: incrementX,
      y: top + 18,
      width: buttonWidth,
      height: buttonHeight
    }
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
    buttons: rows.flatMap((row) => [row.decrement, row.increment])
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
