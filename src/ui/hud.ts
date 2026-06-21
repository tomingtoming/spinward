import type { Vector3 } from 'three'
import type { ObserverMode, TrailMode } from '../app/observerMode'
import { EARTH_GRAVITY } from '../gameplay/vehicle'
import { formatVrControlsText } from '../xr/controlScheme'

type HudSnapshot = {
  radius: number
  span: number
  rpm: number
  gTarget: number
  presetName: string
  habitatType: 'cylinder' | 'ring'
  simScale: number
  ballCount: number
  trackedBallSpeed: number
  xrActive: boolean
  forceVectors: boolean
  observerMode: ObserverMode
  trailMode: TrailMode
  watchMenuOpen: boolean
  region: 'inside' | 'outside'
  playerMode: 'grounded' | 'free-fly'
  // Measured felt g-force (proper acceleration, m/s²) and the car's speed
  // (m/s, or < 0 while on foot to hide the readout).
  feltGravity: number
  feltSpeed: number
  verification: {
    inertialVelocity: Vector3
    rotatingVelocity: Vector3
    fictitiousAcceleration: Vector3
    estimatedAcceleration: Vector3
    errorMagnitude: number
    warning: boolean
  } | null
  reattach: {
    radialError: number
    radialTolerance: number
    normalSpeed: number
    maxNormalSpeed: number
    surfaceSpeed: number
    maxSurfaceSpeed: number
    ready: boolean
  } | null
}

export type HudHandle = {
  destroy: () => void
  setVisible: (visible: boolean) => void
  update: (snapshot: HudSnapshot) => void
}

const CONTROLS_TEXT =
  'PC - WASD: walk / fly | click: throw | Space: jump / fly up | Shift: fly down | Q/E: roll (flying) | 1/2/3: travel | F: launch | right-drag/arrows: look | Tab: menu | E: drive (near the car) | M: mute\n' +
  `VR - ${formatVrControlsText()}\n` +
  'Mobile - drag: look | tap: throw | buttons: jump/travel/gyro'

const makeChip = (className: string) => {
  const chip = document.createElement('span')
  chip.className = `hud-chip ${className}`
  return chip
}

// `mount` is the dock's left cluster. The HUD's pieces flow inline there; the
// CONTROL / DEBUG drawers become pill toggles whose text pops up ABOVE the bar.
export const createHud = (mount: HTMLElement): HudHandle => {
  const root = document.createElement('div')
  // display:contents — the wrapper exists only so setVisible can hide the group.
  root.className = 'hud'

  const popovers: HTMLElement[] = []
  const toggles: HTMLButtonElement[] = []

  const closeAllPopovers = () => {
    for (const popover of popovers) {
      popover.hidden = true
    }
    for (const toggle of toggles) {
      toggle.classList.remove('is-active')
    }
  }

  const makeToggle = (label: string, popover: HTMLElement) => {
    const button = document.createElement('button')
    button.className = 'dock-toggle'
    button.textContent = label
    button.addEventListener('pointerdown', (event) => event.stopPropagation())
    button.addEventListener('click', (event) => {
      event.preventDefault()
      const open = popover.hidden
      closeAllPopovers()
      if (open) {
        popover.hidden = false
        button.classList.add('is-active')
      }
    })
    popovers.push(popover)
    toggles.push(button)
    return button
  }

  const makePopover = (text: string) => {
    const pre = document.createElement('pre')
    pre.className = 'dock-popover'
    pre.hidden = true
    pre.textContent = text
    return pre
  }

  const controlsPopover = makePopover(CONTROLS_TEXT)
  const debugPopover = makePopover('')
  const controlsToggle = makeToggle('CONTROL', controlsPopover)
  const debugToggle = makeToggle('DEBUG', debugPopover)

  // The live "felt g" is the readout that actually moves as you play; the
  // nominal target g lives in the settings panel (and the debug popover), so it
  // is no longer duplicated as an always-on chip.
  const presetChip = makeChip('hud-chip--preset')
  // Secondary readouts — first to be dropped when the window gets narrow.
  const feltChip = makeChip('hud-chip--metric')
  const spinChip = makeChip('hud-chip--metric')
  const modeChip = makeChip('')
  const ballsChip = makeChip('hud-chip--metric')
  const dockChip = makeChip('')

  root.append(
    controlsToggle,
    debugToggle,
    presetChip,
    feltChip,
    spinChip,
    modeChip,
    ballsChip,
    dockChip
  )
  // Popovers are fixed-positioned above the bar, so they live on body, not in
  // the display:contents wrapper.
  document.body.append(controlsPopover, debugPopover)
  mount.append(root)

  const debugBody = debugPopover

  return {
    destroy: () => {
      root.remove()
      controlsPopover.remove()
      debugPopover.remove()
    },
    setVisible: (visible: boolean) => {
      root.hidden = !visible
      if (!visible) {
        closeAllPopovers()
      }
    },
    update: (snapshot) => {
      presetChip.textContent = snapshot.presetName
      const feltG = snapshot.feltGravity / EARTH_GRAVITY
      feltChip.textContent =
        snapshot.feltSpeed >= 0
          ? `felt ${feltG.toFixed(2)} g · ${(snapshot.feltSpeed * 3.6).toFixed(0)} km/h`
          : `felt ${feltG.toFixed(2)} g`
      spinChip.textContent = `ω ${snapshot.rpm.toFixed(2)} rpm`
      modeChip.textContent = snapshot.playerMode === 'grounded' ? 'grounded' : 'free-fly'
      modeChip.className = `hud-chip ${
        snapshot.playerMode === 'grounded' ? 'hud-chip--grounded' : 'hud-chip--freefly'
      }`

      ballsChip.hidden = snapshot.ballCount === 0
      ballsChip.textContent = `balls ${snapshot.ballCount}`

      const dock = snapshot.reattach
      dockChip.hidden = snapshot.playerMode !== 'free-fly' || dock === null
      if (dock !== null) {
        dockChip.textContent = dock.ready ? 'dock ready' : `dock ${dock.radialError.toFixed(1)} m`
        dockChip.className = `hud-chip ${dock.ready ? 'hud-chip--grounded' : ''}`
      }

      const verification = snapshot.verification
      debugBody.textContent =
        `${snapshot.habitatType} R ${snapshot.radius.toFixed(0)}m span ${snapshot.span.toFixed(0)}m ` +
        `sim ${snapshot.simScale.toFixed(3)} | nom g ${snapshot.gTarget.toFixed(2)} | ` +
        `view ${snapshot.observerMode} | trails ${snapshot.trailMode} | ` +
        `tracked ball ${snapshot.trackedBallSpeed.toFixed(2)} m/s | ` +
        `force vectors ${snapshot.forceVectors ? 'on' : 'off'} | menu ${snapshot.watchMenuOpen ? 'open' : 'closed'} | ` +
        `${snapshot.region} | ${snapshot.xrActive ? 'XR' : 'desktop'}` +
        (dock === null
          ? ''
          : `\ndock dr ${dock.radialError.toFixed(2)}/${dock.radialTolerance.toFixed(2)} ` +
            `vn ${dock.normalSpeed.toFixed(2)}/${dock.maxNormalSpeed.toFixed(2)} ` +
            `vs ${dock.surfaceSpeed.toFixed(2)}/${dock.maxSurfaceSpeed.toFixed(2)} ${dock.ready ? 'ready' : 'hold'}`) +
        (verification === null
          ? ''
          : `\nvI [${verification.inertialVelocity.x.toFixed(1)} ${verification.inertialVelocity.y.toFixed(1)} ${verification.inertialVelocity.z.toFixed(1)}] ` +
            `vR [${verification.rotatingVelocity.x.toFixed(1)} ${verification.rotatingVelocity.y.toFixed(1)} ${verification.rotatingVelocity.z.toFixed(1)}] ` +
            `aF [${verification.fictitiousAcceleration.x.toFixed(1)} ${verification.fictitiousAcceleration.y.toFixed(1)} ${verification.fictitiousAcceleration.z.toFixed(1)}] ` +
            `aE [${verification.estimatedAcceleration.x.toFixed(1)} ${verification.estimatedAcceleration.y.toFixed(1)} ${verification.estimatedAcceleration.z.toFixed(1)}] ` +
            `err ${verification.errorMagnitude.toFixed(2)}${verification.warning ? ' Frame mismatch!' : ''}`)
    }
  }
}
