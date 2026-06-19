import * as THREE from 'three'
import {
  WATCH_PARAMETER_SPECS,
  type WatchParameterActionId,
  type WatchParameterActionPrefix,
  type WatchParameterRowKey
} from './watchSchema'

// The shared settings surface (VR wrist · PC Tab panel · mobile ⚙) is split
// into a shallow hierarchy: a HOME screen keeps the demo-critical controls
// (Travel + Spin/gravity) one tap away, and the tinkering lives behind three
// category screens reached from HOME, each with a Back button. This keeps any
// single screen short enough to aim a laser at comfortably.
export type WatchScreen = 'home' | 'habitat' | 'tweaks' | 'comfort'

export type WatchNavActionId = 'nav-home' | 'nav-habitat' | 'nav-tweaks' | 'nav-comfort'

export type WatchActionId =
  | WatchNavActionId
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

export type WatchScreenLayout = {
  screen: WatchScreen
  width: number
  height: number
  // Every interactive button on the screen (incl. nav/back), for hit-testing.
  buttons: WatchButton[]
  // Sub-screen chrome.
  backButton?: WatchButton
  title?: string
  // HOME.
  travelSection?: WatchSection
  travelButtons?: WatchButton[]
  spinSection?: WatchSection
  spinRow?: WatchRow
  gravityGaugeY?: number
  categoryButtons?: WatchButton[]
  // HABITAT.
  presetSection?: WatchSection
  presetButtons?: WatchButton[]
  // HABITAT + TWEAKS stepper rows.
  rowsSection?: WatchSection
  rows?: WatchRow[]
  // COMFORT.
  profileSection?: WatchSection
  profileButtons?: WatchButton[]
}

export const WATCH_CANVAS_SIZE = {
  width: 720,
  height: 700
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
): WatchButton => ({ id, label, x, y, width, height })

const makeBackButton = (): WatchButton =>
  makeActionButton('nav-home', '‹ Back', SECTION_LEFT, 26, 132, 54)

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
      makeActionButton(`${actionPrefix}-coarse-decrement` as WatchActionId, '--', coarseDecrementX, top + 14, buttonWidth, buttonHeight),
      makeActionButton(`${actionPrefix}-fine-decrement` as WatchActionId, '-', fineDecrementX, top + 14, buttonWidth, buttonHeight),
      makeActionButton(`${actionPrefix}-fine-increment` as WatchActionId, '+', fineIncrementX, top + 14, buttonWidth, buttonHeight),
      makeActionButton(`${actionPrefix}-coarse-increment` as WatchActionId, '++', coarseIncrementX, top + 14, buttonWidth, buttonHeight)
    ]
  }
}

const makeParameterRow = (
  key: WatchParameterRowKey,
  top: number,
  panelWidth: number
): WatchRow => {
  const spec = WATCH_PARAMETER_SPECS.find((candidate) => candidate.key === key)

  if (spec === undefined) {
    throw new Error(`Unknown watch parameter key: ${key}`)
  }

  return makeRow(spec.key, spec.label, spec.actionPrefix, top, panelWidth)
}

// nav-* buttons switch screens inside the panel rather than dispatching an
// action to the runtime; the panels resolve them with this.
export const navTargetForAction = (id: WatchActionId): WatchScreen | null => {
  switch (id) {
    case 'nav-home':
      return 'home'
    case 'nav-habitat':
      return 'habitat'
    case 'nav-tweaks':
      return 'tweaks'
    case 'nav-comfort':
      return 'comfort'
    default:
      return null
  }
}

const createHomeLayout = (width: number, height: number): WatchScreenLayout => {
  const travelSection: WatchSection = { top: 158, height: 150, title: 'TRAVEL' }
  const travelButtonWidth = 200
  const travelButtonY = travelSection.top + 78
  const travelButtons = [
    makeActionButton('respawn-inner-wall', 'Surface', CONTENT_LEFT, travelButtonY, travelButtonWidth, 64),
    makeActionButton('respawn-overlook', 'Overlook', CONTENT_LEFT + (travelButtonWidth + 10), travelButtonY, travelButtonWidth, 64),
    makeActionButton('respawn-axis-end', 'Axis', CONTENT_LEFT + (travelButtonWidth + 10) * 2, travelButtonY, travelButtonWidth, 64)
  ]

  const spinSection: WatchSection = { top: 322, height: 232, title: 'SPIN & GRAVITY' }
  const spinRow = makeParameterRow('rpm', spinSection.top + 40, width)
  const gravityGaugeY = spinSection.top + 180

  const categoryWidth = 206
  const categoryY = 576
  const categoryButtons = [
    makeActionButton('nav-habitat', 'Habitat ›', CONTENT_LEFT, categoryY, categoryWidth, 66),
    makeActionButton('nav-tweaks', 'Tweaks ›', CONTENT_LEFT + (categoryWidth + 10), categoryY, categoryWidth, 66),
    makeActionButton('nav-comfort', 'Comfort ›', CONTENT_LEFT + (categoryWidth + 10) * 2, categoryY, categoryWidth, 66)
  ]

  return {
    screen: 'home',
    width,
    height,
    travelSection,
    travelButtons,
    spinSection,
    spinRow,
    gravityGaugeY,
    categoryButtons,
    buttons: [...travelButtons, ...spinRow.buttons, ...categoryButtons]
  }
}

const createHabitatLayout = (width: number, height: number): WatchScreenLayout => {
  const backButton = makeBackButton()
  const presetSection: WatchSection = { top: 108, height: 188, title: 'PRESETS' }
  const presetWidth = 290
  const presetHeight = 62
  const presetTop = presetSection.top + 52
  const presetButtons = [
    makeActionButton('preset-apply-playground', 'Playground', CONTENT_LEFT, presetTop, presetWidth, presetHeight),
    makeActionButton('preset-apply-izma', 'Izma', CONTENT_LEFT + (presetWidth + 10), presetTop, presetWidth, presetHeight),
    makeActionButton('preset-apply-cooper', 'Cooper', CONTENT_LEFT, presetTop + presetHeight + 12, presetWidth, presetHeight),
    makeActionButton('preset-apply-elysium', 'Elysium', CONTENT_LEFT + (presetWidth + 10), presetTop + presetHeight + 12, presetWidth, presetHeight)
  ]

  const rowsSection: WatchSection = { top: 316, height: 64 + 2 * 86, title: 'HABITAT SIZE' }
  const rows = [
    makeParameterRow('radius', rowsSection.top + 48, width),
    makeParameterRow('length', rowsSection.top + 48 + 86, width)
  ]

  return {
    screen: 'habitat',
    width,
    height,
    backButton,
    title: 'HABITAT',
    presetSection,
    presetButtons,
    rowsSection,
    rows,
    buttons: [backButton, ...presetButtons, ...rows.flatMap((row) => row.buttons)]
  }
}

const createTweaksLayout = (width: number, height: number): WatchScreenLayout => {
  const backButton = makeBackButton()
  const keys: WatchParameterRowKey[] = [
    'throwScale',
    'jetpackAcceleration',
    'reattachThreshold',
    'dayCycleSeconds'
  ]
  const rowsSection: WatchSection = {
    top: 108,
    height: 64 + keys.length * 86,
    title: 'PARAMETERS'
  }
  const rows = keys.map((key, index) => makeParameterRow(key, rowsSection.top + 48 + index * 86, width))

  return {
    screen: 'tweaks',
    width,
    height,
    backButton,
    title: 'TWEAKS',
    rowsSection,
    rows,
    buttons: [backButton, ...rows.flatMap((row) => row.buttons)]
  }
}

const createComfortLayout = (width: number, height: number): WatchScreenLayout => {
  const backButton = makeBackButton()
  const profileSection: WatchSection = { top: 108, height: 160, title: 'LOCOMOTION' }
  const buttonWidth = 196
  const buttonHeight = 62
  const buttonY = profileSection.top + 70
  const profileButtons = [
    makeActionButton('profile-beginner', 'Beginner', CONTENT_LEFT, buttonY, buttonWidth, buttonHeight),
    makeActionButton('profile-sim', 'Sim', CONTENT_LEFT + (buttonWidth + 10), buttonY, buttonWidth, buttonHeight),
    makeActionButton('profile-expert', 'Expert', CONTENT_LEFT + (buttonWidth + 10) * 2, buttonY, buttonWidth, buttonHeight)
  ]

  return {
    screen: 'comfort',
    width,
    height,
    backButton,
    title: 'COMFORT',
    profileSection,
    profileButtons,
    buttons: [backButton, ...profileButtons]
  }
}

export const createWatchLayout = (
  screen: WatchScreen,
  width = WATCH_CANVAS_SIZE.width,
  height = WATCH_CANVAS_SIZE.height
): WatchScreenLayout => {
  switch (screen) {
    case 'home':
      return createHomeLayout(width, height)
    case 'habitat':
      return createHabitatLayout(width, height)
    case 'tweaks':
      return createTweaksLayout(width, height)
    case 'comfort':
      return createComfortLayout(width, height)
    default: {
      const exhaustive: never = screen
      return exhaustive
    }
  }
}

export const createAllWatchLayouts = (
  width = WATCH_CANVAS_SIZE.width,
  height = WATCH_CANVAS_SIZE.height
): Record<WatchScreen, WatchScreenLayout> => ({
  home: createWatchLayout('home', width, height),
  habitat: createWatchLayout('habitat', width, height),
  tweaks: createWatchLayout('tweaks', width, height),
  comfort: createWatchLayout('comfort', width, height)
})

export const SECTION_PADDING = { left: SECTION_LEFT, right: SECTION_RIGHT }

export const getWatchButtonAtUv = (
  layout: { width: number; height: number; buttons: WatchButton[] },
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
