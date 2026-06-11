export type TourEventId =
  | 'start'
  | 'throw'
  | 'jump'
  | 'overlook'
  | 'axis'
  | 'surface'
  | 'spin-change'

export type TourCard = {
  title: string
  body: string[]
  durationSeconds: number
}

// Waypoint and spin cards re-show on every trigger; one-shot discovery cards
// (throw, jump) only fire the first time so they do not nag.
const ONE_SHOT_EVENTS: ReadonlySet<TourEventId> = new Set(['start', 'throw', 'jump'])

export const TOUR_CARDS: Record<TourEventId, TourCard> = {
  start: {
    title: 'INERTIAL WORLDS',
    body: [
      'You live on the inside of a spinning cylinder.',
      'The floor pushes you in a circle - that push is your "gravity".',
      'WASD / grip to move · click / trigger to throw · Space / A to jump'
    ],
    durationSeconds: 14
  },
  throw: {
    title: 'CORIOLIS CURVE',
    body: [
      'In space the ball flies dead straight.',
      'The ground rotates underneath it - the curve you see is your own spin.'
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
      'Same world, but no floor is pushing you. The city is your sky.'
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
  'spin-change': {
    title: 'SPIN = GRAVITY',
    body: [
      'Surface gravity is omega^2 x R.',
      'Slow the spin and the whole world gets lighter.'
    ],
    durationSeconds: 10
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
