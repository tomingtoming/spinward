import type { Vector3 } from 'three'
import type { ObserverMode, TrailMode } from '../app/observerMode'

type HudSnapshot = {
  radius: number
  rpm: number
  gTarget: number
  ballCount: number
  trackedBallSpeed: number
  xrActive: boolean
  forceVectors: boolean
  observerMode: ObserverMode
  trailMode: TrailMode
  watchMenuOpen: boolean
  region: 'inside' | 'outside'
  playerMode: 'attached' | 'free-fly'
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
    assistActive: boolean
    ready: boolean
  } | null
}

export type HudHandle = {
  destroy: () => void
  setVisible: (visible: boolean) => void
  update: (snapshot: HudSnapshot) => void
}

export const createHud = (): HudHandle => {
  const root = document.createElement('div')
  root.className = 'hud'

  const stats = document.createElement('div')
  stats.className = 'hud__stats'

  const controls = document.createElement('div')
  controls.className = 'hud__controls'
  controls.textContent =
    'VR: left Y hold=watch menu, attached=left stick walk, left trigger launch, free-fly=left trigger thrust, left grip attitude brake, left stick click slow, left stick X roll/Y pitch, right stick snap turn, right trigger=watch click or ball throw | PC: Tab=watch panel, left click/Space=throw, right drag/arrows=look, WASD=walk/jetpack, F=launch, Shift=slow'

  root.append(stats, controls)
  document.body.append(root)

  return {
    destroy: () => root.remove(),
    setVisible: (visible: boolean) => {
      root.hidden = !visible
    },
    update: (snapshot) => {
      const reattachText =
        snapshot.reattach === null
          ? ''
          : ` | dock dr ${snapshot.reattach.radialError.toFixed(2)}/${snapshot.reattach.radialTolerance.toFixed(2)} ` +
            `vn ${snapshot.reattach.normalSpeed.toFixed(2)}/${snapshot.reattach.maxNormalSpeed.toFixed(2)} ` +
            `vs ${snapshot.reattach.surfaceSpeed.toFixed(2)}/${snapshot.reattach.maxSurfaceSpeed.toFixed(2)} ` +
            `${snapshot.reattach.assistActive ? 'assist' : 'coast'} ` +
            `${snapshot.reattach.ready ? 'ready' : 'hold'}`

      stats.textContent =
        `radius ${snapshot.radius.toFixed(0)}m | rpm ${snapshot.rpm.toFixed(1)} | ` +
        `g ${snapshot.gTarget.toFixed(2)}m/s^2 | balls ${snapshot.ballCount} | ` +
        `tracked speed ${snapshot.trackedBallSpeed.toFixed(2)}m/s | ` +
        `${snapshot.region} | ${snapshot.playerMode} | ` +
        `view ${snapshot.observerMode} | trails ${snapshot.trailMode} | ` +
        `watch ${snapshot.watchMenuOpen ? 'on' : 'off'} | ` +
        `force vectors ${snapshot.forceVectors ? 'on' : 'off'} | ` +
        `${snapshot.xrActive ? 'XR' : 'desktop'}${reattachText}` +
        (snapshot.verification === null
          ? ''
          : ` | vI [${snapshot.verification.inertialVelocity.x.toFixed(1)} ${snapshot.verification.inertialVelocity.y.toFixed(1)} ${snapshot.verification.inertialVelocity.z.toFixed(1)}]` +
            ` vR [${snapshot.verification.rotatingVelocity.x.toFixed(1)} ${snapshot.verification.rotatingVelocity.y.toFixed(1)} ${snapshot.verification.rotatingVelocity.z.toFixed(1)}]` +
            ` aF [${snapshot.verification.fictitiousAcceleration.x.toFixed(1)} ${snapshot.verification.fictitiousAcceleration.y.toFixed(1)} ${snapshot.verification.fictitiousAcceleration.z.toFixed(1)}]` +
            ` aE [${snapshot.verification.estimatedAcceleration.x.toFixed(1)} ${snapshot.verification.estimatedAcceleration.y.toFixed(1)} ${snapshot.verification.estimatedAcceleration.z.toFixed(1)}]` +
            ` err ${snapshot.verification.errorMagnitude.toFixed(2)}` +
            (snapshot.verification.warning ? ' Frame mismatch!' : ''))
    }
  }
}
