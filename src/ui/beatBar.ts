// An always-visible, self-driving "beat bar" for non-VR play. The demo's
// payoff beats (warp to Surface / Overlook / Axis, change the spin) otherwise
// hide behind memorised keys (1/2/3) and the Tab panel, so a cold visitor
// never reaches them. This surfaces them as labelled on-screen buttons that
// drive the whole tour by clicking — on PC and mobile alike.

export type BeatBarAction =
  | 'respawn-inner-wall'
  | 'respawn-overlook'
  | 'respawn-axis-end'
  | 'rpm-coarse-decrement'
  | 'rpm-coarse-increment'

export type BeatBarSnapshot = {
  rpm: number
  feltGravity: number
  axisAvailable: boolean
}

export type BeatBarHandle = {
  destroy: () => void
  setVisible: (visible: boolean) => void
  update: (snapshot: BeatBarSnapshot) => void
}

const EARTH_GRAVITY = 9.80665

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

const makeLabel = (text: string) => {
  const span = document.createElement('span')
  span.className = 'beat-label'
  span.textContent = text
  return span
}

export const createBeatBar = (onAction: (action: BeatBarAction) => void): BeatBarHandle => {
  const root = document.createElement('div')
  root.className = 'beat-bar'

  const surface = makeButton('Surface', 'beat-btn', () => onAction('respawn-inner-wall'))
  const overlook = makeButton('Overlook', 'beat-btn', () => onAction('respawn-overlook'))
  const axis = makeButton('Axis', 'beat-btn', () => onAction('respawn-axis-end'))

  const separator = document.createElement('span')
  separator.className = 'beat-sep'

  const spinDown = makeButton('−', 'beat-btn beat-btn--step', () => onAction('rpm-coarse-decrement'))
  const readout = document.createElement('span')
  readout.className = 'beat-readout'
  const spinUp = makeButton('+', 'beat-btn beat-btn--step', () => onAction('rpm-coarse-increment'))

  root.append(
    makeLabel('Travel'),
    surface,
    overlook,
    axis,
    separator,
    makeLabel('Spin'),
    spinDown,
    readout,
    spinUp
  )
  document.body.append(root)

  return {
    destroy: () => root.remove(),
    setVisible: (visible: boolean) => {
      root.hidden = !visible
    },
    update: (snapshot) => {
      readout.textContent =
        `${snapshot.rpm.toFixed(2)} rpm · ${(snapshot.feltGravity / EARTH_GRAVITY).toFixed(2)} g`
      axis.disabled = !snapshot.axisAvailable
    }
  }
}
