type HudSnapshot = {
  radius: number
  rpm: number
  gTarget: number
  ballCount: number
  trackedBallSpeed: number
  xrActive: boolean
  forceVectors: boolean
  region: 'inside' | 'outside'
  playerMode: 'attached' | 'free-fly'
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
    'VR: attached=left stick walk, left trigger launch, free-fly=left trigger thrust along left hand, left squeeze slow, left stick X roll rate/Y pitch rate, left stick click attitude brake, right stick snap turn | PC: left click/Space=throw, right drag/arrows=look, WASD=walk/jetpack, F=launch, Shift=slow'

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
        `force vectors ${snapshot.forceVectors ? 'on' : 'off'} | ` +
        `${snapshot.xrActive ? 'XR' : 'desktop'}${reattachText}`
    }
  }
}
