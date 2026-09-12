import { formatModeControlsLine, getControlScheme, type ControlPlatform } from '../xr/controlScheme'
import type { PlaceVisitAction } from './placeVisits'

export type TourEventId =
  | PlaceVisitAction
  | 'start'
  | 'throw'
  | 'jump'
  | 'overlook'
  | 'axis'
  | 'old-town'
  | 'exterior'
  | 'surface'
  | 'spin-change'
  | 'drive'
  | 'rain'
  | 'enter-freefly'
  | 'enter-grounded'
  | 'look-lock'

export type TourCard = {
  title: string
  body: string[]
  durationSeconds: number
}

// Waypoint and spin cards re-show on every trigger; one-shot discovery cards
// (throw, jump) only fire the first time so they do not nag.
const ONE_SHOT_EVENTS: ReadonlySet<TourEventId> = new Set(['start', 'throw', 'jump', 'drive', 'rain', 'look-lock'])

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
      CONTROLS_TOKEN,
      'The floor’s push is your gravity. Choose a destination and explore.'
    ],
    durationSeconds: 9
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
  'old-town': {
    title: 'PORT DISTRICT',
    body: [
      'At the port end, smaller streets open into an arrival square.',
      'Walk the neighbourhood, or look up toward the hub on the spin axis.'
    ],
    durationSeconds: 8
  },
  exterior: {
    title: 'OUTSIDE THE COLONY',
    body: [
      'You float freely while the habitat turns.',
      'The spinning floor supplies the push that residents feel as gravity.',
      'Choose Surface to go back inside.'
    ],
    durationSeconds: 10
  },
  surface: {
    title: 'CENTRAL SQUARE',
    body: [
      'Welcome back to the plaza. Look up:',
      'the far side of town hangs overhead, 2R away.'
    ],
    durationSeconds: 8
  },
  'visit-cafe': {
    title: 'CAFÉ',
    body: ['Step through the entrance and look around the room.'],
    durationSeconds: 6
  },
  'visit-courtyard': {
    title: 'COURTYARD',
    body: ['Follow the passage inside. An open courtyard brings the colony sky between the buildings.'],
    durationSeconds: 6
  },
  'visit-apartment': {
    title: 'APARTMENT',
    body: ['Walk through the entrance to see a home in the colony.'],
    durationSeconds: 6
  },
  'visit-shops': {
    title: 'MARKET STREET',
    body: ['Small storefronts bring everyday activity to the foot of the residential buildings.'],
    durationSeconds: 6
  },
  'visit-park': {
    title: 'PARK',
    body: ['Follow the garden path, take a seat, and look up through the trees.'],
    durationSeconds: 6
  },
  'visit-ball-practice': { title: 'THROWING LAWN', body: ['Choose Ball. Aim above the hoop to begin.'], durationSeconds: 5 },
  'visit-car-share': { title: 'CAR SHARE', body: ['A neighbourhood sedan. Approach the driver’s seat to use it.'], durationSeconds: 5 },
  drive: {
    title: 'CAR SHARE',
    body: [
      'The spinning floor gives the tyres their grip.',
      DRIVE_CONTROLS_TOKEN
    ],
    durationSeconds: 6
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
  },
  // First pointer grab on PC: the one place the new mouse look explains
  // itself (one-shot). Doubles as a funnel milestone (metrics.ts).
  'look-lock': {
    title: 'MOUSE LOOK',
    body: ['Move the mouse to look around. Click to throw.', 'Esc gives the pointer back - click the view to grab it again.'],
    durationSeconds: 6
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
