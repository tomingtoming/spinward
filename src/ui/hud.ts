import { EARTH_GRAVITY } from '../gameplay/vehicle'
import { PROJECTILES, type ProjectileType } from '../gameplay/projectileTypes'
import { HABITAT_PRESETS } from '../presets/presets'
import { getControlScheme, type ControlPlatform, type ControlSection } from '../xr/controlScheme'
import {
  closeEverything,
  createDropdownChip,
  hideBackdrop,
  registerClose,
  showBackdrop
} from './dropdownLayer'

type HudSnapshot = {
  ballCount: number
  // Id + label of the currently-selected throwable (Ball / Beam / Firework).
  projectile: ProjectileType
  projectileLabel: string
  region: 'inside' | 'outside'
  playerMode: 'grounded' | 'free-fly'
  rpm: number
  presetName: string
  currentPresetId: string
  // Which control scheme the CONTROL card should show (PC / SP / VR).
  platform: ControlPlatform
  // Measured felt g-force (proper acceleration, m/s²) and the car's speed
  // (m/s, or < 0 while on foot to hide the readout).
  feltGravity: number
  feltSpeed: number
  reattach: {
    radialError: number
    ready: boolean
  } | null
}

export type HudHandle = {
  destroy: () => void
  setVisible: (visible: boolean) => void
  update: (snapshot: HudSnapshot) => void
  // Flash the CONTROL bindings card as if the user had hovered/tapped it. The
  // app fires this once after the intro tour card fades (shown together they
  // overlap and both become unreadable), which matters on touch — no hover
  // means it is the only unprompted look at the bindings.
  peekControls: () => void
}

const makeChip = (className: string) => {
  const chip = document.createElement('span')
  chip.className = `hud-chip ${className}`
  return chip
}

// How long the CONTROL card and each dropdown's helper text stay up before
// fading — long enough to read, short enough not to feel stuck.
const CONTROLS_CARD_VISIBLE_MS = 5000
const CONTROLS_CARD_FADE_MS = 400

const makeControlsRow = (input: string, action: string) => {
  const row = document.createElement('div')
  row.className = 'controls-card__row'
  const inputSpan = document.createElement('span')
  inputSpan.textContent = input
  const actionSpan = document.createElement('span')
  actionSpan.textContent = action
  row.append(inputSpan, actionSpan)
  return row
}

const renderControlsSection = (container: HTMLElement, section: ControlSection | undefined) => {
  if (section === undefined) {
    return
  }

  const heading = document.createElement('h4')
  heading.textContent = section.title
  container.append(heading)

  for (const binding of section.bindings) {
    container.append(makeControlsRow(binding.input, binding.action))
  }
}

// `mount` is the dock's left cluster. The HUD's pieces flow inline there.
export const createHud = (
  mount: HTMLElement,
  // The preset and projectile chips double as dropdowns — no need to open a
  // separate settings surface just to switch either one.
  onSelectPreset: (presetId: string) => void,
  onSelectProjectile: (projectile: ProjectileType) => void
): HudHandle => {
  const root = document.createElement('div')
  // display:contents — the wrapper exists only so setVisible can hide the group.
  root.className = 'hud'

  // CONTROL shows a compact bindings card for a few seconds then fades —
  // never a click-to-open panel to navigate. Works the same on touch (tap)
  // as on PC (hover or click); the app also flashes it once via peekControls
  // after the intro card fades, so touch — which has no hover — gets a look.
  const controlsToggle = document.createElement('button')
  controlsToggle.className = 'dock-toggle'
  controlsToggle.textContent = 'CONTROL'

  const controlsCard = document.createElement('div')
  controlsCard.className = 'controls-card'
  controlsCard.hidden = true
  const controlsCardSummary = document.createElement('div')
  controlsCardSummary.className = 'controls-card__summary'
  const controlsCardLeft = document.createElement('div')
  controlsCardLeft.className = 'controls-card__column'
  const controlsCardRight = document.createElement('div')
  controlsCardRight.className = 'controls-card__column'
  const controlsCardColumns = document.createElement('div')
  controlsCardColumns.className = 'controls-card__columns'
  controlsCardColumns.append(controlsCardLeft, controlsCardRight)
  controlsCard.append(controlsCardSummary, controlsCardColumns)

  let controlsPlatform: ControlPlatform = 'pc'
  let controlsFadeTimeout: ReturnType<typeof setTimeout> | null = null
  let controlsHideTimeout: ReturnType<typeof setTimeout> | null = null

  const renderControlsCard = () => {
    const { summary, sections } = getControlScheme(controlsPlatform)
    controlsCardSummary.textContent = summary
    controlsCardLeft.replaceChildren()
    controlsCardRight.replaceChildren()
    renderControlsSection(controlsCardLeft, sections.find((s) => s.mode === 'grounded'))
    renderControlsSection(controlsCardLeft, sections.find((s) => s.mode === 'driving'))
    renderControlsSection(controlsCardRight, sections.find((s) => s.mode === 'free-fly'))
  }

  renderControlsCard()

  // Touch taps synthesize compatibility mouse events (mouseenter included)
  // after the pointerup, aimed at whatever the closing tap uncovered — which
  // is the CONTROL chip itself when the tap landed on the backdrop over it.
  // Ignore hover peeks for a beat after any close so that ghost hover cannot
  // undo the dismissal it belongs to.
  let suppressHoverPeekUntil = 0

  const hideControlsCardNow = () => {
    if (controlsFadeTimeout !== null) {
      clearTimeout(controlsFadeTimeout)
      controlsFadeTimeout = null
    }
    if (controlsHideTimeout !== null) {
      clearTimeout(controlsHideTimeout)
      controlsHideTimeout = null
    }
    controlsCard.hidden = true
    controlsCard.classList.remove('is-fading')
    suppressHoverPeekUntil = performance.now() + 500
  }
  const unregisterControlsClose = registerClose(hideControlsCardNow)

  const peekControlsCard = () => {
    if (controlsFadeTimeout !== null) {
      clearTimeout(controlsFadeTimeout)
    }
    if (controlsHideTimeout !== null) {
      clearTimeout(controlsHideTimeout)
      controlsHideTimeout = null
    }

    const rect = controlsToggle.getBoundingClientRect()
    controlsCard.style.left = `${rect.left}px`
    controlsCard.style.bottom = `${window.innerHeight - rect.top + 8}px`
    controlsCard.hidden = false
    controlsCard.classList.remove('is-fading')

    controlsFadeTimeout = setTimeout(() => {
      controlsCard.classList.add('is-fading')
      controlsHideTimeout = setTimeout(() => {
        controlsCard.hidden = true
        controlsCard.classList.remove('is-fading')
        // A tap-opened card raised the backdrop; when the card times out on
        // its own, take the backdrop down with it. No menu can be open here —
        // opening one closes the card and clears these timers.
        hideBackdrop()
      }, CONTROLS_CARD_FADE_MS)
    }, CONTROLS_CARD_VISIBLE_MS)
  }

  // Toggle on pointerdown, same reasoning as the dropdown chips: a click
  // handler would race the backdrop's closing pointerdown and reopen the card
  // in the same tap. Press shows the card (and the backdrop, so tapping
  // anywhere dismisses it instead of throwing); press again hides it.
  controlsToggle.addEventListener('pointerdown', (event) => {
    event.stopPropagation()
    event.preventDefault()

    if (!controlsCard.hidden) {
      hideControlsCardNow()
      hideBackdrop()
      return
    }

    peekControlsCard()
    showBackdrop()
  })
  // Hover keeps the lightweight peek — no backdrop, so mousing over CONTROL
  // never steals the next click from the game.
  controlsToggle.addEventListener('mouseenter', () => {
    if (performance.now() < suppressHoverPeekUntil) {
      return
    }

    peekControlsCard()
  })

  // The live "felt g" is the readout that actually moves as you play; the
  // nominal target g lives in the settings panel, so it is not duplicated as
  // an always-on chip.
  const presetDropdown = createDropdownChip(
    'hud-chip hud-chip--preset hud-chip--tap',
    HABITAT_PRESETS.map((preset) => ({ id: preset.id, label: preset.name })),
    onSelectPreset
  )

  // Secondary readouts — first to be dropped when the window gets narrow.
  const feltChip = makeChip('hud-chip--metric')
  const spinChip = makeChip('hud-chip--metric')
  const modeChip = makeChip('')
  const ballsChip = makeChip('hud-chip--metric')
  // Stays visible on narrow phones where the readouts are dropped (not a
  // --metric chip) — it is how touch switches the throwable at all.
  const projectileDropdown = createDropdownChip<ProjectileType>(
    'hud-chip hud-chip--tap',
    Object.entries(PROJECTILES).map(([id, spec]) => ({
      id: id as ProjectileType,
      label: spec.label
    })),
    onSelectProjectile
  )
  // Distance left to close before you could reattach to the wall — only
  // shown while free-flying. Labelled "reattach", not "dock": it applies
  // anywhere on the wall, not just at the spaceport.
  const reattachChip = makeChip('')

  root.append(
    controlsToggle,
    presetDropdown.chip,
    feltChip,
    spinChip,
    modeChip,
    ballsChip,
    projectileDropdown.chip,
    reattachChip
  )
  // Anchored above the bar and fixed-positioned, so the card lives on body,
  // not in the display:contents wrapper (the dropdown menus do the same, from
  // dropdownLayer).
  document.body.append(controlsCard)
  mount.append(root)

  return {
    destroy: () => {
      root.remove()
      controlsCard.remove()
      unregisterControlsClose()
      presetDropdown.destroy()
      projectileDropdown.destroy()
    },
    setVisible: (visible: boolean) => {
      root.hidden = !visible
      if (!visible) {
        closeEverything()
      }
    },
    peekControls: () => {
      // Anchored to the CONTROL chip, so skip while the chip is not laid out
      // (HUD hidden via debug toggle, dock hidden while presenting in VR) —
      // the card would position against a zero rect.
      if (!root.hidden && controlsToggle.offsetParent !== null) {
        peekControlsCard()
      }
    },
    update: (snapshot) => {
      if (snapshot.platform !== controlsPlatform) {
        controlsPlatform = snapshot.platform
        renderControlsCard()
      }

      presetDropdown.chip.textContent = snapshot.presetName
      for (const item of presetDropdown.menuItems) {
        item.element.classList.toggle('is-active', item.id === snapshot.currentPresetId)
      }

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
      projectileDropdown.chip.textContent = `◈ ${snapshot.projectileLabel}`
      for (const item of projectileDropdown.menuItems) {
        item.element.classList.toggle('is-active', item.id === snapshot.projectile)
      }

      const reattach = snapshot.reattach
      reattachChip.hidden = snapshot.playerMode !== 'free-fly' || reattach === null
      if (reattach !== null) {
        reattachChip.textContent = reattach.ready
          ? 'reattach ready'
          : `reattach ${reattach.radialError.toFixed(1)} m`
        reattachChip.className = `hud-chip ${reattach.ready ? 'hud-chip--grounded' : ''}`
      }
    }
  }
}
