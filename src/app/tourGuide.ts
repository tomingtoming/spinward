import { formatModeControlsLine, getControlScheme, type ControlPlatform } from '../xr/controlScheme'

export type TourEventId =
  | 'start'
  | 'throw'
  | 'jump'
  | 'overlook'
  | 'axis'
  | 'surface'
  | 'spin-change'
  | 'drive'
  | 'rain'
  | 'enter-freefly'
  | 'enter-grounded'

export type TourCard = {
  title: string
  body: string[]
  durationSeconds: number
}

// Waypoint and spin cards re-show on every trigger; one-shot discovery cards
// (throw, jump) only fire the first time so they do not nag.
const ONE_SHOT_EVENTS: ReadonlySet<TourEventId> = new Set(['start', 'throw', 'jump', 'drive', 'rain'])

// Placeholders swapped for the real, platform-specific wording by
// resolveTourCard — cards below stay platform-agnostic templates so PC, touch
// and VR players each read their own bindings instead of a PC/VR mash-up.
const CONTROLS_TOKEN = '{{CONTROLS}}'
const DRIVE_CONTROLS_TOKEN = '{{DRIVE_CONTROLS}}'
const FREEFLY_BRAKE_TOKEN = '{{FREEFLY_BRAKE}}'

export const TOUR_CARDS: Record<TourEventId, TourCard> = {
  start: {
    title: 'SPINWARD',
    body: [
      'You live inside a spinning cylinder. Look up — the city wraps overhead.',
      'The floor pushes you in a circle - that push is your "gravity".',
      CONTROLS_TOKEN,
      'Tour: throw → jump → ② Overlook → ③ Axis'
    ],
    durationSeconds: 14
  },
  throw: {
    title: 'CORIOLIS CURVE',
    body: [
      'In space the ball flies dead straight.',
      'The ground rotates underneath it - the curve you see is your own spin.',
      'The dashed line is where the same throw would land on Earth.'
    ],
    durationSeconds: 10
  },
  jump: {
    title: 'JUMP',
    body: [
      'While airborne, nothing pulls on you at all.',
      'The floor curves up to meet you - slightly to one side.'
    ],
    durationSeconds: 10
  },
  overlook: {
    title: 'OVERLOOK',
    body: [
      'Closer to the axis you circle slower, so "gravity" is weaker.',
      'Let yourself fall: the city slides sideways beneath you.'
    ],
    durationSeconds: 12
  },
  axis: {
    title: 'THE AXIS',
    body: [
      'Zero radius, zero spin speed - zero weight.',
      'This is why the spaceport docks here: nothing to spin against.',
      'Look around - the city wraps the sky.'
    ],
    durationSeconds: 12
  },
  surface: {
    title: 'STREET LEVEL',
    body: [
      'Welcome back to the plaza. Look up:',
      'the far side of town hangs overhead, 2R away.'
    ],
    durationSeconds: 8
  },
  drive: {
    title: 'GRIP IS GRAVITY',
    body: [
      'The wheels hold the road only because the spinning floor presses them down.',
      'Lower the rpm and feel the grip melt away.',
      DRIVE_CONTROLS_TOKEN
    ],
    durationSeconds: 12
  },
  rain: {
    title: 'RAIN LAGS THE SPIN',
    body: [
      'Rain falls slanted here: every drop drifts against the rotation.',
      'The higher the cloud, the slower it falls - near the axis it floats.'
    ],
    durationSeconds: 12
  },
  'spin-change': {
    title: 'SPIN = GRAVITY',
    body: [
      'Surface gravity is omega^2 x R.',
      'Slow the spin and the whole world gets lighter.'
    ],
    durationSeconds: 10
  },
  // Brief mode-transition flashes. Repeatable (not one-shot), short, and shown
  // only when no richer card is already up — they double as a micro-hint.
  'enter-freefly': {
    title: 'FREE-FLY',
    body: [`Floating free${FREEFLY_BRAKE_TOKEN}`],
    durationSeconds: 1.8
  },
  'enter-grounded': {
    title: 'GROUNDED',
    body: ['Back on the deck'],
    durationSeconds: 1.4
  }
}

export type TourGuideState = {
  shown: Set<TourEventId>
  activeEvent: TourEventId | null
  remainingSeconds: number
}

export const createTourGuideState = (): TourGuideState => ({
  shown: new Set(),
  activeEvent: null,
  remainingSeconds: 0
})

export const notifyTourEvent = (state: TourGuideState, event: TourEventId) => {
  if (ONE_SHOT_EVENTS.has(event) && state.shown.has(event)) {
    return false
  }

  state.shown.add(event)
  state.activeEvent = event
  state.remainingSeconds = TOUR_CARDS[event].durationSeconds
  return true
}

export const stepTourGuide = (
  state: TourGuideState,
  deltaSeconds: number
): TourCard | null => {
  if (state.activeEvent === null) {
    return null
  }

  state.remainingSeconds -= Math.max(0, deltaSeconds)

  if (state.remainingSeconds <= 0) {
    state.activeEvent = null
    return null
  }

  return TOUR_CARDS[state.activeEvent]
}

// Swaps a card's placeholder tokens for the actual platform's wording. Kept
// separate from stepTourGuide so the state machine (timing, one-shot vs
// repeat) stays platform-agnostic and its tests can keep asserting object
// identity against the static TOUR_CARDS templates.
export const resolveTourCard = (
  card: TourCard | null,
  platform: ControlPlatform
): TourCard | null => {
  if (card === null || !card.body.some((line) => line.includes('{{'))) {
    return card
  }

  // VR is the only platform with a way to arrest free-fly drift (squeeze the
  // left grip); PC/touch have none, so the card states the fact without
  // inventing a button that is not there.
  const freeflyBrakeText = platform === 'vr' ? ' — squeeze left grip to stop' : ''

  return {
    ...card,
    body: card.body.map((line) =>
      line
        .replace(CONTROLS_TOKEN, getControlScheme(platform).summary)
        .replace(DRIVE_CONTROLS_TOKEN, formatModeControlsLine(platform, 'driving'))
        .replace(FREEFLY_BRAKE_TOKEN, freeflyBrakeText)
    )
  }
}
