import { EARTH_GRAVITY } from '../gameplay/vehicle'
import type { BallThrowStyle } from '../gameplay/throwTarget'
import { PROJECTILES, type ProjectileType } from '../gameplay/projectileTypes'
import { HABITAT_PRESETS } from '../presets/presets'
import { getControlScheme, type ControlPlatform, type ControlSection } from '../xr/controlScheme'
import {
  closeEverything,
  createDropdownChip,
  registerClose,
  showBackdrop
} from './dropdownLayer'

type HudSnapshot = {
  ballCount: number
  // Id + label of the currently-selected throwable (Ball / Beam / Firework).
  projectile: ProjectileType
  projectileLabel: string
  ballThrowStyle: BallThrowStyle
  slowThrowUnlocked: boolean
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
}

const makeChip = (className: string) => {
  const chip = document.createElement('span')
  chip.className = `hud-chip ${className}`
  return chip
}

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
  onSelectProjectile: (projectile: ProjectileType) => void,
  onSelectThrowStyle: (style: BallThrowStyle) => void,
  slots: { status: HTMLElement; equipment: HTMLElement }
): HudHandle => {
  const root = document.createElement('div')
  // display:contents — the wrapper exists only so setVisible can hide the group.
  root.className = 'hud'

  const controlsToggle = document.createElement('button')
  controlsToggle.className = 'dock-toggle'
  controlsToggle.textContent = 'Controls'
  controlsToggle.setAttribute('aria-expanded', 'false')

  const controlsCard = document.createElement('div')
  controlsCard.className = 'controls-card'
  controlsCard.hidden = true
  controlsCard.id = 'controls-help'
  controlsCard.setAttribute('role', 'dialog')
  controlsCard.setAttribute('aria-label', 'Controls')
  controlsToggle.setAttribute('aria-controls', controlsCard.id)
  const controlsCardSummary = document.createElement('div')
  controlsCardSummary.className = 'controls-card__summary'
  const controlsCardLeft = document.createElement('div')
  controlsCardLeft.className = 'controls-card__column'
  const controlsCardRight = document.createElement('div')
  controlsCardRight.className = 'controls-card__column'
  const controlsCardColumns = document.createElement('div')
  controlsCardColumns.className = 'controls-card__columns'
  controlsCardColumns.append(controlsCardLeft, controlsCardRight)
  const controlsHeader = document.createElement('div')
  controlsHeader.className = 'controls-card__header'
  const controlsTitle = document.createElement('h2')
  controlsTitle.textContent = 'Controls'
  const controlsClose = document.createElement('button')
  controlsClose.textContent = '×'
  controlsClose.setAttribute('aria-label', 'Close controls')
  controlsHeader.append(controlsTitle, controlsClose)
  controlsCard.append(controlsHeader, controlsCardSummary, controlsCardColumns)

  let controlsPlatform: ControlPlatform = 'pc'

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

  const controlsOwner = () => {
    const owner = controlsToggle.closest<HTMLElement>('[data-popup-owner]')?.dataset.popupOwner
    return (owner ? document.getElementById(owner) : null) ?? controlsToggle
  }
  const hideControlsCardNow = () => {
    controlsCard.hidden = true
    controlsToggle.setAttribute('aria-expanded', 'false')
  }
  const unregisterControlsClose = registerClose(hideControlsCardNow)
  const openControls = (keyboard: boolean) => {
    const rect = controlsOwner().getBoundingClientRect()
    closeEverything()
    window.dispatchEvent(new Event('spinward-ui-open'))
    controlsCard.style.bottom = `${window.innerHeight - rect.top + 8}px`
    controlsCard.style.maxHeight = `${Math.max(80, rect.top - 16)}px`
    controlsCard.hidden = false
    controlsCard.scrollTop = 0
    controlsCard.style.left = `${Math.max(8, Math.min(rect.left, window.innerWidth - controlsCard.getBoundingClientRect().width - 8))}px`
    controlsToggle.setAttribute('aria-expanded', 'true')
    showBackdrop()
    if (keyboard) controlsClose.focus()
  }
  controlsToggle.addEventListener('pointerdown', event => {
    if (event.button !== 0) return
    event.stopPropagation()
    event.preventDefault()
    openControls(false)
  })
  controlsToggle.addEventListener('click', event => {
    if (event.detail !== 0) return
    event.preventDefault()
    openControls(true)
  })
  controlsClose.onclick = () => { closeEverything(); controlsOwner().focus() }
  const dismissControls = (event: KeyboardEvent) => {
    if (controlsCard.hidden || event.key !== 'Escape') return
    event.preventDefault(); event.stopPropagation()
    closeEverything(); controlsOwner().focus()
  }
  const dismissControlsFocus = (event: FocusEvent) => {
    if (!controlsCard.hidden && !controlsCard.contains(event.target as Node)) closeEverything()
  }
  document.addEventListener('keydown', dismissControls)
  document.addEventListener('focusin', dismissControlsFocus)
  window.addEventListener('resize', closeEverything)

  // The live "felt g" is the readout that actually moves as you play; the
  // nominal target g lives in the settings panel, so it is not duplicated as
  // an always-on chip.
  const presetDropdown = createDropdownChip(
    'hud-chip hud-chip--preset hud-chip--tap',
    HABITAT_PRESETS.map((preset) => ({ id: preset.id, label: preset.name })),
    onSelectPreset
  )

  // The felt measurement stays on screen; nominal settings live in Menu.
  const feltChip = document.createElement('div')
  feltChip.className = 'hud-live'
  const feltValue = document.createElement('strong')
  const feltLabel = document.createElement('span')
  feltChip.append(feltValue, feltLabel)
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
  projectileDropdown.chip.title = 'Choose Ball, Beam or Firework (shortcut: X)'
  projectileDropdown.chip.setAttribute('aria-label', 'Choose projectile')
  const throwStyleDropdown = createDropdownChip<BallThrowStyle>(
    'hud-chip hud-chip--tap',
    [{ id: 'normal', label: 'Normal — direct throw' }, { id: 'slow', label: 'Slow — try a higher arc' }],
    onSelectThrowStyle
  )
  throwStyleDropdown.chip.setAttribute('aria-label', 'Ball throwing speed')
  throwStyleDropdown.chip.hidden = true
  // Distance left to close before you could reattach to the wall — only
  // shown while free-flying. Labelled "reattach", not "dock": it applies
  // anywhere on the wall, not just at the spaceport.
  const reattachChip = makeChip('')

  root.append(
    controlsToggle,
    presetDropdown.chip,
    spinChip,
    modeChip,
    ballsChip,
    reattachChip
  )
  // Anchored above the bar and fixed-positioned, so the card lives on body,
  // not in the display:contents wrapper (the dropdown menus do the same, from
  // dropdownLayer).
  document.body.append(controlsCard)
  mount.prepend(root)
  slots.status.append(feltChip)
  slots.equipment.append(projectileDropdown.chip, throwStyleDropdown.chip)

  return {
    destroy: () => {
      root.remove()
      feltChip.remove()
      document.removeEventListener('keydown', dismissControls)
      document.removeEventListener('focusin', dismissControlsFocus)
      window.removeEventListener('resize', closeEverything)
      controlsCard.remove()
      unregisterControlsClose()
      presetDropdown.destroy()
      projectileDropdown.destroy()
      throwStyleDropdown.destroy()
    },
    setVisible: (visible: boolean) => {
      root.hidden = !visible
      feltChip.hidden = !visible
      slots.equipment.hidden = !visible
      if (!visible) {
        closeEverything()
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
      const value = snapshot.feltSpeed >= 0 ? `${(snapshot.feltSpeed * 3.6).toFixed(0)} km/h` : `${feltG.toFixed(2)} g`
      const label = snapshot.feltSpeed >= 0 ? `${feltG.toFixed(2)} g felt` : 'felt gravity'
      if (feltValue.textContent !== value) feltValue.textContent = value
      if (feltLabel.textContent !== label) feltLabel.textContent = label
      spinChip.textContent = `ω ${snapshot.rpm.toFixed(2)} rpm`
      modeChip.textContent = snapshot.playerMode === 'grounded' ? 'grounded' : 'free-fly'
      modeChip.className = `hud-chip ${
        snapshot.playerMode === 'grounded' ? 'hud-chip--grounded' : 'hud-chip--freefly'
      }`

      ballsChip.hidden = snapshot.ballCount === 0
      ballsChip.textContent = `balls ${snapshot.ballCount}`
      projectileDropdown.chip.textContent = `Throw: ${snapshot.projectileLabel} ▾`
      throwStyleDropdown.chip.hidden = !snapshot.slowThrowUnlocked || snapshot.projectile !== 'ball'
      if (throwStyleDropdown.chip.hidden && !throwStyleDropdown.menu.hidden) {
        closeEverything()
      }
      throwStyleDropdown.chip.textContent = `Speed: ${snapshot.ballThrowStyle === 'normal' ? 'Normal' : 'Slow'} ▾`
      for (const item of throwStyleDropdown.menuItems) {
        item.element.classList.toggle('is-active', item.id === snapshot.ballThrowStyle)
      }
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
