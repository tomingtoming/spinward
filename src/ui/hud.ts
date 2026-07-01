import { EARTH_GRAVITY } from '../gameplay/vehicle'

type HudSnapshot = {
  ballCount: number
  // Label of the currently-selected throwable (Ball / Beam / Firework).
  projectile: string
  region: 'inside' | 'outside'
  playerMode: 'grounded' | 'free-fly'
  rpm: number
  presetName: string
  // Measured felt g-force (proper acceleration, m/s²) and the car's speed
  // (m/s, or < 0 while on foot to hide the readout).
  feltGravity: number
  feltSpeed: number
  reattach: {
    radialError: number
    ready: boolean
  } | null
  // True while the Tab quick-panel is open showing controls, so the dock's
  // CONTROL button can reflect it as active.
  controlsOpen: boolean
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

// `mount` is the dock's left cluster. The HUD's pieces flow inline there.
export const createHud = (
  mount: HTMLElement,
  onCycleProjectile: () => void,
  // CONTROL opens the Tab quick-panel's own legend screen (see main.ts) —
  // the same well-formatted, per-platform bindings reference, instead of a
  // second, cruder copy living in the dock.
  onToggleControls: () => void
): HudHandle => {
  const root = document.createElement('div')
  // display:contents — the wrapper exists only so setVisible can hide the group.
  root.className = 'hud'

  const controlsToggle = document.createElement('button')
  controlsToggle.className = 'dock-toggle'
  controlsToggle.textContent = 'CONTROL'
  controlsToggle.addEventListener('pointerdown', (event) => event.stopPropagation())
  controlsToggle.addEventListener('click', (event) => {
    event.preventDefault()
    onToggleControls()
  })

  // The live "felt g" is the readout that actually moves as you play; the
  // nominal target g lives in the settings panel, so it is not duplicated as
  // an always-on chip.
  const presetChip = makeChip('hud-chip--preset')
  // Secondary readouts — first to be dropped when the window gets narrow.
  const feltChip = makeChip('hud-chip--metric')
  const spinChip = makeChip('hud-chip--metric')
  const modeChip = makeChip('')
  const ballsChip = makeChip('hud-chip--metric')
  // The projectile indicator doubles as the switch: tap/click it to cycle the
  // throwable (the only way on a touchscreen). It is NOT a --metric chip, so it
  // stays visible on narrow phones where the readouts are dropped.
  const projectileChip = makeChip('hud-chip--tap')
  projectileChip.title = 'Tap to switch projectile (X)'
  projectileChip.addEventListener('pointerdown', (event) => event.stopPropagation())
  projectileChip.addEventListener('click', (event) => {
    event.preventDefault()
    onCycleProjectile()
  })
  // Distance left to close before you could reattach to the wall — only
  // shown while free-flying. Labelled "reattach", not "dock": it applies
  // anywhere on the wall, not just at the spaceport.
  const reattachChip = makeChip('')

  root.append(
    controlsToggle,
    presetChip,
    feltChip,
    spinChip,
    modeChip,
    ballsChip,
    projectileChip,
    reattachChip
  )
  mount.append(root)

  return {
    destroy: () => {
      root.remove()
    },
    setVisible: (visible: boolean) => {
      root.hidden = !visible
    },
    update: (snapshot) => {
      controlsToggle.classList.toggle('is-active', snapshot.controlsOpen)
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
      projectileChip.textContent = `◈ ${snapshot.projectile}`

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
