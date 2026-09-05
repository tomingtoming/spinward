import { createDropdownChip } from './dropdownLayer'

// An always-visible, self-driving "beat bar" for non-VR play. The demo's
// payoff beats (warp to Surface / Overlook / Axis, change the spin) otherwise
// hide behind memorised keys (1/2/3) and the Tab panel, so a cold visitor
// never reaches them. This surfaces them as labelled on-screen buttons that
// drive the whole tour by clicking — on PC and mobile alike.

export type BeatBarAction =
  | 'respawn-inner-wall'
  | 'respawn-old-town'
  | 'respawn-overlook'
  | 'respawn-axis-end'
  | 'respawn-exterior'
  | 'rpm-coarse-decrement'
  | 'rpm-coarse-increment'

export type BeatBarSnapshot = {
  rpm: number
  feltGravity: number
  axisAvailable: boolean
  oldTownAvailable: boolean
  raining: boolean
}

export type BeatBarHandle = {
  destroy: () => void
  setVisible: (visible: boolean) => void
  update: (snapshot: BeatBarSnapshot) => void
  // Narrow viewports collapse the five destinations into one Travel pill (the
  // bar otherwise wraps the dock to four rows on a phone). Called on resize.
  setCompact: (compact: boolean) => void
}

const makeButton = (label: string, className: string, onTap: () => void) => {
  const button = document.createElement('button')
  button.textContent = label
  button.className = className
  // Keep taps on the bar from falling through to the canvas (throw / look).
  button.addEventListener('pointerdown', (event) => event.stopPropagation())
  button.addEventListener('click', (event) => {
    event.preventDefault()
    onTap()
  })
  return button
}

// Destinations, in tour order. Shared by the five pills and the compact
// dropdown so the two arrangements can never drift apart.
const TRAVEL_DESTINATIONS = [
  { id: 'respawn-inner-wall', label: 'Surface' },
  { id: 'respawn-old-town', label: 'Old Town' },
  { id: 'respawn-overlook', label: 'Overlook' },
  { id: 'respawn-axis-end', label: 'Axis' },
  { id: 'respawn-exterior', label: 'Exterior' }
] as const satisfies readonly { id: BeatBarAction; label: string }[]

const makeLabel = (text: string) => {
  const span = document.createElement('span')
  span.className = 'beat-label'
  span.textContent = text
  return span
}

// `mount` is the dock's centre cluster. We prepend so Travel + Spin sit before
// the VR button (which is mounted into the same cluster). The live rpm·g readout
// is dropped here — it is already shown by the dock's ω and felt-g chips.
export const createBeatBar = (
  onAction: (action: BeatBarAction) => void,
  mount: HTMLElement,
  onToggleRain?: () => void
): BeatBarHandle => {
  const root = document.createElement('div')
  root.className = 'beat-bar'

  const surface = makeButton('Surface', 'beat-btn', () => onAction('respawn-inner-wall'))
  // The port-end old town: the colony's first-built district, and the arrival
  // square where a traveller down from the spaceport hub steps onto spin
  // gravity. Hidden on habitats too small to have districts.
  const oldTown = makeButton('Old Town', 'beat-btn', () => onAction('respawn-old-town'))
  const overlook = makeButton('Overlook', 'beat-btn', () => onAction('respawn-overlook'))
  const axis = makeButton('Axis', 'beat-btn', () => onAction('respawn-axis-end'))
  const exterior = makeButton('Exterior', 'beat-btn', () => onAction('respawn-exterior'))

  const separator = document.createElement('span')
  separator.className = 'beat-sep'

  const spinDown = makeButton('−', 'beat-btn beat-btn--step', () => onAction('rpm-coarse-decrement'))
  const spinUp = makeButton('+', 'beat-btn beat-btn--step', () => onAction('rpm-coarse-increment'))

  // Weather beat: rain is the payoff where the spin becomes visible in the
  // sky, so it sits on the bar next to Spin rather than in a settings panel.
  const rainSeparator = document.createElement('span')
  rainSeparator.className = 'beat-sep'
  const rain = makeButton('Rain', 'beat-btn', () => onToggleRain?.())

  // Compact arrangement: one labelled pill that opens the same destinations.
  // The label stays on the pill, so the affordance is still visible — only the
  // list of places is one tap deeper.
  const travelDropdown = createDropdownChip<BeatBarAction>(
    'beat-btn beat-btn--travel',
    TRAVEL_DESTINATIONS,
    (action) => onAction(action),
    'Travel ▾'
  )
  travelDropdown.chip.hidden = true

  const travelLabel = makeLabel('Travel')
  const wideTravel = [travelLabel, surface, oldTown, overlook, axis, exterior]

  root.append(
    travelDropdown.chip,
    travelLabel,
    surface,
    oldTown,
    overlook,
    axis,
    exterior,
    separator,
    makeLabel('Spin'),
    spinDown,
    spinUp,
    rainSeparator,
    rain
  )
  mount.prepend(root)

  let compact = false
  let oldTownAvailable = true

  const applyArrangement = () => {
    travelDropdown.chip.hidden = !compact
    for (const element of wideTravel) {
      element.hidden = compact
    }
    // The wide pills' own availability rules still win when they are showing.
    if (!compact) {
      oldTown.hidden = !oldTownAvailable
    }
  }

  return {
    destroy: () => {
      travelDropdown.destroy()
      root.remove()
    },
    setVisible: (visible: boolean) => {
      root.hidden = !visible
    },
    setCompact: (next: boolean) => {
      if (next === compact) {
        return
      }
      compact = next
      applyArrangement()
    },
    update: (snapshot) => {
      axis.disabled = !snapshot.axisAvailable
      oldTownAvailable = snapshot.oldTownAvailable
      // Same two rules in the menu, so the compact list never offers a
      // destination the wide bar hides or greys out.
      for (const item of travelDropdown.menuItems) {
        if (item.id === 'respawn-old-town') {
          item.element.hidden = !snapshot.oldTownAvailable
        }
        if (item.id === 'respawn-axis-end') {
          item.element.disabled = !snapshot.axisAvailable
        }
      }
      applyArrangement()
      rain.classList.toggle('beat-btn--on', snapshot.raining)
    }
  }
}
