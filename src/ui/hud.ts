import type { Vector3 } from 'three'
import type { ObserverMode, TrailMode } from '../app/observerMode'
import { EARTH_GRAVITY } from '../gameplay/vehicle'

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
  'PC - WASD: walk/jetpack | click: throw | Space: jump | 1/2/3: travel | F: launch | Shift: brake | right-drag/arrows: look | Tab: menu | E: drive (near the car) | M: mute\n' +
  'VR - left grip: move clutch (lift outward to launch) | right trigger: throw / click panel / point at car to drive | right A: jump (exit car) | right stick: snap turn\n' +
  'VR driving - left stick: gas (up/down) + steer (left/right) | right stick: turn | either grip: brake | right A: get out\n' +
  'Mobile - drag: look | tap: throw | buttons: jump/travel/gyro'

const makeChip = (className: string) => {
  const chip = document.createElement('span')
  chip.className = `hud-chip ${className}`
  return chip
}

export const createHud = (): HudHandle => {
  const root = document.createElement('div')
  root.className = 'hud'

  const chips = document.createElement('div')
  chips.className = 'hud__chips'

  // The live "felt g" is the readout that actually moves as you play; the
  // nominal target g lives in the settings panel (and the debug drawer), so it
  // is no longer duplicated as an always-on chip.
  const presetChip = makeChip('hud-chip--preset')
  const feltChip = makeChip('')
  const spinChip = makeChip('')
  const modeChip = makeChip('')
  const ballsChip = makeChip('')
  const dockChip = makeChip('')
  chips.append(presetChip, feltChip, spinChip, modeChip, ballsChip, dockChip)

  const controls = document.createElement('details')
  controls.className = 'hud__drawer'
  const controlsSummary = document.createElement('summary')
  controlsSummary.textContent = 'controls'
  const controlsBody = document.createElement('pre')
  controlsBody.textContent = CONTROLS_TEXT
  controls.append(controlsSummary, controlsBody)

  const debug = document.createElement('details')
  debug.className = 'hud__drawer'
  const debugSummary = document.createElement('summary')
  debugSummary.textContent = 'debug'
  const debugBody = document.createElement('pre')
  debug.append(debugSummary, debugBody)

  root.append(chips, controls, debug)
  document.body.append(root)

  return {
    destroy: () => root.remove(),
    setVisible: (visible: boolean) => {
      root.hidden = !visible
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
