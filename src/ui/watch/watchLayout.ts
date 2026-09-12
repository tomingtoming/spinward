import { OUTING_DESTINATIONS, type OutingAction } from '../../app/neighborhoodRoute'
import * as THREE from 'three'
import { PLACE_DESTINATIONS, type PlaceVisitAction } from '../../app/placeVisits'
import {
  WATCH_PARAMETER_SPECS,
  type WatchParameterActionId,
  type WatchParameterActionPrefix,
  type WatchParameterRowKey
} from './watchSchema'

// The wrist keeps travel and spin on HOME, with everyday places, settings and
// controls one page away. Each page has a Back target and uses the same canvas
// bounds for drawing and laser hit-testing.
export type WatchScreen = 'home' | 'outing' | 'places' | 'habitat' | 'tweaks' | 'legend'

export type WatchNavActionId =
  | 'nav-home'
  | 'nav-places'
  | 'nav-outing'
  | 'nav-habitat'
  | 'nav-tweaks'
  | 'nav-legend'

export type WatchActionId =
  | WatchNavActionId
  | PlaceVisitAction
  | OutingAction
  | WatchParameterActionId
  | 'preset-apply-playground'
  | 'preset-apply-izma'
  | 'preset-apply-cooper'
  | 'preset-apply-elysium'
  | 'respawn-inner-wall'
  | 'respawn-old-town'
  | 'respawn-overlook'
  | 'respawn-axis-end'
  | 'respawn-exterior'
  | 'weather-rain-toggle'
  | 'depth-mode-toggle'
  | 'audio-mute-toggle'

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
  placesButton?: WatchButton
  spinSection?: WatchSection
  spinRow?: WatchRow
  gravityGaugeY?: number
  categoryButtons?: WatchButton[]
  // PLACES.
  placesSection?: WatchSection
  placeButtons?: WatchButton[]
  // HABITAT.
  presetSection?: WatchSection
  presetButtons?: WatchButton[]
  // HABITAT + TWEAKS stepper rows.
  rowsSection?: WatchSection
  rows?: WatchRow[]
  // TWEAKS render card (perf readouts + the depth-buffer switch).
  renderSection?: WatchSection
  depthButton?: WatchButton
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
    case 'nav-outing':
      return 'outing'
    case 'nav-places':
      return 'places'
    case 'nav-habitat':
      return 'habitat'
    case 'nav-tweaks':
      return 'tweaks'
    case 'nav-legend':
      return 'legend'
    default:
      return null
  }
}

const createHomeLayout = (width: number, height: number): WatchScreenLayout => {
  const travelSection: WatchSection = { top: 158, height: 150, title: 'TRAVEL' }
  // Five travel destinations now (Surface/Old Town/Overlook/Axis/Exterior);
  // narrow the buttons so the row still spans the same width as the old four.
  const travelButtonWidth = 115
  const travelButtonY = travelSection.top + 78
  const travelButtonStep = travelButtonWidth + 10
  const travelButtons = [
    makeActionButton('respawn-inner-wall', 'Surface', CONTENT_LEFT, travelButtonY, travelButtonWidth, 64),
    makeActionButton('respawn-old-town', 'Old Town', CONTENT_LEFT + travelButtonStep, travelButtonY, travelButtonWidth, 64),
    makeActionButton('respawn-overlook', 'Overlook', CONTENT_LEFT + travelButtonStep * 2, travelButtonY, travelButtonWidth, 64),
    makeActionButton('respawn-axis-end', 'Axis', CONTENT_LEFT + travelButtonStep * 3, travelButtonY, travelButtonWidth, 64),
    makeActionButton('respawn-exterior', 'Exterior', CONTENT_LEFT + travelButtonStep * 4, travelButtonY, travelButtonWidth, 64)
  ]
  const placesButton = makeActionButton('nav-places', 'Places ›', 500, travelSection.top + 8, 170, 58)

  const spinSection: WatchSection = { top: 322, height: 232, title: 'SPIN & GRAVITY' }
  const spinRow = makeParameterRow('rpm', spinSection.top + 40, width)
  const gravityGaugeY = spinSection.top + 180

  // Match the travel targets' size: weather, sound and three category screens.
  const categoryWidth = 115
  const categoryGap = 10
  const categoryY = 576
  const categoryStep = categoryWidth + categoryGap
  const categoryButtons = [
    makeActionButton('weather-rain-toggle', 'Rain', CONTENT_LEFT, categoryY, categoryWidth, 64),
    makeActionButton('audio-mute-toggle', 'Sound on', CONTENT_LEFT + categoryStep, categoryY, categoryWidth, 64),
    makeActionButton('nav-habitat', 'Habitat', CONTENT_LEFT + categoryStep * 2, categoryY, categoryWidth, 64),
    makeActionButton('nav-tweaks', 'Tweaks', CONTENT_LEFT + categoryStep * 3, categoryY, categoryWidth, 64),
    makeActionButton('nav-legend', 'Controls', CONTENT_LEFT + categoryStep * 4, categoryY, categoryWidth, 64)
  ]

  return {
    screen: 'home',
    width,
    height,
    travelSection,
    travelButtons,
    placesButton,
    spinSection,
    spinRow,
    gravityGaugeY,
    categoryButtons,
    buttons: [placesButton, ...travelButtons, ...spinRow.buttons, ...categoryButtons]
  }
}

const createPlacesLayout = (width: number, height: number): WatchScreenLayout => {
  const backButton = makeBackButton()
  const placesSection: WatchSection = { top: 108, height: Math.max(424, 84 + Math.ceil(PLACE_DESTINATIONS.length / 2) * 104), title: 'STREET LIFE' }
  const placeButtons = PLACE_DESTINATIONS.map((place, i) => makeActionButton(
    place.id, place.label, CONTENT_LEFT + (i % 2) * 310,
    placesSection.top + 84 + Math.floor(i / 2) * 104, 290, 80
  ))
  return { screen: 'places', width, height, backButton, title: 'PLACES',
    placesSection, placeButtons, buttons: [backButton, makeActionButton('nav-outing','Directions ›',430,26,240,54), ...placeButtons] }
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

  // RENDER card: perf readouts plus the depth-buffer A/B. The switch is a
  // plain button rather than a stepper — flipping the depth strategy rebuilds
  // the renderer, so pressing it reloads the page.
  const renderSection: WatchSection = { top: 540, height: 128, title: 'RENDER' }
  const depthButtonWidth = 190
  const depthButton = makeActionButton(
    'depth-mode-toggle',
    'Switch ↻',
    width - SECTION_RIGHT - 18 - depthButtonWidth,
    renderSection.top + 50,
    depthButtonWidth,
    62
  )

  return {
    screen: 'tweaks',
    width,
    height,
    backButton,
    title: 'TWEAKS',
    rowsSection,
    rows,
    renderSection,
    depthButton,
    buttons: [backButton, ...rows.flatMap((row) => row.buttons), depthButton]
  }
}

// The legend is a passive reference page — only the Back button is interactive.
// Its rows are drawn straight from VR_CONTROL_LEGEND (controlScheme.ts) so the
// printed map can never drift from the actual bindings.
const createLegendLayout = (width: number, height: number): WatchScreenLayout => {
  const backButton = makeBackButton()
  return {
    screen: 'legend',
    width,
    height,
    backButton,
    title: 'CONTROLS',
    buttons: [backButton]
  }
}

const createOutingLayout = (width:number,height:number):WatchScreenLayout => {
  const backButton=makeBackButton()
  const placeButtons=[...OUTING_DESTINATIONS,{id:'guide-cancel' as const,label:'Cancel directions'}, {id:'drive-mode-toggle' as const,label:'Street / Experiment'}, {id:'park-car' as const,label:'Park car'}]
    .map((p,i)=>makeActionButton(p.id,p.label,50+(i%2)*330,160+Math.floor(i/2)*104,290,80))
  return {screen:'outing',width,height,backButton,title:'DIRECTIONS',placeButtons,buttons:[backButton,...placeButtons]}
}

export const createWatchLayout = (
  screen: WatchScreen,
  width = WATCH_CANVAS_SIZE.width,
  height = WATCH_CANVAS_SIZE.height
): WatchScreenLayout => {
  switch (screen) {
    case 'home':
      return createHomeLayout(width, height)
    case 'outing':
      return createOutingLayout(width,height)
    case 'places':
      return createPlacesLayout(width, height)
    case 'habitat':
      return createHabitatLayout(width, height)
    case 'tweaks':
      return createTweaksLayout(width, height)
    case 'legend':
      return createLegendLayout(width, height)
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
  outing: createWatchLayout('outing', width, height),
  places: createWatchLayout('places', width, height),
  habitat: createWatchLayout('habitat', width, height),
  tweaks: createWatchLayout('tweaks', width, height),
  legend: createWatchLayout('legend', width, height)
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
