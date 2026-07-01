import { EARTH_GRAVITY } from '../gameplay/vehicle'
import { PROJECTILES, type ProjectileType } from '../gameplay/projectileTypes'
import { HABITAT_PRESETS } from '../presets/presets'
import { getControlScheme, type ControlPlatform, type ControlSection } from '../xr/controlScheme'

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
  // Which control scheme the CONTROL hover card should show (PC / SP / VR).
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

// Shared by the preset and projectile chips: a tappable pill that opens a
// small menu of choices anchored above it. Works identically on touch (tap
// to open, tap an item) since it never depends on hover.
const createDropdownChip = <T extends string>(
  className: string,
  items: readonly { id: T; label: string }[],
  onSelect: (id: T) => void
) => {
  const chip = document.createElement('button')
  chip.className = className

  const menu = document.createElement('div')
  menu.className = 'preset-menu'
  menu.hidden = true

  const close = () => {
    menu.hidden = true
    chip.classList.remove('is-active')
  }

  const menuItems = items.map(({ id, label }) => {
    const item = document.createElement('button')
    item.className = 'preset-menu__item'
    item.textContent = label
    item.addEventListener('pointerdown', (event) => event.stopPropagation())
    item.addEventListener('click', (event) => {
      event.preventDefault()
      close()
      onSelect(id)
    })
    menu.append(item)
    return { id, element: item }
  })

  chip.addEventListener('pointerdown', (event) => event.stopPropagation())
  chip.addEventListener('click', (event) => {
    event.preventDefault()
    event.stopPropagation()

    if (!menu.hidden) {
      close()
      return
    }

    // Anchored to the chip's live position rather than a fixed offset — the
    // left cluster's width varies with which chips are visible.
    const rect = chip.getBoundingClientRect()
    menu.style.left = `${rect.left}px`
    menu.style.bottom = `${window.innerHeight - rect.top + 8}px`
    menu.hidden = false
    chip.classList.add('is-active')
  })
  // Closes the menu on any click outside it (including the canvas).
  document.addEventListener('pointerdown', () => {
    if (!menu.hidden) {
      close()
    }
  })

  return { chip, menu, menuItems, close }
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
  onSelectProjectile: (projectile: ProjectileType) => void
): HudHandle => {
  const root = document.createElement('div')
  // display:contents — the wrapper exists only so setVisible can hide the group.
  root.className = 'hud'

  // CONTROL is a hover card, not a click-to-open panel — a quick glance at
  // the bindings, not a screen to navigate.
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

  controlsToggle.addEventListener('pointerdown', (event) => event.stopPropagation())
  controlsToggle.addEventListener('mouseenter', () => {
    const rect = controlsToggle.getBoundingClientRect()
    controlsCard.style.left = `${rect.left}px`
    controlsCard.style.bottom = `${window.innerHeight - rect.top + 8}px`
    controlsCard.hidden = false
  })
  controlsToggle.addEventListener('mouseleave', () => {
    controlsCard.hidden = true
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
  // Fixed-positioned above the bar (anchored dynamically to their chips), so
  // they live on body, not in the display:contents wrapper.
  document.body.append(controlsCard, presetDropdown.menu, projectileDropdown.menu)
  mount.append(root)

  return {
    destroy: () => {
      root.remove()
      controlsCard.remove()
      presetDropdown.menu.remove()
      projectileDropdown.menu.remove()
    },
    setVisible: (visible: boolean) => {
      root.hidden = !visible
      if (!visible) {
        controlsCard.hidden = true
        presetDropdown.close()
        projectileDropdown.close()
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
